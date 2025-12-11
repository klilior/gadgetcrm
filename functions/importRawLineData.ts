import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        const { file_url, file_name } = await req.json();
        if (!file_url || !file_name) {
            return Response.json({ error: 'חסרים פרמטרים' }, { status: 400 });
        }

        console.log('📥 מתחיל ייבוא גולמי:', file_name);
        
        // Download and parse
        const fileRes = await fetch(file_url);
        const buffer = await fileRes.arrayBuffer();
        const XLSX = await import('npm:xlsx@0.18.5');
        const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: true });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { 
            header: 1, 
            defval: '',
            raw: false  // Keep everything as text
        });

        if (data.length < 2) {
            return Response.json({ error: 'קובץ ריק' }, { status: 400 });
        }

        const headers = data[0].map(h => String(h || '').trim());
        console.log('📋 Headers:', headers);

        // Create batch
        const batch = await base44.asServiceRole.entities.LineImportBatch.create({
            uploaded_by: user.id,
            file_name,
            status: 'UPLOADED',
            uploaded_at: new Date().toISOString(),
            total_rows: data.length - 1
        });

        console.log('📦 Batch created:', batch.id);

        // Column mapping - flexible to handle various header names
        const findCol = (patterns) => {
            for (const pattern of patterns) {
                const idx = headers.findIndex(h => 
                    h.includes(pattern) || h.toLowerCase().includes(pattern.toLowerCase())
                );
                if (idx >= 0) return idx;
            }
            return -1;
        };

        const colIdx = {
            doc_type: findCol(['סוג מסמך', 'סוג']),
            doc_number: findCol(['מספר מסמך', 'מס מסמך', 'מסמך']),
            issue_date: findCol(['תאריך', 'הפקה']),
            customer_name: findCol(['חברה', 'לקוח', 'שם לקוח']),
            customer_id_external: findCol(['מזהה לקוח', 'ח.פ', 'עוסק']),
            item_sku: findCol(['sku', 'SKU', 'מק"ט', 'קוד']),
            item_name: findCol(['תיאור', 'פריט', 'שם פריט']),
            quantity: findCol(['כמות', 'יחידות']),
            owner_name: findCol(['יצ"מ', 'יצמ', 'נציג', 'מוכר', 'owner']),
            category_name: findCol(['קטגוריה', 'סוג פריט'])
        };

        console.log('🗺️ Column mapping:', colIdx);

        const rows = [];
        let invalidCount = 0;

        // Parse all rows
        for (let i = 1; i < data.length; i++) {
            const rowData = data[i];
            
            // Build row object
            const row = {
                batch_id: batch.id,
                is_valid: true,
                raw_json: {}
            };

            // Extract columns
            if (colIdx.doc_type >= 0) row.doc_type = String(rowData[colIdx.doc_type] || '').trim();
            if (colIdx.doc_number >= 0) row.doc_number = String(rowData[colIdx.doc_number] || '').trim();
            if (colIdx.issue_date >= 0) row.issue_date = String(rowData[colIdx.issue_date] || '').trim();
            if (colIdx.customer_name >= 0) row.customer_name = String(rowData[colIdx.customer_name] || '').trim();
            if (colIdx.customer_id_external >= 0) row.customer_id_external = String(rowData[colIdx.customer_id_external] || '').trim();
            if (colIdx.item_sku >= 0) row.item_sku = String(rowData[colIdx.item_sku] || '').trim();
            if (colIdx.item_name >= 0) row.item_name = String(rowData[colIdx.item_name] || '').trim();
            if (colIdx.quantity >= 0) row.quantity = String(rowData[colIdx.quantity] || '').trim();
            if (colIdx.owner_name >= 0) row.owner_name = String(rowData[colIdx.owner_name] || '').trim();
            if (colIdx.category_name >= 0) row.category_name = String(rowData[colIdx.category_name] || '').trim();

            // Store full row
            headers.forEach((h, idx) => {
                if (rowData[idx] !== undefined && rowData[idx] !== '') {
                    row.raw_json[h] = String(rowData[idx]);
                }
            });

            // Basic validation
            if (!row.doc_number || !row.issue_date) {
                row.is_valid = false;
                row.validation_error = 'חסרים שדות חובה (מספר מסמך או תאריך)';
                invalidCount++;
            }

            rows.push(row);
        }

        console.log(`💾 שומר ${rows.length} שורות...`);

        // Save in batches
        for (let i = 0; i < rows.length; i += 100) {
            const chunk = rows.slice(i, i + 100);
            await base44.asServiceRole.entities.LineImportRow.bulkCreate(chunk);
            console.log(`✅ ${Math.min(i + 100, rows.length)}/${rows.length}`);
        }

        // Update batch
        await base44.asServiceRole.entities.LineImportBatch.update(batch.id, {
            status: invalidCount > 0 ? 'UPLOADED' : 'UPLOADED',
            error_count: invalidCount
        });

        return Response.json({
            success: true,
            batch_id: batch.id,
            total_rows: rows.length,
            invalid_rows: invalidCount,
            message: `✅ ${rows.length} שורות נקראו בהצלחה`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});