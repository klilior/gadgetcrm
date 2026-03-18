import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * Nightly Backfill - runs in small chunks to avoid timeouts.
 * Designed to be called every 10 minutes between 01:00-06:00.
 * 
 * Uses SyncMetadata (key: "nightly_backfill") to track progress.
 * Each run processes a small batch (~30 orphans or ~30 client stats),
 * then saves its position so the next run continues from there.
 * 
 * Phase 1: Link orphan SalesTransactions (missing client_id) to clients
 * Phase 2: Recalculate client stats (total_spent, total_orders, etc.)
 * Phase 3: Done for tonight - resets for next night
 */

const SYNC_KEY = "nightly_backfill";
const LINK_BATCH = 30;     // orphan transactions per run
const STATS_BATCH = 25;    // clients to recalc per run

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retryOnRateLimit(fn, retries = 6) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) {
            if (e.message?.includes('429') && i < retries - 1) {
                await delay(Math.min((i + 1) * 4000, 20000));
            } else throw e;
        }
    }
}

async function getOrCreateMeta(sr) {
    const list = await sr.SyncMetadata.filter({ sync_key: SYNC_KEY }, null, 1);
    if (list.length > 0) return list[0];
    return await sr.SyncMetadata.create({
        sync_key: SYNC_KEY,
        status: "IDLE",
        last_attempt: new Date().toISOString(),
        consecutive_failures: 0,
        last_error_message: JSON.stringify({
            phase: "link",          // "link" | "stats" | "done"
            link_offset: 0,
            stats_offset: 0,
            tonight_date: "",       // YYYY-MM-DD of current night's run
            total_linked: 0,
            total_stats_updated: 0,
            total_clients_created: 0,
        })
    });
}

function parseProgress(meta) {
    try {
        const data = JSON.parse(meta.last_error_message || '{}');
        return {
            phase: data.phase || "link",
            link_offset: data.link_offset || 0,
            stats_offset: data.stats_offset || 0,
            tonight_date: data.tonight_date || "",
            total_linked: data.total_linked || 0,
            total_stats_updated: data.total_stats_updated || 0,
            total_clients_created: data.total_clients_created || 0,
        };
    } catch {
        return { phase: "link", link_offset: 0, stats_offset: 0, tonight_date: "", total_linked: 0, total_stats_updated: 0, total_clients_created: 0 };
    }
}

async function saveProgress(sr, metaId, progress, status = "RUNNING") {
    await retryOnRateLimit(() => sr.SyncMetadata.update(metaId, {
        status,
        last_attempt: new Date().toISOString(),
        last_error_message: JSON.stringify(progress),
    }));
}

// ---- Phase 1: Link orphan transactions ----
async function runLinkPhase(sr, progress) {
    const orphans = await retryOnRateLimit(() =>
        sr.SalesTransaction.filter(
            { client_id: null },
            'issue_date',
            LINK_BATCH,
            progress.link_offset
        )
    );

    if (!orphans || orphans.length === 0) {
        // No more orphans - move to stats phase
        console.log(`✅ Link phase complete. Total linked: ${progress.total_linked}, created: ${progress.total_clients_created}`);
        return { ...progress, phase: "stats", stats_offset: 0 };
    }

    console.log(`🔗 Processing ${orphans.length} orphans (offset ${progress.link_offset})...`);

    // Group by linet_account_id
    const byAccount = {};
    let skipped = 0;
    for (const tx of orphans) {
        const aid = tx.linet_account_id;
        if (!aid) { skipped++; continue; }
        if (!byAccount[aid]) byAccount[aid] = [];
        byAccount[aid].push(tx);
    }

    let linked = 0;
    let created = 0;

    for (const [accountId, txs] of Object.entries(byAccount)) {
        try {
            // Find client by linet_account_id
            let clients = await retryOnRateLimit(() =>
                sr.Client.filter({ linet_account_id: Number(accountId) }, null, 1)
            );
            let clientId = clients.length > 0 ? clients[0].id : null;

            // Try by name
            if (!clientId && txs[0].customer_name) {
                const byName = await retryOnRateLimit(() =>
                    sr.Client.filter({ full_name: txs[0].customer_name }, null, 1)
                );
                if (byName.length > 0) {
                    clientId = byName[0].id;
                    if (!byName[0].linet_account_id) {
                        await retryOnRateLimit(() =>
                            sr.Client.update(byName[0].id, { linet_account_id: Number(accountId) })
                        );
                    }
                }
            }

            // Create if not found
            if (!clientId) {
                const newClient = await retryOnRateLimit(() =>
                    sr.Client.create({
                        full_name: txs[0].customer_name || 'לקוח לינט',
                        linet_account_id: Number(accountId),
                        source: 'Linet_Backfill'
                    })
                );
                clientId = newClient.id;
                created++;
            }

            // Link all txs
            for (const tx of txs) {
                await retryOnRateLimit(() =>
                    sr.SalesTransaction.update(tx.id, { client_id: clientId })
                );
                linked++;
                await delay(400);
            }

            await delay(800);
        } catch (err) {
            console.error(`❌ Error account ${accountId}: ${err.message}`);
        }
    }

    const newOffset = progress.link_offset + orphans.length;
    console.log(`✅ Chunk done: ${linked} linked, ${created} created (next offset: ${newOffset})`);

    // If we got less than a full batch, we're done with linking
    const nextPhase = orphans.length < LINK_BATCH ? "stats" : "link";

    return {
        ...progress,
        phase: nextPhase,
        link_offset: newOffset,
        stats_offset: nextPhase === "stats" ? 0 : progress.stats_offset,
        total_linked: progress.total_linked + linked,
        total_clients_created: progress.total_clients_created + created,
    };
}

// ---- Phase 2: Recalculate client stats ----
async function runStatsPhase(sr, progress) {
    const clients = await retryOnRateLimit(() =>
        sr.Client.filter(
            { linet_account_id: { $ne: null } },
            null, STATS_BATCH, progress.stats_offset
        )
    );

    if (!clients || clients.length === 0) {
        console.log(`✅ Stats phase complete. Total updated: ${progress.total_stats_updated}`);
        return { ...progress, phase: "done" };
    }

    console.log(`📊 Processing stats for ${clients.length} clients (offset ${progress.stats_offset})...`);

    let updated = 0;

    for (const client of clients) {
        try {
            const txs = await retryOnRateLimit(() =>
                sr.SalesTransaction.filter({ client_id: client.id }, null, 10000)
            );

            if (txs.length === 0) { await delay(200); continue; }

            let totalSpent = 0;
            const docNumbers = new Set();
            let lastDate = null;

            for (const tx of txs) {
                totalSpent += (tx.total_row_amount || 0);
                docNumbers.add(tx.doc_number);
                const txDate = tx.issue_date || tx.sync_timestamp;
                if (txDate && (!lastDate || txDate > lastDate)) lastDate = txDate;
            }

            const newSpent = Math.round(totalSpent * 100) / 100;
            const newOrders = docNumbers.size;

            if (newSpent !== (client.total_spent || 0) || newOrders !== (client.total_orders || 0)) {
                const updates = { total_spent: newSpent, total_orders: newOrders };
                if (lastDate) updates.last_interaction_date = new Date(lastDate).toISOString();
                await retryOnRateLimit(() => sr.Client.update(client.id, updates));
                updated++;
            }

            await delay(300);
        } catch (err) {
            console.error(`❌ Stats error client ${client.id}: ${err.message}`);
        }
    }

    const newOffset = progress.stats_offset + clients.length;
    const nextPhase = clients.length < STATS_BATCH ? "done" : "stats";

    console.log(`✅ Stats chunk: ${updated} updated (next offset: ${newOffset})`);

    return {
        ...progress,
        phase: nextPhase,
        stats_offset: newOffset,
        total_stats_updated: progress.total_stats_updated + updated,
    };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;

        // Check if within work window (01:00-06:00 Israel time)
        const now = new Date();
        const israelHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getHours();
        const isManual = (await req.json().catch(() => ({}))).manual === true;

        if (!isManual && (israelHour < 1 || israelHour >= 6)) {
            return Response.json({ skipped: true, reason: `Outside work window (hour: ${israelHour})` });
        }

        const meta = await getOrCreateMeta(sr);
        let progress = parseProgress(meta);

        // Check if this is a new night (reset progress)
        const tonightKey = now.toISOString().split('T')[0];
        if (progress.tonight_date !== tonightKey && progress.phase === "done") {
            console.log(`🌙 New night (${tonightKey}), resetting progress...`);
            progress = {
                phase: "link",
                link_offset: 0,
                stats_offset: 0,
                tonight_date: tonightKey,
                total_linked: 0,
                total_stats_updated: 0,
                total_clients_created: 0,
            };
        } else if (!progress.tonight_date) {
            progress.tonight_date = tonightKey;
        }

        // Already done for tonight
        if (progress.phase === "done" && progress.tonight_date === tonightKey) {
            console.log("✅ Already completed for tonight");
            return Response.json({ 
                success: true, done: true,
                message: `Already completed tonight: ${progress.total_linked} linked, ${progress.total_stats_updated} stats updated`
            });
        }

        await saveProgress(sr, meta.id, progress, "RUNNING");

        // Execute current phase
        let newProgress;
        if (progress.phase === "link") {
            newProgress = await runLinkPhase(sr, progress);
        } else if (progress.phase === "stats") {
            newProgress = await runStatsPhase(sr, progress);
        } else {
            newProgress = { ...progress, phase: "done" };
        }

        await saveProgress(sr, meta.id, newProgress, newProgress.phase === "done" ? "SUCCESS" : "RUNNING");

        return Response.json({
            success: true,
            phase: newProgress.phase,
            progress: {
                total_linked: newProgress.total_linked,
                total_clients_created: newProgress.total_clients_created,
                total_stats_updated: newProgress.total_stats_updated,
            },
            message: newProgress.phase === "done" 
                ? `✅ Completed! ${newProgress.total_linked} linked, ${newProgress.total_stats_updated} stats updated`
                : `⏳ In progress (phase: ${newProgress.phase})...`
        });

    } catch (error) {
        console.error('❌ nightlyBackfill error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});