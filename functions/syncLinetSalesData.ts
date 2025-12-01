import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format, subDays } from 'npm:date-fns@2.30.0';

const BASE_URL = "https://app.linet.org.il/api";

function parseNum(value) {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value).replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

Deno.serve(async (req) => {
    console.log("🚀 Starting Final Sync Logic...");
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        // Parse request body for offset and optional overrides
        const body = await req.json().catch(() => ({}));
        const startOffset = body.offset || 0;
        const manualDateFrom = body.manual_date_from;
        const manualDateTo = body.manual_date_to;

        // ---------------------------------------------------------
        // 0. Credentials
        // ---------------------------------------------------------
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

        if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");

        // ---------------------------------------------------------
        // 1. Load Maps (Cache)
        // ---------------------------------------------------------
        console.log("📥 Loading caches...");
        
        // Category Translations: ID (num) -> Name (str)
        const transList = await base44.asServiceRole.entities.LinetCategoryTranslation.list(null, 1000); // Assuming < 1000 categories
        const categoryTranslationMap = {};
        transList.forEach(t => categoryTranslationMap[t.category_id] = t.category_name);
        
        // Product Map: SKU (str) -> Category Name (str)
        // We load ALL product maps to avoid DB lookups per line
        const productCache = {};
        let hasMoreMaps = true;
        let mapOffset = 0;
        let fixedMapsCount = 0;

        while (hasMoreMaps) {
            const maps = await base44.asServiceRole.entities.LinetProductMap.list(null, 1000, mapOffset);
            
            for (const m of maps) {
                if (!m.sku) continue;
                
                let finalName = m.linet_category_name;
                
                // FIX: Resolve category name if it looks like an ID or "Unknown Cat X"
                if (finalName) {
                    let idPart = null;
                    if (finalName.startsWith('Unknown Cat ')) idPart = finalName.replace('Unknown Cat ', '').trim();
                    else if (finalName.startsWith('cat_id:')) idPart = finalName.replace('cat_id:', '').trim();
                    else if (!isNaN(finalName)) idPart = finalName;

                    if (idPart && categoryTranslationMap[idPart]) {
                        finalName = categoryTranslationMap[idPart];
                        // Update the DB entry in background
                        base44.asServiceRole.entities.LinetProductMap.update(m.id, { linet_category_name: finalName });
                        fixedMapsCount++;
                    }
                }
                
                productCache[m.sku] = finalName;
            }

            if (maps.length < 1000) hasMoreMaps = false;
            else mapOffset += 1000;
        }
        console.log(`✅ Loaded ${Object.keys(productCache).length} products (Fixed ${fixedMapsCount} names) and ${Object.keys(categoryTranslationMap).length} categories.`);

        // Users Map for Sales Rep
        const usersList = await base44.asServiceRole.entities.LinetUsersMap.list(null, 1000);
        const usersMap = {};
        usersList.forEach(u => usersMap[String(u.user_id)] = u.user_name);

        // ---------------------------------------------------------
        // 2. Fetch Docs Loop
        // ---------------------------------------------------------
        const limit = 50; 
        let offset = startOffset;
        let moreData = true;
        let totalSaved = 0;
        let docsProcessed = 0;
        let apiCallsCount = 0;
        let skippedCounts = {};
        
        const startTime = Date.now();
        const MAX_EXECUTION_TIME = 25000; // 25 seconds

        // ---------------------------------------------------------
        // Determine Date Range (Incremental Sync)
        // ---------------------------------------------------------
        let dateFrom = manualDateFrom || '2025-12-01'; // Use manual or default (Dec 1st 2025)
        let dateTo = manualDateTo || format(new Date(), 'yyyy-MM-dd');

        if (!manualDateFrom) {
            try {
                // Step A: Find latest Issue_Date
                const lastTx = await base44.asServiceRole.entities.SalesTransaction.list("-issue_date", 1);
                if (lastTx && lastTx.length > 0 && lastTx[0].issue_date) {
                    dateFrom = lastTx[0].issue_date;
                    console.log(`📅 Incremental Sync: Found latest transaction date: ${dateFrom}`);
                } else {
                    console.log(`📅 First Run: Table is empty. Syncing from default start date: ${dateFrom}`);
                }
            } catch (e) {
                console.error("⚠️ Failed to fetch last transaction date, using default:", e);
            }
        } else {
            console.log(`📅 Manual Sync Override: Fetching from ${dateFrom} to ${dateTo}`);
        }

        while (moreData) {
            // Check Time Limit
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                console.log(`⚠️ Time limit reached at offset ${offset}.`);
                return Response.json({ 
                    success: true, 
                    partial: true, 
                    nextOffset: offset,
                    message: `Partial sync: Processed ${docsProcessed} docs. Continuing...`,
                    stats: { docs: docsProcessed, lines: totalSaved, apiCalls: apiCallsCount }
                });
            }

            const payload = {
                login_id,
                login_hash,
                login_company: Number(login_company),
                limit: limit,
                offset: offset,
                query: { 
                    issue_date: `${dateFrom} to ${dateTo}`,
                    doctype: ["9", "3"],
                    refstatus: null
                }
            };

            console.log(`📡 Fetching docs offset=${offset}... Query: ${JSON.stringify(payload.query)}`);
            
            const response = await fetch(`${BASE_URL}/newsearch/docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

            const apiResponse = await response.json();
            const documents = apiResponse.body;

            console.log(`📡 API Response Status: ${apiResponse.status}, Body Length: ${documents ? documents.length : 0}`);

            if (!Array.isArray(documents) || documents.length === 0) {
                console.log("⚠️ No documents found in this batch.");
                moreData = false;
                break;
            }

            console.log(`📦 Processing batch of ${documents.length} documents... First Doc ID: ${documents[0].id}`);

            // Prepare batch operations
            const operations = [];

            for (const doc of documents) {
                const raw_doctype = Number(doc.doctype);
                
                // Filter: Invoice-Receipt (9), Credit Memos (4), and Invoice (3)
                if (![3, 4, 9].includes(raw_doctype)) {
                    skippedCounts[raw_doctype] = (skippedCounts[raw_doctype] || 0) + 1;
                    continue;
                }

                const linet_doc_id = String(doc.id);
                const doc_number = String(doc.docnum);
                const issue_date = doc.issue_date ? doc.issue_date.split(' ')[0] : null;
                
                // Sales Rep
                let sales_rep_id = String(doc.owner);
                let sales_rep_name = usersMap[sales_rep_id] || sales_rep_id;

                // Customer Name
                let customer_name = doc.company_name || doc.account_name || doc.company || "General Customer";

                const is_credit = (raw_doctype === 4); // Only 4 is credit
                const doc_type_name = is_credit ? "חשבונית זיכוי" : "חשבונית מס קבלה";

                // Delete existing transaction for this doc to avoid duplicates
                // We'll do this asynchronously
                const existing = await base44.asServiceRole.entities.SalesTransaction.filter({ linet_doc_id: linet_doc_id });
                if (existing.length > 0) {
                     await Promise.all(existing.map(ex => base44.asServiceRole.entities.SalesTransaction.delete(ex.id)));
                }

                if (Array.isArray(doc.docDetailes)) {
                    for (const line of doc.docDetailes) {
                        let sku = line.sku || "";
                        let product_name = line.name || "";
                        let quantity = parseNum(line.qty);
                        let total_row_amount = parseNum(line.iTotalVat);
                        let price_ex_vat = parseNum(line.iTotal);
                        
                        // Unit price calculation
                        let unit_price = 0;
                        if (line.price) unit_price = parseNum(line.price);
                        else if (quantity !== 0) unit_price = total_row_amount / quantity;

                        // ---------------------------------------------------------
                        // 3. Identify Product & Category
                        // ---------------------------------------------------------
                        let category_name = "Uncategorized";

                        if (sku) {
                            // Step A: Check Cache
                            if (productCache[sku]) {
                                category_name = productCache[sku];
                            } else {
                                // Step B: API & Translate
                                console.log(`🔍 New SKU found: ${sku}, fetching info...`);
                                apiCallsCount++;

                                try {
                                    const itemPayload = {
                                        login_id,
                                        login_hash,
                                        login_company: Number(login_company),
                                        limit: 1,
                                        offset: 0,
                                        query: { sku: sku }
                                    };

                                    // Linet API usually expects POST for newsearch
                                    const itemRes = await fetch(`${BASE_URL}/newsearch/item`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(itemPayload)
                                    });

                                    if (itemRes.ok) {
                                        const itemData = await itemRes.json();
                                        if (itemData.body && itemData.body.length > 0) {
                                            const item = itemData.body[0];
                                            const cat_id = item.cat_id || item.category_id; // Check both fields
                                            
                                            if (cat_id) {
                                                if (categoryTranslationMap[cat_id]) {
                                                    category_name = categoryTranslationMap[cat_id];
                                                } else {
                                                    // Use a cleaner format if translation missing, but keep ID for later fix
                                                    category_name = `cat_id:${cat_id}`; 
                                                }
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.error(`Failed to fetch info for SKU ${sku}:`, err);
                                }

                                // Save to Cache (Memory + DB)
                                productCache[sku] = category_name;
                                await base44.asServiceRole.entities.LinetProductMap.create({
                                    sku: sku,
                                    linet_category_name: category_name,
                                    last_checked: new Date().toISOString()
                                });
                            }
                        }

                        // ---------------------------------------------------------
                        // 4. Map & Save Transaction
                        // ---------------------------------------------------------
                        
                        // Handle Credits
                        if (is_credit) {
                            quantity = Math.abs(quantity) * -1;
                            total_row_amount = Math.abs(total_row_amount) * -1;
                            price_ex_vat = Math.abs(price_ex_vat) * -1;
                        }

                        await base44.asServiceRole.entities.SalesTransaction.create({
                            linet_doc_id: linet_doc_id,
                            doc_number: doc_number,
                            doc_type: doc_type_name,
                            issue_date: issue_date,
                            sales_rep: sales_rep_name,
                            customer_name: customer_name,
                            sku: sku,
                            product_name: product_name,
                            quantity: quantity,
                            unit_price: unit_price,
                            total_row_amount: total_row_amount,
                            price_ex_vat: price_ex_vat,
                            category: category_name,
                            sync_timestamp: new Date().toISOString()
                        });
                        totalSaved++;
                    }
                }
                docsProcessed++;
            }

            if (documents.length < limit) {
                moreData = false;
            } else {
                offset += limit;
            }
        }

        console.log(`✅ Sync Success: Processed ${docsProcessed} docs. Skipped: ${JSON.stringify(skippedCounts)}`);

        return Response.json({ 
            success: true, 
            message: `Synced ${totalSaved} lines from ${docsProcessed} docs.\nSkipped types: ${JSON.stringify(skippedCounts)}`,
            stats: { docs: docsProcessed, lines: totalSaved, apiCalls: apiCallsCount, skipped: skippedCounts }
        });

    } catch (error) {
        console.error("❌ Sync Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});