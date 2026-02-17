import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BASE_URL = "https://app.linet.org.il/api";
const BATCH_SIZE = 200;
const MIN_SYNC_INTERVAL_HOURS = 24;

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.startsWith('+972')) cleaned = '0' + cleaned.slice(4);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
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

// Find or create a Client record from Linet account data
async function upsertClientFromLinetAccount(sr, account) {
    const accountId = Number(account.id);
    const phone = normalizePhone(account.mobile) || normalizePhone(account.phone) || normalizePhone(account.phone2);
    const email = account.email || null;
    const name = account.name || account.company || account.company_name || 'לקוח לינט';
    const city = account.city || null;
    const address = account.address || account.full_address || null;

    // 1. Try by linet_account_id
    const byLinetId = await sr.Client.filter({ linet_account_id: accountId }, null, 1);
    if (byLinetId.length > 0) {
        const updates = {};
        if (phone && !byLinetId[0].phone) updates.phone = phone;
        if (email && !byLinetId[0].email) updates.email = email;
        if (city && !byLinetId[0].city) updates.city = city;
        if (address && !byLinetId[0].full_address) updates.full_address = address;
        if (!byLinetId[0].full_name || byLinetId[0].full_name === 'לקוח חדש') updates.full_name = name;
        if (Object.keys(updates).length > 0) {
            await sr.Client.update(byLinetId[0].id, updates);
            return { action: 'enriched', clientId: byLinetId[0].id };
        }
        return { action: 'exists', clientId: byLinetId[0].id };
    }

    // 2. Try by phone
    if (phone) {
        const byPhone = await sr.Client.filter({ phone }, null, 1);
        if (byPhone.length > 0) {
            const updates = { linet_account_id: accountId };
            if (email && !byPhone[0].email) updates.email = email;
            if (city && !byPhone[0].city) updates.city = city;
            if (address && !byPhone[0].full_address) updates.full_address = address;
            await sr.Client.update(byPhone[0].id, updates);
            return { action: 'linked', clientId: byPhone[0].id };
        }
    }

    // 3. Try by email
    if (email) {
        const byEmail = await sr.Client.filter({ email }, null, 1);
        if (byEmail.length > 0) {
            const updates = { linet_account_id: accountId };
            if (phone && !byEmail[0].phone) updates.phone = phone;
            if (city && !byEmail[0].city) updates.city = city;
            if (address && !byEmail[0].full_address) updates.full_address = address;
            await sr.Client.update(byEmail[0].id, updates);
            return { action: 'linked', clientId: byEmail[0].id };
        }
    }

    // 4. Create new client
    const newClient = await sr.Client.create({
        full_name: name,
        phone: phone || null,
        email: email || null,
        city: city || null,
        full_address: address || null,
        linet_account_id: accountId,
        source: 'Linet',
    });
    return { action: 'created', clientId: newClient.id };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;

        const body = await req.json();
        const { account_ids, force_refresh = false } = body;

        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
            return Response.json({ error: 'חסר account_ids או רשימה ריקה' }, { status: 400 });
        }

        console.log(`🔄 Syncing ${account_ids.length} customers from Linet...`);
        const credentials = await getLinetCredentials(base44);

        // Filter out recently synced (unless force)
        let idsToSync = account_ids;
        if (!force_refresh) {
            const cutoffTime = new Date();
            cutoffTime.setHours(cutoffTime.getHours() - MIN_SYNC_INTERVAL_HOURS);
            const cutoffISO = cutoffTime.toISOString();

            const existingCustomers = await sr.LinetCustomer.filter({
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

        const stats = { created: 0, updated: 0, errors: 0, skipped: 0, clients_created: 0, clients_linked: 0, clients_enriched: 0 };
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
                            stats.errors++;
                            continue;
                        }

                        // 1. Upsert LinetCustomer record
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

                        const existing = await sr.LinetCustomer.filter({ linet_account_id: accountId }, null, 1);
                        if (existing.length > 0) {
                            await sr.LinetCustomer.update(existing[0].id, customerData);
                            stats.updated++;
                        } else {
                            await sr.LinetCustomer.create(customerData);
                            stats.created++;
                        }

                        // 2. Also upsert the main Client record (CRM entity)
                        try {
                            const clientResult = await upsertClientFromLinetAccount(sr, account);
                            if (clientResult.action === 'created') stats.clients_created++;
                            else if (clientResult.action === 'linked') stats.clients_linked++;
                            else if (clientResult.action === 'enriched') stats.clients_enriched++;
                        } catch (clientErr) {
                            console.warn(`⚠️ Client upsert failed for account ${accountId}: ${clientErr.message}`);
                        }

                    } catch (error) {
                        console.error(`❌ Error processing account ${account.id}:`, error.message);
                        stats.errors++;
                        errors.push({ account_id: account.id, error: error.message });

                        try {
                            const existing = await sr.LinetCustomer.filter({ linet_account_id: Number(account.id) }, null, 1);
                            if (existing.length > 0) {
                                await sr.LinetCustomer.update(existing[0].id, {
                                    sync_error: error.message,
                                    last_synced_at: new Date().toISOString()
                                });
                            }
                        } catch (_e) {}
                    }
                }
            } catch (batchError) {
                console.error(`❌ Batch error:`, batchError.message);
                stats.errors += batchIds.length;
                errors.push({ batch: `${i}-${i+batchIds.length}`, error: batchError.message });
            }
        }

        console.log(`✅ Customer sync complete: ${stats.created} LinetCustomer created, ${stats.updated} updated, ${stats.clients_created} Client created, ${stats.clients_linked} linked, ${stats.clients_enriched} enriched`);

        return Response.json({
            success: true,
            stats,
            errors: errors.slice(0, 20),
            message: `סונכרנו ${stats.created + stats.updated} לקוחות מלינט (${stats.clients_created} חדשים ב-CRM)`
        });

    } catch (error) {
        console.error('❌ syncLinetCustomers error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});