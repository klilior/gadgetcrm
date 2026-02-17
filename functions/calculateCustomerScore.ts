import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Customer Score Algorithm (0-100):
 * 1. Purchase Value (30pts) | 2. Frequency (20pts) | 3. Recency (20pts)
 * 4. Engagement (15pts)     | 5. Loyalty (15pts)
 * 
 * Tiers: VIP(80+) | זהב(60-79) | כסף(40-59) | ברונזה(20-39) | חדש(0-19)
 */

function getTier(score) {
    if (score >= 80) return 'VIP';
    if (score >= 60) return 'זהב';
    if (score >= 40) return 'כסף';
    if (score >= 20) return 'ברונזה';
    return 'חדש';
}

function daysBetween(d1, d2) {
    return Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeFilter(entity, query, sort, limit) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await entity.filter(query, sort || null, limit || 100);
        } catch (err) {
            if (err.message?.includes('Rate limit') && attempt < 2) {
                await sleep(2000 * (attempt + 1));
                continue;
            }
            throw err;
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
        const targetClientId = body.client_id;
        const dryRun = body.dry_run === true;
        const batchSize = body.batch_size || 50;
        const offset = body.offset || 0;

        const sr = base44.asServiceRole.entities;

        let clients;
        if (targetClientId) {
            const found = await safeFilter(sr.Client, { id: targetClientId });
            clients = found;
        } else {
            // Process in batches to avoid rate limits
            const allClients = await sr.Client.list('-created_date', 5000);
            // Only take clients with phone (already cleaned)
            const validClients = allClients.filter(c => c.phone);
            clients = validClients.slice(offset, offset + batchSize);
            console.log(`📊 Batch: offset=${offset}, size=${clients.length}, total valid=${validClients.length}`);
        }

        const now = new Date();
        const results = [];

        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            try {
                // Throttle: 1 client per ~500ms to stay under rate limits
                if (i > 0 && i % 5 === 0) await sleep(1000);

                const [orders, repairs, tickets] = await Promise.all([
                    safeFilter(sr.Order, { client_id: client.id }),
                    safeFilter(sr.Repair, { client_id: client.id }),
                    safeFilter(sr.Ticket, { customer_id: client.id }),
                ]);

                // 1. Purchase Value (30pts)
                const totalSpent = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
                const valueScore = totalSpent >= 5000 ? 30 : totalSpent >= 2000 ? 20 : totalSpent >= 500 ? 10 : totalSpent > 0 ? 5 : 0;

                // 2. Frequency (20pts)
                const orderCount = orders.length;
                const freqScore = orderCount >= 7 ? 20 : orderCount >= 4 ? 15 : orderCount >= 2 ? 10 : orderCount >= 1 ? 5 : 0;

                // 3. Recency (20pts)
                const allDates = [
                    ...orders.map(o => o.order_date),
                    ...repairs.map(r => r.created_date),
                    ...tickets.map(t => t.created_date),
                ].filter(Boolean).map(d => new Date(d));
                
                const lastInteraction = allDates.length > 0 
                    ? new Date(Math.max(...allDates.map(d => d.getTime()))) : null;

                let recencyScore = 0;
                if (lastInteraction) {
                    const days = daysBetween(now, lastInteraction);
                    recencyScore = days <= 30 ? 20 : days <= 90 ? 15 : days <= 180 ? 10 : days <= 365 ? 5 : 0;
                }

                // 4. Engagement (15pts)
                const types = [orders.length > 0, repairs.length > 0, tickets.length > 0].filter(Boolean).length;
                const engagementScore = types >= 3 ? 15 : types >= 2 ? 10 : types >= 1 ? 5 : 0;

                // 5. Loyalty (15pts)
                const age = client.created_date ? daysBetween(now, new Date(client.created_date)) : 0;
                const loyaltyScore = age >= 365 ? 15 : age >= 180 ? 10 : age >= 90 ? 6 : 3;

                const totalScore = Math.min(100, valueScore + freqScore + recencyScore + engagementScore + loyaltyScore);
                const tier = getTier(totalScore);

                if (!dryRun) {
                    await safeFilter(sr.Client, {}, null, 0); // dummy to keep alive
                    await base44.asServiceRole.entities.Client.update(client.id, {
                        customer_score: totalScore,
                        customer_tier: tier,
                        total_spent: Math.round(totalSpent),
                        total_orders: orderCount,
                        total_repairs: repairs.length,
                        last_interaction_date: lastInteraction ? lastInteraction.toISOString() : null
                    });
                }

                results.push({
                    id: client.id, name: client.full_name, score: totalScore, tier,
                    breakdown: { valueScore, freqScore, recencyScore, engagementScore, loyaltyScore },
                    totalSpent: Math.round(totalSpent), orders: orderCount,
                    repairs: repairs.length, tickets: tickets.length
                });

            } catch (err) {
                console.error(`Error scoring ${client.full_name}:`, err.message);
                results.push({ id: client.id, name: client.full_name, error: err.message });
            }
        }

        const tierCounts = { VIP: 0, 'זהב': 0, 'כסף': 0, 'ברונזה': 0, 'חדש': 0 };
        for (const r of results) if (r.tier) tierCounts[r.tier]++;

        return Response.json({
            success: true, dry_run: dryRun,
            scored: results.filter(r => r.score !== undefined).length,
            errors: results.filter(r => r.error).length,
            tier_distribution: tierCounts,
            next_offset: offset + batchSize,
            top_customers: results.filter(r => r.score).sort((a, b) => b.score - a.score).slice(0, 20),
            average_score: Math.round(results.filter(r => r.score).reduce((s, r) => s + r.score, 0) / (results.filter(r => r.score).length || 1))
        });

    } catch (error) {
        console.error('❌ Score error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});