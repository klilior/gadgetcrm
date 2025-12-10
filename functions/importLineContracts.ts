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

        console.log('📥 Starting line contracts import from:', file_url);

        console.log('📥 Downloading file from:', file_url);
        
        // Download file
        const fileResponse = await fetch(file_url);
        if (!fileResponse.ok) {
            throw new Error(`Failed to download file: ${fileResponse.statusText}`);
        }
        
        const arrayBuffer = await fileResponse.arrayBuffer();
        console.log(`📦 Downloaded ${arrayBuffer.byteLength} bytes`);

        // Import XLSX library from npm
        const XLSX = await import('npm:xlsx@0.18.5');
        
        // Parse Excel
        const uint8Array = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(uint8Array, { type: 'array' });
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('No sheets found in Excel file');
        }
        
        const sheetName = workbook.SheetNames[0];
        console.log(`📄 Reading sheet: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (!data || data.length < 2) {
            return Response.json({ 
                success: false, 
                error: 'הקובץ ריק או לא תקין - נדרשות לפחות שורת כותרות ושורת נתונים אחת' 
            }, { status: 400 });
        }

        const headers = data[0];
        console.log('📋 Headers found:', JSON.stringify(headers));
        console.log('📋 Headers count:', headers.length);
        
        // Show first data row for debugging
        if (data.length > 1) {
            console.log('📋 First data row:', JSON.stringify(data[1]));
        }

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

        // Column mapping from Hebrew headers (exact match from Excel)
        const columnMap = {};
        
        // Build flexible column mapping
        headers.forEach((header, idx) => {
            const h = String(header || '').trim();
            
            if (h === 'חברה') columnMap[h] = 'customer_name';
            else if (h === 'מספר מסמך') columnMap[h] = 'doc_number';
            else if (h.includes('תאריך הפקה')) columnMap[h] = 'issue_date';
            else if (h === 'יצ"מ' || h === 'יצמ') columnMap[h] = 'agent_name';
            else if (h.includes('מק"ט') || h.includes('מקט') || h === 'קוד מק"ט') columnMap[h] = 'product_sku';
            else if (h.includes('תיאור') || h.includes('פריט')) columnMap[h] = 'product_name';
            else if (h.includes('כמות')) columnMap[h] = 'quantity';
        });
        
        console.log('📋 Column mapping built:', JSON.stringify(columnMap));

        // Process rows
        const stats = { total: 0, created: 0, skipped: 0, errors: 0 };
        const errorRows = [];

        for (let i = 1; i < data.length; i++) {
            const rowData = data[i];
            if (!rowData || rowData.length === 0) continue;

            stats.total++;
            
            try {
                // Map Hebrew columns to English field names
                const row = {};
                headers.forEach((header, idx) => {
                    const fieldName = columnMap[header];
                    if (fieldName) {
                        row[fieldName] = rowData[idx];
                    }
                });
                
                // Debug: log mapped row for first few rows
                if (i <= 3) {
                    console.log(`Row ${i + 1} mapped:`, JSON.stringify(row));
                }

                // Parse and format date
                if (row.issue_date) {
                    try {
                        // Handle Excel date (serial number) or string
                        if (typeof row.issue_date === 'number') {
                            // Excel serial date (days since 1900-01-01)
                            const date = new Date((row.issue_date - 25569) * 86400 * 1000);
                            row.issue_date = format(date, 'yyyy-MM-dd');
                        } else if (typeof row.issue_date === 'string' && row.issue_date.includes('/')) {
                            // Parse DD/MM/YYYY format
                            const parts = row.issue_date.split('/');
                            if (parts.length === 3) {
                                const day = parts[0].padStart(2, '0');
                                const month = parts[1].padStart(2, '0');
                                const year = parts[2];
                                row.issue_date = `${year}-${month}-${day}`;
                            }
                        }
                    } catch (dateErr) {
                        console.error(`Date parsing error for row ${i + 1}:`, dateErr);
                        errorRows.push({ row: i + 1, error: `שגיאה בפורמט התאריך: ${row.issue_date}` });
                        stats.errors++;
                        continue;
                    }
                }

                // Validate required fields - רק שדות שבאמת קיימים בקובץ
                if (!row.customer_name || !row.doc_number || !row.issue_date) {
                    console.log(`Row ${i + 1} missing fields:`, row);
                    errorRows.push({ row: i + 1, error: 'חסרים שדות חובה (חברה, מספר מסמך, תאריך)' });
                    stats.errors++;
                    continue;
                }
                
                // Default values for optional fields
                if (!row.product_sku) row.product_sku = 'UNKNOWN';
                if (!row.agent_name) row.agent_name = 'לא הוגדר';

                // Detect carrier
                const carrier_code = detectCarrier(row.product_sku, row.product_name);
                if (!carrier_code) {
                    console.log(`Row ${i + 1} - No carrier detected for SKU: ${row.product_sku}, Name: ${row.product_name}`);
                    stats.skipped++;
                    continue; // Not a line product
                }
                
                console.log(`Row ${i + 1} - Carrier detected: ${carrier_code}`);

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

                // Find agent - use default if not found
                let agent_id, agent_name;
                if (row.agent_name && row.agent_name !== 'לא הוגדר') {
                    const agentNameLower = row.agent_name.toLowerCase();
                    agent_id = agentMap[agentNameLower];
                    agent_name = row.agent_name;
                }
                
                // If agent not found, use first available agent as default
                if (!agent_id) {
                    const defaultAgent = agents[0];
                    if (defaultAgent) {
                        agent_id = defaultAgent.user_id;
                        agent_name = defaultAgent.user_name;
                        console.log(`Using default agent for row ${i + 1}: ${agent_name}`);
                    } else {
                        errorRows.push({ row: i + 1, error: 'אין נציגים במערכת' });
                        stats.errors++;
                        continue;
                    }
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
                    agent_name: agent_name,
                    account_owner_id: agent_id,
                    account_owner_name: agent_name,
                    safe_retarget_date,
                    status,
                    last_action_date: new Date().toISOString(),
                    last_action_type: 'IMPORTED'
                });

                existingKeys.add(duplicateKey);
                stats.created++;
                console.log(`✅ Row ${i + 1} - Created contract for ${row.customer_name}, carrier: ${carrier_code}`);

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
        console.error('Stack trace:', error.stack);
        return Response.json({
            success: false,
            error: error.message,
            details: error.stack
        }, { status: 500 });
    }
});