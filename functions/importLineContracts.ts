import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { addMonths, addDays, format, parseISO } from 'npm:date-fns@2.30.0';

/**
 * Imports historical line contracts from uploaded CSV/Excel file
 * Optimized with batch processing and caching to prevent timeouts
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Check authentication
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (authError) {
            console.error('Auth error:', authError);
            return Response.json({ success: false, error: 'לא מורשה - יש להתחבר למערכת' }, { status: 401 });
        }
        
        const isManager = user.role === 'מנהל' || user.role === 'admin';
        if (!isManager) {
            return Response.json({ success: false, error: 'רק מנהלים יכולים לבצע ייבוא' }, { status: 403 });
        }

        const body = await req.json();
        const { file_url } = body;
        if (!file_url) {
            return Response.json({ success: false, error: 'Missing file_url' }, { status: 400 });
        }

        console.log('📥 Starting optimized import from:', file_url);
        
        // Download file
        const fileResponse = await fetch(file_url);
        if (!fileResponse.ok) {
            throw new Error(`Failed to download file: ${fileResponse.statusText}`);
        }
        
        const arrayBuffer = await fileResponse.arrayBuffer();
        
        // Import XLSX library
        const XLSX = await import('npm:xlsx@0.18.5');
        
        // Parse Excel
        const uint8Array = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(uint8Array, { type: 'array' });
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('No sheets found in Excel file');
        }
        
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (!data || data.length < 2) {
            return Response.json({ success: false, error: 'הקובץ ריק או לא תקין' }, { status: 400 });
        }

        const headers = data[0];
        
        // Load initial data (Caching)
        console.log('🔄 Loading system data for cache...');
        const [carriers, mappings, agents, existingContracts, clientsList] = await Promise.all([
            base44.asServiceRole.entities.CarrierPolicy.filter({ is_active: true }),
            base44.asServiceRole.entities.CarrierProductMapping.filter({ is_active: true }, '-priority', 1000),
            base44.asServiceRole.entities.LinetUsersMap.list(null, 200),
            base44.asServiceRole.entities.LineContract.list(null, 10000), // Increased limit
            base44.asServiceRole.entities.Client.list(null, 10000) // Load clients to cache
        ]);

        // Build Caches
        const carrierMap = {};
        carriers.forEach(c => carrierMap[c.carrier_code] = c);

        const agentMap = {};
        agents.forEach(a => agentMap[a.user_name.toLowerCase()] = a.user_id);

        const clientMap = {}; // Name -> ID
        clientsList.forEach(c => {
            if (c.full_name) clientMap[c.full_name.trim()] = c.id;
        });

        // Duplicate check set
        const existingKeys = new Set();
        existingContracts.forEach(c => {
            const key = `${c.original_invoice_id}_${c.customer_id}`;
            existingKeys.add(key);
        });

        // Helper: Detect carrier
        const detectCarrier = (sku, productName) => {
            const skuStr = String(sku || '').trim();
            if (skuStr && skuStr !== 'UNKNOWN') {
                const exactMatch = mappings.find(m => m.product_sku_exact === skuStr);
                if (exactMatch) return exactMatch.carrier_code;

                const prefixMatch = mappings.find(m => 
                    m.product_sku_prefix && skuStr.startsWith(m.product_sku_prefix)
                );
                if (prefixMatch) return prefixMatch.carrier_code;
            }

            if (productName) {
                const nameMatch = mappings.find(m => 
                    m.name_contains && productName.toLowerCase().includes(m.name_contains.toLowerCase())
                );
                if (nameMatch) return nameMatch.carrier_code;
            }
            return null;
        };

        // Build column map
        const columnMap = {};
        headers.forEach((header, idx) => {
            const h = String(header || '').trim();
            if (h === 'חברה') columnMap[h] = 'customer_name';
            else if (h === 'מספר מסמך') columnMap[h] = 'doc_number';
            else if (h.includes('תאריך הפקה')) columnMap[h] = 'issue_date';
            else if (h === 'יצ"מ' || h === 'יצמ') columnMap[h] = 'agent_name';
            else if (h.includes('מק"ט') || h.includes('מקט') || h === 'קוד מק"ט') columnMap[h] = 'product_sku';
            else if (h.includes('תיאור') || (h.includes('פריט') && !h.includes('מחיר'))) columnMap[h] = 'product_name';
            else if (h.includes('כמות')) columnMap[h] = 'quantity';
            else if (h.includes('טלפון')) columnMap[h] = 'customer_phone';
            else if (h.includes('ח.פ') || h.includes('ת.ז')) columnMap[h] = 'customer_id_number';
            else if (h.includes('מספר קו') || h.includes('נייד')) columnMap[h] = 'msisdn';
        });

        // Batch storage
        const contractsToCreate = [];
        const newMappingsToCreate = [];
        const errorRows = [];
        const stats = { total: 0, created: 0, skipped: 0, errors: 0 };
        const processedSkus = new Set(); // To avoid duplicates in new mappings

        console.log('🚀 Processing rows...');

        for (let i = 1; i < data.length; i++) {
            const rowData = data[i];
            if (!rowData || rowData.length === 0) continue;

            stats.total++;
            
            try {
                // Map row
                const row = {};
                headers.forEach((header, idx) => {
                    const fieldName = columnMap[header];
                    if (fieldName) row[fieldName] = rowData[idx];
                });

                // Validate
                if (!row.customer_name || !row.doc_number || !row.issue_date) {
                    errorRows.push({ row: i + 1, error: 'חסרים שדות חובה' });
                    stats.errors++;
                    continue;
                }

                // Format Date
                let issueDate = row.issue_date;
                if (typeof issueDate === 'number') {
                    issueDate = format(new Date((issueDate - 25569) * 86400 * 1000), 'yyyy-MM-dd');
                } else if (typeof issueDate === 'string' && issueDate.includes('/')) {
                    const parts = issueDate.split('/');
                    if (parts.length === 3) issueDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
                row.issue_date = issueDate;

                // Defaults
                row.product_sku = String(row.product_sku || 'UNKNOWN').trim();
                row.agent_name = row.agent_name || 'לא הוגדר';

                // Carrier Detection
                const carrier_code = detectCarrier(row.product_sku, row.product_name);
                if (!carrier_code) {
                    stats.skipped++;
                    continue;
                }

                // Learning: Queue new mapping
                if (row.product_sku !== 'UNKNOWN') {
                    const existingSkuMap = mappings.find(m => m.product_sku_exact === row.product_sku);
                    if (!existingSkuMap && !processedSkus.has(row.product_sku)) {
                        newMappingsToCreate.push({
                            carrier_code,
                            product_sku_exact: row.product_sku,
                            priority: 100,
                            is_active: true
                        });
                        mappings.push({ carrier_code, product_sku_exact: row.product_sku }); // Add to local cache
                        processedSkus.add(row.product_sku);
                    }
                }

                const policy = carrierMap[carrier_code];
                if (!policy) {
                    errorRows.push({ row: i + 1, error: `אין מדיניות לספק ${carrier_code}` });
                    stats.errors++;
                    continue;
                }

                // Client Handling (Cache Check)
                const clientName = row.customer_name.trim();
                let customer_id = clientMap[clientName];

                if (!customer_id) {
                    // Create Client Immediately (Cannot be easily batched if we need the ID now)
                    // But we can optimistically assume it won't fail or handle it one by one.
                    // To be safe and since Clients are fewer than lines, we'll create them one by one but cache result.
                    try {
                        const newClient = await base44.asServiceRole.entities.Client.create({
                            full_name: row.customer_name,
                            phone: row.customer_phone || '',
                            id_number: row.customer_id_number || '',
                            source: 'LINE_IMPORT'
                        });
                        customer_id = newClient.id;
                        clientMap[clientName] = customer_id; // Update cache
                    } catch (err) {
                        console.error('Error creating client:', err);
                        continue;
                    }
                }

                // Check Duplicates
                const duplicateKey = `${row.doc_number}_${customer_id}`;
                if (existingKeys.has(duplicateKey)) {
                    stats.skipped++;
                    continue;
                }

                // Agent Logic
                let agent_id = agentMap[row.agent_name.toLowerCase()];
                let agent_name = row.agent_name;
                if (!agent_id && agents.length > 0) {
                    agent_id = agents[0].user_id;
                    agent_name = agents[0].user_name;
                }

                // Calculate Dates
                const activationDate = parseISO(row.issue_date);
                let safeDate = addMonths(activationDate, policy.churn_window_months || 12);
                safeDate = addDays(safeDate, policy.safety_buffer_days || 30);
                const safe_retarget_date = format(safeDate, 'yyyy-MM-dd');
                const status = safeDate <= new Date() ? 'ELIGIBLE' : 'LOCKED';

                // Queue Contract
                contractsToCreate.push({
                    customer_id,
                    customer_name: row.customer_name,
                    customer_phone: row.customer_phone || null,
                    customer_id_number: row.customer_id_number || null,
                    msisdn: row.msisdn || null,
                    carrier_code,
                    carrier_name: policy.carrier_name,
                    activation_date: row.issue_date,
                    original_invoice_id: row.doc_number,
                    agent_id,
                    agent_name,
                    account_owner_id: agent_id,
                    account_owner_name: agent_name,
                    safe_retarget_date,
                    status,
                    last_action_date: new Date().toISOString(),
                    last_action_type: 'IMPORTED'
                });

                existingKeys.add(duplicateKey);

            } catch (err) {
                console.error('Row error:', err);
                errorRows.push({ row: i + 1, error: err.message });
                stats.errors++;
            }
        }

        console.log(`💾 Saving ${contractsToCreate.length} contracts and ${newMappingsToCreate.length} new mappings...`);

        // Batch Write Mappings
        if (newMappingsToCreate.length > 0) {
            // Split into chunks of 100
            for (let i = 0; i < newMappingsToCreate.length; i += 100) {
                const chunk = newMappingsToCreate.slice(i, i + 100);
                await base44.asServiceRole.entities.CarrierProductMapping.bulkCreate(chunk);
            }
            console.log('✅ Mappings saved');
        }

        // Batch Write Contracts
        if (contractsToCreate.length > 0) {
            // Split into chunks of 100
            for (let i = 0; i < contractsToCreate.length; i += 100) {
                const chunk = contractsToCreate.slice(i, i + 100);
                await base44.asServiceRole.entities.LineContract.bulkCreate(chunk);
            }
            stats.created = contractsToCreate.length;
            console.log('✅ Contracts saved');
        }

        return Response.json({
            success: true,
            stats,
            errorRows: errorRows.slice(0, 50),
            message: `יובאו ${stats.created} חוזים (חדשים), ${newMappingsToCreate.length} מק"טים נלמדו`
        });

    } catch (error) {
        console.error('❌ Import error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});