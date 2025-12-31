import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format, subDays, parseISO, addMonths, addDays } from 'npm:date-fns@2.30.0';

const BASE_URL = "https://app.linet.org.il/api";
const SYNC_KEY = "linet_main_sync";
const MAX_EXECUTION_TIME = 50000; // 50 seconds
const BATCH_SIZE = 50;

/**
 * Core Linet sync function - used by hourly, nightly, and manual syncs
 * Idempotent and safe to re-run
 */

function parseNum(value) {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value).replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

async function getLinetCredentials(base44) {
    let login_id = Deno.env.get("LINET_LOGIN_ID");
    let login_hash = Deno.env.get("LINET_LOGIN_HASH");
    let login_company = Deno.env.get("LINET_LOGIN_COMPANY");

    if (!login_id || !login_hash || !login_company) {
        const settingsList = await base44.asServiceRole.entities.Settings.list();
        const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
        login_id = login_id || getSetting("LINET_LOGIN_ID");
        login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
        login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
    }

    if (!login_id || !login_hash || !login_company) {
        throw new Error("Missing Linet credentials");
    }

    return { login_id, login_hash, login_company: Number(login_company) };
}

async function loadCaches(base44) {
    console.log("📥 Loading caches...");
    
    // Category Translations
    const transList = await base44.asServiceRole.entities.LinetCategoryTranslation.list(null, 1000);
    const categoryTranslationMap = {};
    transList.forEach(t => categoryTranslationMap[t.category_id] = t.category_name);

    // Product Map
    const productCache = {};
    let hasMore = true;
    let offset = 0;
    while (hasMore) {
        const maps = await base44.asServiceRole.entities.LinetProductMap.list(null, 1000, offset);
        for (const m of maps) {
            if (!m.sku) continue;
            let finalName = m.linet_category_name;
            if (finalName) {
                let idPart = null;
                if (finalName.startsWith('Unknown Cat ')) idPart = finalName.replace('Unknown Cat ', '').trim();
                else if (finalName.startsWith('cat_id:')) idPart = finalName.replace('cat_id:', '').trim();
                else if (!isNaN(finalName)) idPart = finalName;
                if (idPart && categoryTranslationMap[idPart]) {
                    finalName = categoryTranslationMap[idPart];
                }
            }
            productCache[m.sku] = finalName;
        }
        if (maps.length < 1000) hasMore = false;
        else offset += 1000;
    }

    // Users Map
    const usersList = await base44.asServiceRole.entities.LinetUsersMap.list(null, 1000);
    const usersMap = {};
    usersList.forEach(u => usersMap[String(u.user_id)] = u.user_name);

    console.log(`✅ Loaded ${Object.keys(productCache).length} products, ${Object.keys(categoryTranslationMap).length} categories, ${Object.keys(usersMap).length} users`);

    return { categoryTranslationMap, productCache, usersMap };
}

async function fetchDocuments(credentials, dateFrom, dateTo, limit, offset) {
    const payload = {
        ...credentials,
        limit,
        offset,
        query: {
            issue_date: `${dateFrom} to ${dateTo}`,
            doctype: ["9", "3", "4"],
            refstatus: null
        }
    };

    const response = await fetch(`${BASE_URL}/newsearch/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Linet API Error ${response.status}: ${errorText}`);
    }
    
    const apiResponse = await response.json();
    
    // Check for Linet-specific errors
    if (apiResponse.errorCode && apiResponse.errorCode !== 0) {
        throw new Error(`Linet Error ${apiResponse.errorCode}: ${apiResponse.text || 'Unknown error'}`);
    }
    
    return apiResponse.body || [];
}

async function fetchProductCategory(credentials, sku, categoryTranslationMap) {
    try {
        const payload = {
            ...credentials,
            limit: 1,
            offset: 0,
            query: { sku }
        };

        const response = await fetch(`${BASE_URL}/newsearch/item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json();
            if (data.body && data.body.length > 0) {
                const cat_id = data.body[0].cat_id || data.body[0].category_id;
                if (cat_id) {
                    return categoryTranslationMap[cat_id] || `cat_id:${cat_id}`;
                }
            }
        }
    } catch (err) {
        console.error(`Failed to fetch category for SKU ${sku}:`, err.message);
    }
    return "Uncategorized";
}

async function upsertTransaction(base44, txData) {
    // Unique key: linet_doc_id + sku (to handle multiple lines per document)
    const existing = await base44.asServiceRole.entities.SalesTransaction.filter({
        linet_doc_id: txData.linet_doc_id,
        sku: txData.sku || ""
    }, null, 1);

    if (existing.length > 0) {
        await base44.asServiceRole.entities.SalesTransaction.update(existing[0].id, txData);
        return 'updated';
    } else {
        await base44.asServiceRole.entities.SalesTransaction.create(txData);
        return 'created';
    }
}

async function createLineContractFromSale(base44, sale, carrierCode, carrierName, carrierPolicy) {
    // Check if contract already exists for this invoice
    const existing = await base44.asServiceRole.entities.LineContract.filter({
        original_invoice_id: sale.linet_doc_id,
        customer_name: sale.customer_name
    }, null, 1);

    if (existing.length > 0) {
        return 'skipped'; // Already exists
    }

    // Calculate safe retarget date
    const activationDate = new Date(sale.issue_date);
    let safeDate = addMonths(activationDate, carrierPolicy.churn_window_months || 12);
    safeDate = addDays(safeDate, carrierPolicy.safety_buffer_days || 30);
    const safe_retarget_date = format(safeDate, 'yyyy-MM-dd');
    const today = new Date();
    const status = safeDate <= today ? 'ELIGIBLE' : 'LOCKED';

    // Find or create customer
    let customers = await base44.asServiceRole.entities.Client.filter({
        full_name: sale.customer_name
    }, null, 1);

    let customer_id;
    if (customers.length > 0) {
        customer_id = customers[0].id;
    } else {
        const newCustomer = await base44.asServiceRole.entities.Client.create({
            full_name: sale.customer_name,
            source: 'LINET_SYNC'
        });
        customer_id = newCustomer.id;
    }

    // Get agent ID from LinetUsersMap
    const agentMaps = await base44.asServiceRole.entities.LinetUsersMap.filter({
        user_name: sale.sales_rep
    }, null, 1);
    
    const agent_id = agentMaps.length > 0 ? agentMaps[0].user_id : sale.sales_rep;

    await base44.asServiceRole.entities.LineContract.create({
        customer_id,
        customer_name: sale.customer_name,
        linet_account_id: sale.linet_account_id,
        carrier_code: carrierCode,
        carrier_name: carrierName,
        activation_date: sale.issue_date,
        original_invoice_id: sale.linet_doc_id,
        agent_id,
        agent_name: sale.sales_rep,
        account_owner_id: agent_id,
        account_owner_name: sale.sales_rep,
        safe_retarget_date,
        status,
        last_action_date: new Date().toISOString(),
        last_action_type: 'SYNC_CREATED'
    });

    return 'created';
}

Deno.serve(async (req) => {
    const runStartedAt = new Date().toISOString();
    let syncLog = null;
    let base44 = null;

    try {
        base44 = createClientFromRequest(req);

        // Parse request
        let body = {};
        try {
            const text = await req.text();
            if (text && text.trim()) body = JSON.parse(text);
        } catch (e) {
            console.log("No request body, using defaults");
        }

        let fromDatetime = body.from_datetime;
        const toDatetime = body.to_datetime || new Date().toISOString();
        const triggerType = body.trigger_type || "MANUAL";
        const updateLastSuccessful = body.update_last_successful !== false;
        const createLineContracts = body.create_line_contracts !== false; // Auto-create line contracts

        // If no from_datetime, default to 1 day ago
        if (!fromDatetime) {
            fromDatetime = subDays(new Date(), 1).toISOString();
            console.log(`ℹ️ No from_datetime provided, defaulting to 1 day ago: ${fromDatetime}`);
        }

        console.log(`🚀 Starting Linet Sync: ${fromDatetime} → ${toDatetime} (${triggerType})`);

        // Create SyncLog entry
        syncLog = await base44.asServiceRole.entities.SyncLog.create({
            sync_key: SYNC_KEY,
            run_started_at: runStartedAt,
            status: "RUNNING",
            from_datetime: fromDatetime,
            to_datetime: toDatetime,
            trigger_type: triggerType,
            records_fetched: 0,
            records_created: 0,
            records_updated: 0,
            records_skipped: 0
        });

        // Update SyncMetadata to RUNNING
        const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
        let metadata = metadataList[0];
        if (metadata) {
            await base44.asServiceRole.entities.SyncMetadata.update(metadata.id, {
                status: "RUNNING",
                last_attempt: runStartedAt
            });
        } else {
            metadata = await base44.asServiceRole.entities.SyncMetadata.create({
                sync_key: SYNC_KEY,
                status: "RUNNING",
                last_attempt: runStartedAt,
                consecutive_failures: 0
            });
        }

        // Get credentials and caches
        const credentials = await getLinetCredentials(base44);
        const { categoryTranslationMap, productCache, usersMap } = await loadCaches(base44);

        // Load carrier mappings for line contract creation
        let carrierMappings = [];
        let carrierPolicies = {};
        if (createLineContracts) {
            carrierMappings = await base44.asServiceRole.entities.CarrierProductMapping
                .filter({ is_active: true }, '-priority', 200);
            const policiesList = await base44.asServiceRole.entities.CarrierPolicy
                .filter({ is_active: true });
            policiesList.forEach(p => carrierPolicies[p.carrier_code] = p);
        }

        // Date formatting for API
        const dateFrom = fromDatetime ? format(parseISO(fromDatetime), 'yyyy-MM-dd') : format(subDays(new Date(), 1), 'yyyy-MM-dd');
        const dateTo = format(parseISO(toDatetime), 'yyyy-MM-dd');

        let offset = 0;
        let moreData = true;
        let stats = { fetched: 0, created: 0, updated: 0, skipped: 0, line_contracts_created: 0 };
        const startTime = Date.now();
        const allDocuments = []; // Collect all documents for customer sync

        while (moreData) {
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                console.log(`⚠️ Time limit reached at offset ${offset}`);
                await base44.asServiceRole.entities.SyncLog.update(syncLog.id, {
                    run_finished_at: new Date().toISOString(),
                    status: "PARTIAL",
                    records_fetched: stats.fetched,
                    records_created: stats.created,
                    records_updated: stats.updated,
                    records_skipped: stats.skipped,
                    details_json: { stopped_at_offset: offset, line_contracts: stats.line_contracts_created }
                });

                await base44.asServiceRole.entities.SyncMetadata.update(metadata.id, {
                    status: "PARTIAL",
                    last_error_message: `Stopped at offset ${offset} due to time limit`
                });

                return Response.json({
                    success: true,
                    partial: true,
                    nextOffset: offset,
                    stats
                });
            }

            const documents = await fetchDocuments(credentials, dateFrom, dateTo, BATCH_SIZE, offset);
            
            if (!documents || documents.length === 0) {
                moreData = false;
                break;
            }

            stats.fetched += documents.length;
            allDocuments.push(...documents); // Save documents for customer sync
            console.log(`📦 Processing ${documents.length} documents at offset ${offset}`);

            for (const doc of documents) {
                const raw_doctype = Number(doc.doctype);
                if (![3, 4, 9].includes(raw_doctype)) {
                    stats.skipped++;
                    continue;
                }

                const linet_doc_id = String(doc.id);
                const doc_number = String(doc.docnum);
                const issue_date = doc.issue_date ? doc.issue_date.split(' ')[0] : null;
                const sales_rep_name = usersMap[String(doc.owner)] || String(doc.owner);
                const customer_name = doc.company_name || doc.account_name || doc.company || "General Customer";
                const linet_account_id = doc.account_id ? Number(doc.account_id) : null;
                const is_credit = (raw_doctype === 4);
                const doc_type_name = is_credit ? "חשבונית זיכוי" : "חשבונית מס קבלה";

                if (Array.isArray(doc.docDetailes)) {
                    for (const line of doc.docDetailes) {
                        const sku = line.sku || "";
                        const product_name = line.name || "";
                        let quantity = parseNum(line.qty);
                        let total_row_amount = parseNum(line.iTotalVat);
                        let price_ex_vat = parseNum(line.iTotal);
                        let unit_price = line.price ? parseNum(line.price) : (quantity !== 0 ? total_row_amount / quantity : 0);

                        // Get category
                        let category_name = "Uncategorized";
                        if (sku) {
                            if (productCache[sku]) {
                                category_name = productCache[sku];
                            } else {
                                category_name = await fetchProductCategory(credentials, sku, categoryTranslationMap);
                                productCache[sku] = category_name;
                                try {
                                    await base44.asServiceRole.entities.LinetProductMap.create({
                                        sku,
                                        linet_category_name: category_name,
                                        last_checked: new Date().toISOString()
                                    });
                                } catch (e) { /* ignore duplicate */ }
                            }
                        }

                        // Handle credits
                        if (is_credit) {
                            quantity = Math.abs(quantity) * -1;
                            total_row_amount = Math.abs(total_row_amount) * -1;
                            price_ex_vat = Math.abs(price_ex_vat) * -1;
                        }

                        const txData = {
                            linet_doc_id,
                            doc_number,
                            doc_type: doc_type_name,
                            issue_date,
                            sales_rep: sales_rep_name,
                            customer_name,
                            linet_account_id,
                            sku,
                            product_name,
                            quantity,
                            unit_price,
                            total_row_amount,
                            price_ex_vat,
                            category: category_name,
                            sync_timestamp: new Date().toISOString()
                        };

                        try {
                            const result = await upsertTransaction(base44, txData);
                            if (result === 'created') stats.created++;
                            else stats.updated++;

                            // Auto-create line contract if this is a line sale
                            if (createLineContracts && !is_credit && quantity > 0) {
                                const carrierCode = detectCarrier(sku, product_name, carrierMappings);
                                if (carrierCode && carrierPolicies[carrierCode]) {
                                    try {
                                        const contractResult = await createLineContractFromSale(
                                            base44,
                                            { ...txData, linet_doc_id },
                                            carrierCode,
                                            carrierPolicies[carrierCode].carrier_name,
                                            carrierPolicies[carrierCode]
                                        );
                                        if (contractResult === 'created') {
                                            stats.line_contracts_created++;
                                        }
                                    } catch (contractErr) {
                                        console.error(`Failed to create line contract: ${contractErr.message}`);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`Failed to upsert tx: ${err.message}`);
                            stats.skipped++;
                        }
                    }
                }
            }

            if (documents.length < BATCH_SIZE) {
                moreData = false;
            } else {
                offset += BATCH_SIZE;
            }
        }

        // Success - update log and metadata
        const runFinishedAt = new Date().toISOString();

        await base44.asServiceRole.entities.SyncLog.update(syncLog.id, {
            run_finished_at: runFinishedAt,
            status: "SUCCESS",
            records_fetched: stats.fetched,
            records_created: stats.created,
            records_updated: stats.updated,
            records_skipped: stats.skipped,
            details_json: { line_contracts_created: stats.line_contracts_created }
        });

        const metadataUpdate = {
            status: "SUCCESS",
            last_error_message: null,
            consecutive_failures: 0
        };
        if (updateLastSuccessful) {
            metadataUpdate.last_successful_sync = runFinishedAt;
        }
        await base44.asServiceRole.entities.SyncMetadata.update(metadata.id, metadataUpdate);

        console.log(`✅ Sync completed: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.line_contracts_created} line contracts`);

        // Sync customers for all account_ids seen in this sync
        let customerSyncStats = null;
        try {
            const uniqueAccountIds = [...new Set(
                allDocuments
                    .map(doc => doc.account_id)
                    .filter(id => id && !isNaN(Number(id)))
                    .map(id => Number(id))
            )];

            if (uniqueAccountIds.length > 0) {
                console.log(`👥 Attempting to sync ${uniqueAccountIds.length} customers...`);
                try {
                    const customerSync = await base44.asServiceRole.functions.invoke('syncLinetCustomers', {
                        account_ids: uniqueAccountIds,
                        force_refresh: false
                    });
                    customerSyncStats = customerSync.stats;
                    console.log(`✅ Customer sync: ${customerSyncStats?.created || 0} created, ${customerSyncStats?.updated || 0} updated`);
                } catch (invokeErr) {
                    console.log('⚠️ syncLinetCustomers not available or failed:', invokeErr.message);
                }
            }
        } catch (customerErr) {
            console.log('⚠️ Customer sync skipped:', customerErr.message);
        }

        return Response.json({
            success: true,
            stats,
            customer_sync: customerSyncStats,
            message: `סנכרון הושלם: ${stats.created} נוצרו, ${stats.updated} עודכנו, ${stats.line_contracts_created} חוזי קווים${customerSyncStats ? `, ${customerSyncStats.created + customerSyncStats.updated} לקוחות` : ''}`
        });

    } catch (error) {
        console.error("❌ Sync Error:", error);

        const errorMessage = error?.message || error?.toString() || String(error);
        console.error("Error details:", errorMessage);

        // Update log and metadata on failure
        if (base44 && syncLog) {
            try {
                await base44.asServiceRole.entities.SyncLog.update(syncLog.id, {
                    run_finished_at: new Date().toISOString(),
                    status: "FAILED",
                    error_message: errorMessage
                });

                const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
                if (metadataList[0]) {
                    const currentFailures = metadataList[0].consecutive_failures || 0;
                    await base44.asServiceRole.entities.SyncMetadata.update(metadataList[0].id, {
                        status: "FAILED",
                        last_error_message: errorMessage,
                        consecutive_failures: currentFailures + 1
                    });
                }
                } catch (e) {
                console.error("Failed to update sync status:", e);
                }
                }

                return Response.json({ 
                success: false, 
                error: errorMessage,
                details: error?.stack || ''
                }, { status: 500 });
                }
});

// Helper to detect carrier from product
function detectCarrier(sku, productName, mappings) {
    if (!mappings || mappings.length === 0) return null;

    // Exact SKU
    if (sku) {
        const exactMatch = mappings.find(m => m.product_sku_exact === sku);
        if (exactMatch) return exactMatch.carrier_code;
    }

    // SKU prefix
    if (sku) {
        const prefixMatch = mappings.find(m => 
            m.product_sku_prefix && sku.startsWith(m.product_sku_prefix)
        );
        if (prefixMatch) return prefixMatch.carrier_code;
    }

    // Name contains
    if (productName) {
        const nameMatch = mappings.find(m => 
            m.name_contains && productName.toLowerCase().includes(m.name_contains.toLowerCase())
        );
        if (nameMatch) return nameMatch.carrier_code;
    }

    return null;
}