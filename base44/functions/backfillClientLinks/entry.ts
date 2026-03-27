import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * Backfill client_id on SalesTransactions that are missing it,
 * and recalculate client stats (total_spent, total_orders, last_interaction_date).
 * 
 * Payload options:
 *   mode: "link" (default) - link orphan transactions to clients
 *   mode: "stats" - recalculate stats for all clients with linet_account_id
 *   mode: "both" - do both
 *   from_date: optional, e.g. "2026-03-01"
 *   limit: optional, max transactions to process (default 500)
 */

function normalizePhoneNumber(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
    else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('0972') && digits.length > 12) digits = '0' + digits.slice(4);
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    return null;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retryOnRateLimit(fn, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) {
            if (e.message && e.message.includes('429') && i < retries - 1) {
                await delay(Math.min((i + 1) * 3000, 15000));
            } else throw e;
        }
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const mode = body.mode || 'both';
        const fromDate = body.from_date || '2026-03-01';
        const maxLimit = body.limit || 500;

        const stats = { linked: 0, created: 0, skipped: 0, errors: 0, clients_updated: 0 };

        // ---- STEP 1: Link orphan SalesTransactions to clients ----
        if (mode === 'link' || mode === 'both') {
            console.log(`🔗 Step 1: Linking orphan transactions from ${fromDate}...`);

            let offset = 0;
            let processed = 0;

            while (processed < maxLimit) {
                const orphans = await retryOnRateLimit(() =>
                    base44.asServiceRole.entities.SalesTransaction.filter(
                        { issue_date: { $gte: fromDate }, client_id: null },
                        'issue_date',
                        50,
                        offset
                    )
                );

                if (!orphans || orphans.length === 0) break;

                // Group by linet_account_id to avoid duplicate lookups
                const byAccount = {};
                for (const tx of orphans) {
                    const aid = tx.linet_account_id;
                    if (!aid) { stats.skipped++; continue; }
                    if (!byAccount[aid]) byAccount[aid] = [];
                    byAccount[aid].push(tx);
                }

                for (const [accountId, txs] of Object.entries(byAccount)) {
                    try {
                        // Find client by linet_account_id
                        let clients = await retryOnRateLimit(() =>
                            base44.asServiceRole.entities.Client.filter(
                                { linet_account_id: Number(accountId) }, null, 1
                            )
                        );

                        let clientId = clients.length > 0 ? clients[0].id : null;

                        // If not found, try to find by name
                        if (!clientId && txs[0].customer_name) {
                            const byName = await retryOnRateLimit(() =>
                                base44.asServiceRole.entities.Client.filter(
                                    { full_name: txs[0].customer_name }, null, 1
                                )
                            );
                            if (byName.length > 0) {
                                clientId = byName[0].id;
                                // Also link the linet_account_id
                                if (!byName[0].linet_account_id) {
                                    await retryOnRateLimit(() =>
                                        base44.asServiceRole.entities.Client.update(byName[0].id, {
                                            linet_account_id: Number(accountId)
                                        })
                                    );
                                }
                            }
                        }

                        // If still not found, create client
                        if (!clientId) {
                            const newClient = await retryOnRateLimit(() =>
                                base44.asServiceRole.entities.Client.create({
                                    full_name: txs[0].customer_name || 'לקוח לינט',
                                    linet_account_id: Number(accountId),
                                    source: 'Linet_Backfill'
                                })
                            );
                            clientId = newClient.id;
                            stats.created++;
                        }

                        // Update all transactions for this account
                        for (const tx of txs) {
                            await retryOnRateLimit(() =>
                                base44.asServiceRole.entities.SalesTransaction.update(tx.id, {
                                    client_id: clientId
                                })
                            );
                            stats.linked++;
                            processed++;
                            await delay(500);
                        }

                        await delay(1000);
                    } catch (err) {
                        console.error(`❌ Error for account ${accountId}:`, err.message);
                        stats.errors++;
                        stats.skipped += txs.length;
                        processed += txs.length;
                    }
                }

                if (orphans.length < 50) break;
                offset += orphans.length;
            }

            console.log(`✅ Linking done: ${stats.linked} linked, ${stats.created} clients created`);
        }

        // ---- STEP 2: Recalculate client stats ----
        if (mode === 'stats' || mode === 'both') {
            console.log('📊 Step 2: Recalculating client stats...');

            // Get all clients that have linet_account_id
            let clientOffset = 0;
            let totalClients = 0;

            while (true) {
                const clients = await retryOnRateLimit(() =>
                    base44.asServiceRole.entities.Client.filter(
                        { linet_account_id: { $ne: null } },
                        null, 50, clientOffset
                    )
                );

                if (!clients || clients.length === 0) break;

                for (const client of clients) {
                    try {
                        // Get all transactions for this client
                        const txs = await retryOnRateLimit(() =>
                            base44.asServiceRole.entities.SalesTransaction.filter(
                                { client_id: client.id }, null, 10000
                            )
                        );

                        if (txs.length === 0) continue;

                        // Calculate stats
                        let totalSpent = 0;
                        const docNumbers = new Set();
                        let lastDate = null;

                        for (const tx of txs) {
                            totalSpent += (tx.total_row_amount || 0);
                            docNumbers.add(tx.doc_number);
                            const txDate = tx.issue_date || tx.sync_timestamp;
                            if (txDate && (!lastDate || txDate > lastDate)) {
                                lastDate = txDate;
                            }
                        }

                        const updates = {
                            total_spent: Math.round(totalSpent * 100) / 100,
                            total_orders: docNumbers.size,
                        };
                        if (lastDate) {
                            updates.last_interaction_date = new Date(lastDate).toISOString();
                        }

                        // Only update if changed
                        if (updates.total_spent !== (client.total_spent || 0) ||
                            updates.total_orders !== (client.total_orders || 0)) {
                            await retryOnRateLimit(() =>
                                base44.asServiceRole.entities.Client.update(client.id, updates)
                            );
                            stats.clients_updated++;
                        }

                        totalClients++;
                        await delay(100);
                    } catch (err) {
                        console.error(`❌ Stats error for client ${client.id}:`, err.message);
                    }
                }

                if (clients.length < 50) break;
                clientOffset += clients.length;
            }

            console.log(`✅ Stats done: ${stats.clients_updated} clients updated out of ${totalClients}`);
        }

        return Response.json({
            success: true,
            stats,
            message: `Backfill: ${stats.linked} linked, ${stats.created} created, ${stats.clients_updated} stats updated`
        });

    } catch (error) {
        console.error('❌ backfillClientLinks error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});