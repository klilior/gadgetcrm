import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format, subDays, parseISO } from 'npm:date-fns@2.30.0';

const BASE_URL = "https://app.linet.org.il/api";
const SYNC_KEY = "linet_main_sync";

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

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const apiResponse = await response.json();
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
    // Find existing by linet_doc_id + sku combination for uniqueness
    const existing = await base44.asServiceRole.entities.SalesTransaction.filter({
        linet_doc_id: txData.linet_doc_id,
        sku: txData.sku || ""
    });

    if (existing.length > 0) {
        await base44.asServiceRole.entities.SalesTransaction.update(existing[0].id, txData);
        return 'updated';
    } else {
        await base44.asServiceRole.entities.SalesTransaction.create(txData);
        return 'created';
    }
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

        // If no from_datetime provided, default to 1 day ago
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

        // Date formatting for API
        const dateFrom = fromDatetime ? format(parseISO(fromDatetime), 'yyyy-MM-dd') : format(subDays(new Date(), 1), 'yyyy-MM-dd');
        const dateTo = format(parseISO(toDatetime), 'yyyy-MM-dd');

        let offset = 0;
        const limit = 50;
        let moreData = true;
        let stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
        const MAX_TIME = 50000; // 50 seconds
        const startTime = Date.now();

        while (moreData) {
            if (Date.now() - startTime > MAX_TIME) {
                console.log(`⚠️ Time limit reached at offset ${offset}`);
                // Update log as partial
                await base44.asServiceRole.entities.SyncLog.update(syncLog.id, {
                    run_finished_at: new Date().toISOString(),
                    status: "PARTIAL",
                    records_fetched: stats.fetched,
                    records_created: stats.created,
                    records_updated: stats.updated,
                    records_skipped: stats.skipped,
                    details_json: { stopped_at_offset: offset }
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

            const documents = await fetchDocuments(credentials, dateFrom, dateTo, limit, offset);
            
            if (!documents || documents.length === 0) {
                moreData = false;
                break;
            }

            stats.fetched += documents.length;
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
                        } catch (err) {
                            console.error(`Failed to upsert tx: ${err.message}`);
                            stats.skipped++;
                        }
                    }
                }
            }

            if (documents.length < limit) {
                moreData = false;
            } else {
                offset += limit;
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
            records_skipped: stats.skipped
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

        console.log(`✅ Sync completed: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`);

        return Response.json({
            success: true,
            stats,
            message: `סנכרון הושלם: ${stats.created} נוצרו, ${stats.updated} עודכנו`
        });

    } catch (error) {
        console.error("❌ Sync Error:", error.message);

        // Update log and metadata on failure
        if (base44 && syncLog) {
            try {
                await base44.asServiceRole.entities.SyncLog.update(syncLog.id, {
                    run_finished_at: new Date().toISOString(),
                    status: "FAILED",
                    error_message: error.message
                });

                const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
                if (metadataList[0]) {
                    const currentFailures = metadataList[0].consecutive_failures || 0;
                    await base44.asServiceRole.entities.SyncMetadata.update(metadataList[0].id, {
                        status: "FAILED",
                        last_error_message: error.message,
                        consecutive_failures: currentFailures + 1
                    });
                }
            } catch (e) {
                console.error("Failed to update sync status:", e.message);
            }
        }

        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});