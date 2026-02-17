import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Customer Score Algorithm (0-100):
 * 
 * 1. Purchase Value (30 points max)
 *    - ₪0-500: 5pts | ₪500-2000: 10pts | ₪2000-5000: 20pts | ₪5000+: 30pts
 * 
 * 2. Purchase Frequency (20 points max)
 *    - 1 order: 5pts | 2-3: 10pts | 4-6: 15pts | 7+: 20pts
 * 
 * 3. Recency (20 points max)
 *    - Last 30 days: 20pts | 30-90 days: 15pts | 90-180 days: 10pts | 180-365: 5pts | 365+: 0pts
 * 
 * 4. Engagement (15 points max)
 *    - Has multiple interaction types (orders + repairs + tickets): up to 15pts
 * 
 * 5. Loyalty (15 points max)
 *    - Customer age: 0-3mo: 3pts | 3-6mo: 6pts | 6-12mo: 10pts | 12mo+: 15pts
 * 
 * Tiers:
 *   VIP: 80-100 | זהב: 60-79 | כסף: 40-59 | ברונזה: 20-39 | חדש: 0-19
 */

function getTier(score) {
    if (score >= 80) return 'VIP';
    if (score >= 60) return 'זהב';
    if (score >= 40) return 'כסף';
    if (score >= 20) return 'ברונזה';
    return 'חדש';
}

function daysBetween(date1, date2) {
    return Math.floor(Math.abs(date2 - date1) / (1000 * 60 * 60 * 24));
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const targetClientId = body.client_id; // optional - score single client
        const dryRun = body.dry_run === true;

        let clients;
        if (targetClientId) {
            const client = await base44.asServiceRole.entities.Client.filter({ id: targetClientId }, null, 1);
            clients = client;
        } else {
            clients = await base44.asServiceRole.entities.Client.list('-created_date', 5000);
        }

        console.log(`📊 Scoring ${clients.length} clients...`);
        const now = new Date();
        const results = [];

        for (const client of clients) {
            try {
                // Fetch all client data in parallel
                const [orders, repairs, tickets, smsLogs] = await Promise.all([
                    base44.asServiceRole.entities.Order.filter({ client_id: client.id }),
                    base44.asServiceRole.entities.Repair.filter({ client_id: client.id }),
                    base44.asServiceRole.entities.Ticket.filter({ customer_id: client.id }),
                    client.phone 
                        ? base44.asServiceRole.entities.NotificationLog.filter({ to_phone: client.phone }, '-sent_at', 5)
                        : Promise.resolve([])
                ]);

                // --- 1. Purchase Value (30pts) ---
                const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
                let valueScore = 0;
                if (totalSpent >= 5000) valueScore = 30;
                else if (totalSpent >= 2000) valueScore = 20;
                else if (totalSpent >= 500) valueScore = 10;
                else if (totalSpent > 0) valueScore = 5;

                // --- 2. Purchase Frequency (20pts) ---
                const orderCount = orders.length;
                let freqScore = 0;
                if (orderCount >= 7) freqScore = 20;
                else if (orderCount >= 4) freqScore = 15;
                else if (orderCount >= 2) freqScore = 10;
                else if (orderCount >= 1) freqScore = 5;

                // --- 3. Recency (20pts) ---
                const allDates = [
                    ...orders.map(o => o.order_date),
                    ...repairs.map(r => r.created_date),
                    ...tickets.map(t => t.created_date),
                    ...smsLogs.map(s => s.sent_at)
                ].filter(Boolean).map(d => new Date(d));
                
                const lastInteraction = allDates.length > 0 
                    ? new Date(Math.max(...allDates.map(d => d.getTime())))
                    : null;

                let recencyScore = 0;
                if (lastInteraction) {
                    const daysSince = daysBetween(now, lastInteraction);
                    if (daysSince <= 30) recencyScore = 20;
                    else if (daysSince <= 90) recencyScore = 15;
                    else if (daysSince <= 180) recencyScore = 10;
                    else if (daysSince <= 365) recencyScore = 5;
                }

                // --- 4. Engagement (15pts) ---
                let engagementScore = 0;
                const hasOrders = orders.length > 0;
                const hasRepairs = repairs.length > 0;
                const hasTickets = tickets.length > 0;
                const interactionTypes = [hasOrders, hasRepairs, hasTickets].filter(Boolean).length;
                if (interactionTypes >= 3) engagementScore = 15;
                else if (interactionTypes >= 2) engagementScore = 10;
                else if (interactionTypes >= 1) engagementScore = 5;

                // --- 5. Loyalty (15pts) ---
                const customerAge = client.created_date 
                    ? daysBetween(now, new Date(client.created_date))
                    : 0;
                let loyaltyScore = 0;
                if (customerAge >= 365) loyaltyScore = 15;
                else if (customerAge >= 180) loyaltyScore = 10;
                else if (customerAge >= 90) loyaltyScore = 6;
                else loyaltyScore = 3;

                // --- Total ---
                const totalScore = Math.min(100, valueScore + freqScore + recencyScore + engagementScore + loyaltyScore);
                const tier = getTier(totalScore);

                const updateData = {
                    customer_score: totalScore,
                    customer_tier: tier,
                    total_spent: Math.round(totalSpent),
                    total_orders: orderCount,
                    total_repairs: repairs.length,
                    last_interaction_date: lastInteraction ? lastInteraction.toISOString() : null
                };

                if (!dryRun) {
                    await base44.asServiceRole.entities.Client.update(client.id, updateData);
                }

                results.push({
                    id: client.id,
                    name: client.full_name,
                    score: totalScore,
                    tier,
                    breakdown: { valueScore, freqScore, recencyScore, engagementScore, loyaltyScore },
                    totalSpent: Math.round(totalSpent),
                    orders: orderCount,
                    repairs: repairs.length,
                    tickets: tickets.length
                });

            } catch (err) {
                console.error(`Error scoring ${client.full_name}:`, err.message);
            }
        }

        // Summary
        const tierCounts = { VIP: 0, 'זהב': 0, 'כסף': 0, 'ברונזה': 0, 'חדש': 0 };
        for (const r of results) tierCounts[r.tier]++;

        console.log(`✅ Scoring complete. Tier distribution:`, JSON.stringify(tierCounts));

        return Response.json({
            success: true,
            dry_run: dryRun,
            scored: results.length,
            tier_distribution: tierCounts,
            top_customers: results.sort((a, b) => b.score - a.score).slice(0, 20),
            average_score: Math.round(results.reduce((s, r) => s + r.score, 0) / (results.length || 1))
        });

    } catch (error) {
        console.error('❌ Score calculation error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});