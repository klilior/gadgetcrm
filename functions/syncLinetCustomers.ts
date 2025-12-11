import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const BASE_URL = "https://app.linet.org.il/api";
const BATCH_SIZE = 200;
const MIN_SYNC_INTERVAL_HOURS = 24; // Don't refresh customers more than once per day

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

async function fetchLinetAccounts(credentials, accountIds) {
    const payload = {
        ...credentials,
        limit: BATCH_SIZE,
        offset: 0,
        query: { id: accountIds }
    };

    console.log(`📞 Fetching ${accountIds.length} accounts from Linet...`);

    const response = await fetch(`${BASE_URL}/newsearch/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Linet API Error ${response.status}: ${errorText}`);
    }

    const apiResponse = await response.json();

    if (apiResponse.errorCode && apiResponse.errorCode !== 0) {
        throw new Error(`Linet Error ${apiResponse.errorCode}: ${apiResponse.text || 'Unknown error'}`);
    }

    return apiResponse.body || [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const body = await req.json();
        const { account_ids, force_refresh = false } = body;

        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
            return Response.json({ error: 'חסר account_ids או רשימה ריקה' }, { status: 400 });
        }

        console.log(`🔄 Syncing ${account_ids.length} customers from Linet...`);

        // Get credentials
        const credentials = await getLinetCredentials(base44);

        // Filter out recently synced customers (unless force_refresh)
        let idsToSync = account_ids;
        if (!force_refresh) {
            const cutoffTime = new Date();
            cutoffTime.setHours(cutoffTime.getHours() - MIN_SYNC_INTERVAL_HOURS);
            const cutoffISO = cutoffTime.toISOString();

            // Get existing customers
            const existingCustomers = await base44.asServiceRole.entities.LinetCustomer.filter({
                linet_account_id: { $in: account_ids }
            }, null, 10000);

            const recentlySyncedIds = new Set(
                existingCustomers
                    .filter(c => c.last_synced_at && c.last_synced_at > cutoffISO)
                    .map(c => c.linet_account_id)
            );

            idsToSync = account_ids.filter(id => !recentlySyncedIds.has(id));
            console.log(`✅ Skipping ${recentlySyncedIds.size} recently synced, refreshing ${idsToSync.length}`);
        }

        if (idsToSync.length === 0) {
            return Response.json({
                success: true,
                message: 'All customers already synced recently',
                stats: { skipped: account_ids.length, synced: 0 }
            });
        }

        // Fetch in batches
        const stats = { created: 0, updated: 0, errors: 0, skipped: 0 };
        const errors = [];

        for (let i = 0; i < idsToSync.length; i += BATCH_SIZE) {
            const batchIds = idsToSync.slice(i, i + BATCH_SIZE);
            
            try {
                const accounts = await fetchLinetAccounts(credentials, batchIds);
                console.log(`📦 Received ${accounts.length} accounts from Linet`);

                for (const account of accounts) {
                    try {
                        const accountId = Number(account.id);
                        if (!accountId || isNaN(accountId)) {
                            console.warn('⚠️ Invalid account ID:', account);
                            stats.errors++;
                            continue;
                        }

                        // Map Linet fields to our schema
                        const customerData = {
                            linet_account_id: accountId,
                            linet_account_uuid: account.uuid || null,
                            name: account.name || account.company || account.company_name || 'Unknown',
                            phone_1: account.phone || account.phone1 || null,
                            phone_2: account.phone2 || null,
                            mobile: account.mobile || null,
                            email: account.email || null,
                            city: account.city || null,
                            address: account.address || account.full_address || null,
                            id_number: account.id_number || account.passport_id || null,
                            last_synced_at: new Date().toISOString(),
                            sync_error: null
                        };

                        // Check if exists
                        const existing = await base44.asServiceRole.entities.LinetCustomer.filter({
                            linet_account_id: accountId
                        }, null, 1);

                        if (existing.length > 0) {
                            await base44.asServiceRole.entities.LinetCustomer.update(
                                existing[0].id,
                                customerData
                            );
                            stats.updated++;
                        } else {
                            await base44.asServiceRole.entities.LinetCustomer.create(customerData);
                            stats.created++;
                        }

                    } catch (error) {
                        console.error(`❌ Error processing account ${account.id}:`, error.message);
                        stats.errors++;
                        errors.push({
                            account_id: account.id,
                            error: error.message
                        });

                        // Save error to customer record
                        try {
                            const existing = await base44.asServiceRole.entities.LinetCustomer.filter({
                                linet_account_id: Number(account.id)
                            }, null, 1);
                            if (existing.length > 0) {
                                await base44.asServiceRole.entities.LinetCustomer.update(existing[0].id, {
                                    sync_error: error.message,
                                    last_synced_at: new Date().toISOString()
                                });
                            }
                        } catch (e) {
                            // Ignore
                        }
                    }
                }

            } catch (batchError) {
                console.error(`❌ Batch error for IDs ${batchIds[0]}-${batchIds[batchIds.length-1]}:`, batchError.message);
                stats.errors += batchIds.length;
                errors.push({
                    batch: `${i}-${i+batchIds.length}`,
                    error: batchError.message
                });
            }
        }

        console.log(`✅ Customer sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.errors} errors`);

        return Response.json({
            success: true,
            stats,
            errors: errors.slice(0, 20), // Return first 20 errors
            message: `סונכרנו ${stats.created + stats.updated} לקוחות מלינט`
        });

    } catch (error) {
        console.error('❌ syncLinetCustomers error:', error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});