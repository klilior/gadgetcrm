import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { resolveOrCreateCustomer, PRODUCERS } from '../../shared/customerIdentity.ts';
import { resolveCorrelationId } from '../../shared/correlation.ts';

const BASE_URL = "https://app.linet.org.il/api";
const BATCH_SIZE = 200;
const MIN_SYNC_INTERVAL_HOURS = 24;

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

async function linetSearchAccounts(credentials, query) {
    const response = await fetch(`${BASE_URL}/newsearch/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, limit: BATCH_SIZE, offset: 0, query })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Linet API Error ${response.status}: ${errorText}`);
    }

    const apiResponse = await response.json();
    if (apiResponse.errorCode && apiResponse.errorCode !== 0) {
        throw new Error(`Linet Error ${apiResponse.errorCode}: ${apiResponse.text || 'Unknown error'}`);
    }
    return Array.isArray(apiResponse.body) ? apiResponse.body : null;
}

/**
 * Linet's account search rejects an array of ids ("מזהה חייב להיות מספר שלם"), which previously
 * made the whole batch fail silently. Try the batch query, then fall back to per-id lookups.
 */
async function fetchLinetAccounts(credentials, accountIds) {
    console.log(`📞 Fetching ${accountIds.length} accounts from Linet...`);
    const batch = await linetSearchAccounts(credentials, { id: accountIds }).catch(() => null);
    if (batch) return batch;

    const accounts = [];
    for (const id of accountIds) {
        const single = await linetSearchAccounts(credentials, { id: Number(id) }).catch(() => null);
        if (single) accounts.push(...single);
    }
    return accounts;
}

/**
 * BATCH 2 — Linet is now a thin producer.
 * It owns no matching logic, no phone normalization and no direct Client.create.
 * The Linet account ID is the PRIMARY external identity; phone never overrides it.
 */
async function resolveClientForLinetAccount(base44, account, correlation_id, dryRun) {
    const accountId = Number(account.id);
    const rawPhone = account.mobile || account.phone || account.phone1 || account.phone2 || null;
    const name = account.name || account.company || account.company_name || 'לקוח לינט';
    const city = account.city || null;
    const address = account.address || account.full_address || null;

    return await resolveOrCreateCustomer(
        base44,
        {
            producer: PRODUCERS.LINET_SYNC,
            phone: rawPhone,
            email: account.email || null,
            name,
            linet_account_id: accountId,
            source_record_id: `LINET_ACCOUNT_${accountId}`,
            correlation_id,
            dry_run: dryRun,
        },
        {
            full_name: name,
            phone: rawPhone,
            email: account.email || null,
            city,
            full_address: address,
            source: 'Linet',
        },
    );
}

/** Enrich empty CRM fields only — Linet never overwrites existing customer identity data. */
async function enrichClient(sr, clientId, account) {
    const client = await sr.Client.get(clientId).catch(() => null);
    if (!client) return false;
    const updates = {};
    const rawPhone = account.mobile || account.phone || account.phone1 || account.phone2 || null;
    const name = account.name || account.company || account.company_name || null;
    if (rawPhone && !client.phone) updates.phone = rawPhone;
    if (account.email && !client.email) updates.email = account.email;
    if (account.city && !client.city) updates.city = account.city;
    const address = account.address || account.full_address || null;
    if (address && !client.full_address) updates.full_address = address;
    if (name && (!client.full_name || client.full_name === 'לקוח חדש')) updates.full_name = name;
    if (client.linet_account_id == null) updates.linet_account_id = Number(account.id);
    if (Object.keys(updates).length === 0) return false;
    await sr.Client.update(clientId, updates);
    return true;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;

        const body = await req.json();
        const { account_ids, force_refresh = false, dry_run = false } = body;

        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
            return Response.json({ error: 'חסר account_ids או רשימה ריקה' }, { status: 400 });
        }

        const correlation_id = resolveCorrelationId(req, body.correlation_id, 'linet_customer_sync');
        console.log(`🔄 Syncing ${account_ids.length} customers from Linet...`);
        const credentials = await getLinetCredentials(base44);

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

        const stats = {
            created: 0, updated: 0, errors: 0, skipped: 0,
            // identity metrics (producer = LINET_SYNC)
            processed: 0, matched: 0, clients_created: 0, clients_enriched: 0,
            ambiguous: 0, blocked: 0, external_id_conflicts: 0,
        };
        const errors = [];
        const unresolved = [];

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

                        // 1. LinetCustomer mirror (unchanged, not an identity record)
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
                            if (!dry_run) await sr.LinetCustomer.update(existing[0].id, customerData);
                            stats.updated++;
                        } else {
                            if (!dry_run) await sr.LinetCustomer.create(customerData);
                            stats.created++;
                        }

                        // 2. Canonical Client identity — via the central service only
                        stats.processed++;
                        const result = await resolveClientForLinetAccount(base44, account, correlation_id, dry_run);

                        if (result.status === 'MATCHED' && result.client_id) {
                            if (result.created) {
                                stats.clients_created++;
                            } else {
                                stats.matched++;
                                if (!dry_run && await enrichClient(sr, result.client_id, account)) stats.clients_enriched++;
                            }
                        } else if (result.status === 'AMBIGUOUS') {
                            stats.ambiguous++;
                            if (result.data_conflict) stats.external_id_conflicts++;
                            unresolved.push({ account_id: accountId, status: result.status, evidence: result.evidence });
                        } else {
                            stats.blocked++;
                            unresolved.push({ account_id: accountId, status: result.status, reason: result.blocked_reason || null, evidence: result.evidence });
                        }
                    } catch (error) {
                        console.error(`❌ Error processing account ${account.id}:`, error.message);
                        stats.errors++;
                        errors.push({ account_id: account.id, error: error.message });

                        try {
                            const existing = await sr.LinetCustomer.filter({ linet_account_id: Number(account.id) }, null, 1);
                            if (existing.length > 0 && !dry_run) {
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
                errors.push({ batch: `${i}-${i + batchIds.length}`, error: batchError.message });
            }
        }

        console.log(`✅ Linet customer sync: ${stats.matched} matched, ${stats.clients_created} created, ${stats.ambiguous} ambiguous, ${stats.blocked} blocked`);

        return Response.json({
            success: true,
            dry_run,
            correlation_id,
            stats,
            unresolved: unresolved.slice(0, 25),
            errors: errors.slice(0, 20),
            message: `סונכרנו ${stats.created + stats.updated} לקוחות מלינט (${stats.clients_created} חדשים ב-CRM, ${stats.ambiguous} דו-משמעיים)`
        });

    } catch (error) {
        console.error('❌ syncLinetCustomers error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});