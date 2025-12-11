import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        console.log('🔍 מחפש באצ׳ אחרון...');

        // Get latest batch
        const batches = await base44.asServiceRole.entities.LineImportBatch.filter(
            { status: 'UPLOADED' },
            '-created_date',
            1
        );

        if (batches.length === 0) {
            return Response.json({ error: 'לא נמצא באצ׳ מתאים' }, { status: 404 });
        }

        const batch = batches[0];
        console.log('📦 באצ׳:', batch.id, batch.file_name);

        // Get all rows from batch
        const rows = await base44.asServiceRole.entities.LineImportRow.filter(
            { batch_id: batch.id },
            null,
            10000
        );

        console.log(`📊 נמצאו ${rows.length} שורות`);

        // Extract unique SKUs
        const skuMap = new Map();
        for (const row of rows) {
            if (row.item_sku && row.item_sku.trim()) {
                const sku = row.item_sku.trim();
                if (!skuMap.has(sku)) {
                    skuMap.set(sku, row.item_name || '');
                }
            }
        }

        console.log(`🔑 מק״טים ייחודיים: ${skuMap.size}`);

        // Get existing definitions
        const existing = await base44.asServiceRole.entities.LineProductDefinition.filter(
            { is_active: true },
            null,
            10000
        );

        const existingSkus = new Set(existing.map(e => e.item_sku));
        console.log(`✅ קיימים במערכת: ${existingSkus.size}`);

        // Create new definitions for missing SKUs
        const toCreate = [];
        for (const [sku, name] of skuMap.entries()) {
            if (!existingSkus.has(sku)) {
                toCreate.push({
                    item_sku: sku,
                    item_name_sample: name,
                    is_line: false,
                    is_active: true,
                    safety_buffer_days: 5
                });
            }
        }

        console.log(`➕ חדשים ליצירה: ${toCreate.length}`);

        let created = 0;
        if (toCreate.length > 0) {
            // Create in batches
            for (let i = 0; i < toCreate.length; i += 50) {
                const chunk = toCreate.slice(i, i + 50);
                await base44.asServiceRole.entities.LineProductDefinition.bulkCreate(chunk);
                created += chunk.length;
                console.log(`✅ נוצרו ${created}/${toCreate.length}`);
            }
        }

        return Response.json({
            success: true,
            batch_file_name: batch.file_name,
            total_skus: skuMap.size,
            existing_skus: existingSkus.size,
            created_skus: created,
            message: `✅ נטענו ${created} מק״טים חדשים`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});