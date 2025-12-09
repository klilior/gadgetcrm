import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { addMonths, addDays, format, parseISO } from 'npm:date-fns@2.30.0';

/**
 * Imports historical line contracts from uploaded CSV/Excel file
 * Expected columns: customer_name, customer_phone, customer_id_number, msisdn, 
 *                   product_sku, product_name, doc_number, issue_date, agent_name
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user || user.role !== 'מנהל') {
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const { file_url } = await req.json();
        if (!file_url) {
            return Response.json({ success: false, error: 'Missing file_url' }, { status: 400 });
        }

        console.log('📥 Starting line contracts import from:', file_url);

        // Download file
        const fileResponse = await fetch(file_url);
        const fileText = await fileResponse.text();

        // Parse CSV (simple parser - assumes comma-separated, first row is headers)
        const lines = fileText.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return Response.json({ 
                success: false, 
                error: 'הקובץ ריק או לא תקין' 
            }, { status: 400 });
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        console.log('📋 Headers found:', headers);

        // Load caches
        const [carriers, mappings, agents, existingContracts] = await Promise.all([
            base44.asServiceRole.entities.CarrierPolicy.filter({ is_active: true }),
            base44.asServiceRole.entities.CarrierProductMapping.filter({ is_active: true }, '-priority', 200),
            base44.asServiceRole.entities.LinetUsersMap.list(null, 200),
            base44.asServiceRole.entities.LineContract.list(null, 5000) // Load existing to check duplicates
        ]);

        const carrierMap = {};
        carriers.forEach(c => carrierMap[c.carrier_code] = c);

        const agentMap = {};
        agents.forEach(a => agentMap[a.user_name.toLowerCase()] = a.user_id);

        // Build duplicate check set
        const existingKeys = new Set();
        existingContracts.forEach(c => {
            const key = `${c.original_invoice_id}_${c.customer_id}`;
            existingKeys.add(key);
        });

        // Detect carrier function (inline)
        const detectCarrier = (sku, productName) => {
            if (sku) {
                const exactMatch = mappings.find(m => m.product_sku_exact === sku);
                if (exactMatch) return exactMatch.carrier_code;

                const prefixMatch = mappings.find(m => 
                    m.product_sku_prefix && sku.startsWith(m.product_sku_prefix)
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

        // Process rows
        const stats = { total: 0, created: 0, skipped: 0, errors: 0 };
        const errorRows = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            stats.total++;
            
            try {
                // Parse CSV row (handle quotes)
                const values = [];
                let currentValue = '';
                let inQuotes = false;
                
                for (let char of line) {
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(currentValue.trim());
                        currentValue = '';
                    } else {
                        currentValue += char;
                    }
                }
                values.push(currentValue.trim()); // Last value

                const row = {};
                headers.forEach((h, idx) => {
                    row[h] = values[idx]?.replace(/"/g, '') || '';
                });

                // Validate required fields
                if (!row.customer_name || !row.product_sku || !row.doc_number || !row.issue_date || !row.agent_name) {
                    errorRows.push({ row: i + 1, error: 'חסרים שדות חובה' });
                    stats.errors++;
                    continue;
                }

                // Detect carrier
                const carrier_code = detectCarrier(row.product_sku, row.product_name);
                if (!carrier_code) {
                    stats.skipped++;
                    continue; // Not a line product
                }

                const policy = carrierMap[carrier_code];
                if (!policy) {
                    errorRows.push({ row: i + 1, error: `אין מדיניות לספק ${carrier_code}` });
                    stats.errors++;
                    continue;
                }

                // Find or create customer
                let customers = await base44.asServiceRole.entities.Client.filter({
                    full_name: row.customer_name
                }, null, 1);

                let customer_id;
                if (customers.length > 0) {
                    customer_id = customers[0].id;
                } else {
                    // Create new customer
                    const newCustomer = await base44.asServiceRole.entities.Client.create({
                        full_name: row.customer_name,
                        phone: row.customer_phone || '',
                        id_number: row.customer_id_number || '',
                        source: 'LINE_IMPORT'
                    });
                    customer_id = newCustomer.id;
                }

                // Find agent
                const agentNameLower = row.agent_name.toLowerCase();
                const agent_id = agentMap[agentNameLower];
                if (!agent_id) {
                    errorRows.push({ row: i + 1, error: `נציג לא נמצא: ${row.agent_name}` });
                    stats.errors++;
                    continue;
                }

                // Check for duplicate
                const duplicateKey = `${row.doc_number}_${customer_id}`;
                if (existingKeys.has(duplicateKey)) {
                    stats.skipped++;
                    continue;
                }

                // Calculate safe retarget date
                const activationDate = parseISO(row.issue_date);
                let safeDate = addMonths(activationDate, policy.churn_window_months || 12);
                safeDate = addDays(safeDate, policy.safety_buffer_days || 30);
                const safe_retarget_date = format(safeDate, 'yyyy-MM-dd');

                // Determine status
                const today = new Date();
                const status = safeDate <= today ? 'ELIGIBLE' : 'LOCKED';

                // Create contract
                await base44.asServiceRole.entities.LineContract.create({
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
                    agent_name: row.agent_name,
                    account_owner_id: agent_id,
                    account_owner_name: row.agent_name,
                    safe_retarget_date,
                    status,
                    last_action_date: new Date().toISOString(),
                    last_action_type: 'IMPORTED'
                });

                existingKeys.add(duplicateKey);
                stats.created++;

            } catch (error) {
                console.error(`Error processing row ${i + 1}:`, error);
                errorRows.push({ row: i + 1, error: error.message });
                stats.errors++;
            }
        }

        console.log('✅ Import completed:', stats);

        return Response.json({
            success: true,
            stats,
            errorRows: errorRows.slice(0, 50), // Return first 50 errors
            message: `יובאו ${stats.created} חוזים מתוך ${stats.total} שורות`
        });

    } catch (error) {
        console.error('❌ Import error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});