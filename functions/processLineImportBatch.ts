import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { addMonths, addDays, parseISO, format } from 'npm:date-fns@2.30.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        const { batch_id } = await req.json();
        if (!batch_id) {
            return Response.json({ error: 'חסר batch_id' }, { status: 400 });
        }

        console.log('⚙️ מעבד באצ׳:', batch_id);

        // Update batch status
        await base44.asServiceRole.entities.LineImportBatch.update(batch_id, {
            status: 'PROCESSING'
        });

        // Load necessary data
        const [rows, definitions, agents, existingClients, existingContracts] = await Promise.all([
            base44.asServiceRole.entities.LineImportRow.filter({ batch_id }, null, 10000),
            base44.asServiceRole.entities.LineProductDefinition.filter({ is_line: true, is_active: true }, null, 5000),
            base44.asServiceRole.entities.LinetUsersMap.list(null, 200),
            base44.asServiceRole.entities.Client.list(null, 10000),
            base44.asServiceRole.entities.LineContract.filter({ import_source: 'LINET_IMPORT' }, null, 10000)
        ]);

        console.log(`📊 ${rows.length} שורות, ${definitions.length} הגדרות קווים`);

        // Build lookup maps
        const defMap = Object.fromEntries(definitions.map(d => [d.item_sku, d]));
        const agentMap = Object.fromEntries(agents.map(a => [a.user_name.toLowerCase(), a.user_id]));
        const clientMap = Object.fromEntries(existingClients.map(c => [c.full_name?.trim() || '', c.id]));
        const contractKeyMap = new Map(
            existingContracts.map(c => [c.import_doc_number + '_' + c.import_sku, c.id])
        );

        const stats = {
            total: rows.length,
            created: 0,
            updated: 0,
            skipped_unmapped: 0,
            skipped_invalid: 0,
            errors: 0,
            error_no_customer: 0,
            error_no_date: 0,
            error_no_agent: 0
        };

        const unmappedSkus = new Set();
        const errors = [];
        const errorSamples = {
            no_customer: [],
            no_date: [],
            no_agent: [],
            other: []
        };
        const clientsToCreate = new Map();
        const contractsToCreate = [];
        const contractsToUpdate = [];

        // Parse date helper
        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            try {
                // Try different formats
                if (dateStr.includes('/')) {
                    const parts = dateStr.split('/');
                    if (parts.length === 3) {
                        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                }
                if (dateStr.includes('-')) {
                    return dateStr.substring(0, 10);
                }
                // Excel date number
                const num = parseFloat(dateStr);
                if (!isNaN(num) && num > 40000) {
                    return format(new Date((num - 25569) * 86400 * 1000), 'yyyy-MM-dd');
                }
            } catch (e) {
                console.error('Date parse error:', e, dateStr);
            }
            return null;
        };

        // Step 1: Collect new clients
        for (const row of rows) {
            if (!row.is_valid || !row.customer_name) continue;
            const name = row.customer_name.trim();
            if (!clientMap[name] && !clientsToCreate.has(name)) {
                clientsToCreate.set(name, { full_name: name });
            }
        }

        // Create clients
        if (clientsToCreate.size > 0) {
            console.log(`👥 יוצר ${clientsToCreate.size} לקוחות...`);
            const created = [];
            const clientRecords = Array.from(clientsToCreate.values());
            for (let i = 0; i < clientRecords.length; i += 50) {
                const batch = await base44.asServiceRole.entities.Client.bulkCreate(
                    clientRecords.slice(i, i + 50)
                );
                created.push(...batch);
            }
            created.forEach(c => clientMap[c.full_name.trim()] = c.id);
        }

        // Step 2: Process rows
        for (const row of rows) {
            try {
                if (!row.is_valid) {
                    stats.skipped_invalid++;
                    continue;
                }

                // Check if SKU is a line
                const def = defMap[row.item_sku];
                if (!def) {
                    stats.skipped_unmapped++;
                    unmappedSkus.add(row.item_sku);
                    continue;
                }

                // Parse date
                const activationDate = parseDate(row.issue_date);
                if (!activationDate) {
                    stats.errors++;
                    stats.error_no_date++;
                    if (errorSamples.no_date.length < 5) {
                        errorSamples.no_date.push({ 
                            doc: row.doc_number, 
                            date_raw: row.issue_date,
                            customer: row.customer_name 
                        });
                    }
                    errors.push({ row_id: row.id, error: 'תאריך לא תקין', date: row.issue_date });
                    continue;
                }

                // Calculate safe retarget date
                const actDate = parseISO(activationDate);
                const safeDate = addDays(
                    addMonths(actDate, def.churn_window_months || 3),
                    def.safety_buffer_days || 5
                );
                const safeRetargetDate = format(safeDate, 'yyyy-MM-dd');
                const status = safeDate <= new Date() ? 'ELIGIBLE' : 'LOCKED';

                // Map agent
                const agentId = agentMap[row.owner_name?.toLowerCase() || ''] || agents[0]?.user_id;
                const agentName = row.owner_name || agents[0]?.user_name || 'לא ידוע';

                // Map customer
                const customerId = clientMap[row.customer_name?.trim() || ''];
                if (!customerId) {
                    stats.errors++;
                    stats.error_no_customer++;
                    if (errorSamples.no_customer.length < 5) {
                        errorSamples.no_customer.push({ 
                            doc: row.doc_number,
                            customer: row.customer_name 
                        });
                    }
                    errors.push({ row_id: row.id, error: 'לקוח לא נמצא', customer: row.customer_name });
                    continue;
                }

                // Build contract data
                const contractData = {
                    customer_id: customerId,
                    customer_name: row.customer_name,
                    customer_phone: null,
                    customer_id_number: row.customer_id_external || null,
                    msisdn: null,
                    carrier_code: def.carrier_code,
                    carrier_name: def.carrier_code, // Will be enriched later if needed
                    activation_date: activationDate,
                    safe_retarget_date: safeRetargetDate,
                    status,
                    agent_id: agentId,
                    agent_name: agentName,
                    account_owner_id: agentId,
                    account_owner_name: agentName,
                    import_source: 'LINET_IMPORT',
                    import_batch_id: batch_id,
                    import_doc_number: row.doc_number,
                    import_sku: row.item_sku,
                    last_action_date: new Date().toISOString(),
                    last_action_type: 'IMPORTED'
                };

                // Check if already exists
                const existingKey = row.doc_number + '_' + row.item_sku;
                const existingId = contractKeyMap.get(existingKey);

                if (existingId) {
                    contractsToUpdate.push({ id: existingId, data: contractData });
                    stats.updated++;
                } else {
                    contractsToCreate.push(contractData);
                    stats.created++;
                }

            } catch (error) {
                stats.errors++;
                if (errorSamples.other.length < 5) {
                    errorSamples.other.push({ 
                        doc: row.doc_number,
                        error: error.message 
                    });
                }
                errors.push({ row_id: row.id, error: error.message });
                console.error('Row processing error:', error);
            }
        }

        console.log(`💾 שומר: ${contractsToCreate.length} חדשים, ${contractsToUpdate.length} עדכונים`);

        // Save contracts
        if (contractsToCreate.length > 0) {
            for (let i = 0; i < contractsToCreate.length; i += 50) {
                await base44.asServiceRole.entities.LineContract.bulkCreate(
                    contractsToCreate.slice(i, i + 50)
                );
                console.log(`✅ ${Math.min(i + 50, contractsToCreate.length)}/${contractsToCreate.length}`);
            }
        }

        // Update contracts
        for (const { id, data } of contractsToUpdate) {
            await base44.asServiceRole.entities.LineContract.update(id, data);
        }

        // Update batch
        await base44.asServiceRole.entities.LineImportBatch.update(batch_id, {
            status: stats.errors > 0 ? 'PROCESSED' : 'PROCESSED',
            processed_rows: stats.created + stats.updated,
            error_count: stats.errors,
            error_log: errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null
        });

        return Response.json({
            success: true,
            stats,
            unmapped_skus: Array.from(unmappedSkus),
            error_samples: errorSamples,
            error_breakdown: {
                no_customer: stats.error_no_customer,
                no_date: stats.error_no_date,
                no_agent: stats.error_no_agent,
                other: stats.errors - stats.error_no_customer - stats.error_no_date - stats.error_no_agent
            },
            message: `✅ ${stats.created} נוצרו, ${stats.updated} עודכנו`
        });

    } catch (error) {
        console.error('❌', error);
        
        // Try to mark batch as failed
        try {
            const { batch_id } = await req.json();
            if (batch_id) {
                await base44.asServiceRole.entities.LineImportBatch.update(batch_id, {
                    status: 'FAILED',
                    error_log: error.message
                });
            }
        } catch {}

        return Response.json({ error: error.message }, { status: 500 });
    }
});