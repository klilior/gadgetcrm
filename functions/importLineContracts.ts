import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { addMonths, addDays, format, parseISO } from 'npm:date-fns@2.30.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ success: false, error: 'רק מנהלים מורשים' }, { status: 403 });
        }

        const { file_url } = await req.json();
        if (!file_url) return Response.json({ success: false, error: 'חסר file_url' }, { status: 400 });

        console.log('📥 מתחיל ייבוא:', file_url);
        
        // Download and parse
        const fileRes = await fetch(file_url);
        const buffer = await fileRes.arrayBuffer();
        const XLSX = await import('npm:xlsx@0.18.5');
        const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

        if (data.length < 2) return Response.json({ success: false, error: 'קובץ ריק' }, { status: 400 });

        const headers = data[0];
        
        // Load caches
        const [carriers, mappings, agents] = await Promise.all([
            base44.asServiceRole.entities.CarrierPolicy.filter({ is_active: true }),
            base44.asServiceRole.entities.CarrierProductMapping.filter({ is_active: true }),
            base44.asServiceRole.entities.LinetUsersMap.list(null, 200)
        ]);

        const carrierMap = Object.fromEntries(carriers.map(c => [c.carrier_code, c]));
        const agentMap = Object.fromEntries(agents.map(a => [a.user_name.toLowerCase(), a.user_id]));
        const defaultAgent = agents[0];

        // Detect carrier
        const detectCarrier = (sku, name) => {
            sku = String(sku || '').trim();
            name = String(name || '').toLowerCase();
            
            if (sku && sku !== 'UNKNOWN') {
                const m = mappings.find(m => m.product_sku_exact === sku || (m.product_sku_prefix && sku.startsWith(m.product_sku_prefix)));
                if (m) return m.carrier_code;
            }
            
            if (name) {
                const m = mappings.find(m => m.name_contains && name.includes(m.name_contains.toLowerCase()));
                if (m) return m.carrier_code;
            }
            
            return null;
        };

        // Column mapping
        const colMap = {};
        headers.forEach(h => {
            h = String(h || '').trim();
            if (h === 'חברה') colMap[h] = 'customer_name';
            else if (h === 'מספר מסמך') colMap[h] = 'doc_number';
            else if (h.includes('תאריך')) colMap[h] = 'issue_date';
            else if (h === 'יצ"מ' || h === 'יצמ') colMap[h] = 'agent_name';
            else if (h.includes('מק"ט')) colMap[h] = 'product_sku';
            else if (h.includes('תיאור') || h.includes('פריט')) colMap[h] = 'product_name';
        });

        const stats = { total: 0, created: 0, skipped: 0, errors: 0 };
        const errors = [];
        const clientsToCreate = new Map(); // Name -> data
        const contractsToCreate = [];
        const newMappings = new Map();

        console.log('🔄 עיבוד שורות...');

        // First pass: collect unique clients
        for (let i = 1; i < data.length; i++) {
            stats.total++;
            const rowData = data[i];
            const row = {};
            headers.forEach((h, idx) => {
                if (colMap[h]) row[colMap[h]] = rowData[idx];
            });

            if (!row.customer_name || !row.doc_number || !row.issue_date) {
                errors.push({ row: i + 1, error: 'חסרים שדות' });
                stats.errors++;
                continue;
            }

            const name = String(row.customer_name).trim();
            if (!clientsToCreate.has(name)) {
                clientsToCreate.set(name, { full_name: name, source: 'LINE_IMPORT' });
            }
        }

        console.log(`👥 יוצר ${clientsToCreate.size} לקוחות חדשים...`);
        
        // Create all clients in batch
        const clientRecords = Array.from(clientsToCreate.values());
        let createdClients = [];
        for (let i = 0; i < clientRecords.length; i += 50) {
            const chunk = clientRecords.slice(i, i + 50);
            const batch = await base44.asServiceRole.entities.Client.bulkCreate(chunk);
            createdClients = createdClients.concat(batch);
        }
        
        const clientIdMap = Object.fromEntries(createdClients.map(c => [c.full_name.trim(), c.id]));

        console.log('📝 יוצר חוזים...');

        // Second pass: create contracts
        for (let i = 1; i < data.length; i++) {
            const rowData = data[i];
            const row = {};
            headers.forEach((h, idx) => {
                if (colMap[h]) row[colMap[h]] = rowData[idx];
            });

            if (!row.customer_name || !row.doc_number || !row.issue_date) continue;

            // Parse date
            let date = row.issue_date;
            if (typeof date === 'number') {
                date = format(new Date((date - 25569) * 86400 * 1000), 'yyyy-MM-dd');
            } else if (String(date).includes('/')) {
                const p = String(date).split('/');
                date = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            }

            const sku = String(row.product_sku || 'UNKNOWN').trim();
            const carrier_code = detectCarrier(sku, row.product_name);
            
            if (!carrier_code) {
                stats.skipped++;
                continue;
            }

            // Learn SKU
            if (sku !== 'UNKNOWN' && !newMappings.has(sku)) {
                const exists = mappings.find(m => m.product_sku_exact === sku);
                if (!exists) {
                    newMappings.set(sku, { carrier_code, product_sku_exact: sku, priority: 100, is_active: true });
                }
            }

            const policy = carrierMap[carrier_code];
            if (!policy) continue;

            const customer_id = clientIdMap[String(row.customer_name).trim()];
            if (!customer_id) continue;

            const agent_id = agentMap[String(row.agent_name || '').toLowerCase()] || defaultAgent?.user_id;
            const agent_name = row.agent_name || defaultAgent?.user_name;

            const actDate = parseISO(date);
            const safeDate = addDays(addMonths(actDate, policy.churn_window_months || 12), policy.safety_buffer_days || 30);
            const status = safeDate <= new Date() ? 'ELIGIBLE' : 'LOCKED';

            contractsToCreate.push({
                customer_id,
                customer_name: row.customer_name,
                carrier_code,
                carrier_name: policy.carrier_name,
                activation_date: date,
                original_invoice_id: row.doc_number,
                agent_id,
                agent_name,
                account_owner_id: agent_id,
                account_owner_name: agent_name,
                safe_retarget_date: format(safeDate, 'yyyy-MM-dd'),
                status,
                msisdn: null,
                customer_phone: null,
                customer_id_number: null,
                last_action_date: new Date().toISOString(),
                last_action_type: 'IMPORTED'
            });
        }

        console.log(`💾 שומר ${contractsToCreate.length} חוזים...`);

        // Save contracts in batches
        for (let i = 0; i < contractsToCreate.length; i += 50) {
            await base44.asServiceRole.entities.LineContract.bulkCreate(contractsToCreate.slice(i, i + 50));
        }
        stats.created = contractsToCreate.length;

        // Save learned mappings
        if (newMappings.size > 0) {
            await base44.asServiceRole.entities.CarrierProductMapping.bulkCreate(Array.from(newMappings.values()));
        }

        return Response.json({
            success: true,
            stats,
            errorRows: errors.slice(0, 20),
            message: `✅ ${stats.created} חוזים, ${newMappings.size} מק"טים נלמדו`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});