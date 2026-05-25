import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Nightly job: find Activities with recordings and link them to SalesTransaction
 * records created within 24 hours after the call.
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin' && user?.role !== 'מנהל') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;
        const body = await req.json().catch(() => ({}));
        const daysBack = body.days_back || 7;

        const since = new Date();
        since.setDate(since.getDate() - daysBack);
        const sinceStr = since.toISOString();

        // Fetch recent call activities with recordings
        const [inActivities, outActivities] = await Promise.all([
            sr.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 200),
            sr.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 200),
        ]);

        const allActivities = [...inActivities, ...outActivities].filter(a =>
            a.recording_url && a.created_date >= sinceStr
        );

        console.log(`🔗 [LinkRec] Found ${allActivities.length} activities with recordings in last ${daysBack} days`);

        let linked = 0;
        let alreadyLinked = 0;
        let noMatch = 0;

        for (const activity of allActivities) {
            // Skip if already linked to a ticket (used as transaction link indicator)
            if (activity.ticket_id) {
                alreadyLinked++;
                continue;
            }

            // Extract phone from content
            const phoneMatch = activity.content?.match(/מספר:\s*([\d\-+]+)/);
            if (!phoneMatch) { noMatch++; continue; }

            const phone = phoneMatch[1].replace(/[^\d]/g, '');
            let normalized = phone;
            if (normalized.length === 12 && normalized.startsWith('972')) normalized = '0' + normalized.slice(3);
            if (normalized.length === 9 && !normalized.startsWith('0')) normalized = '0' + normalized;

            // Find client by order_id on the activity
            const clientId = activity.order_id;
            if (!clientId) { noMatch++; continue; }

            // Look for SalesTransaction created within 24h after this activity
            const activityDate = new Date(activity.created_date);
            const windowEnd = new Date(activityDate.getTime() + 24 * 60 * 60 * 1000);
            const activityDateStr = activityDate.toISOString().split('T')[0];
            const windowEndStr = windowEnd.toISOString().split('T')[0];

            const transactions = await sr.SalesTransaction.filter({
                client_id: clientId,
                issue_date: { $gte: activityDateStr, $lte: windowEndStr }
            }, '-created_date', 5);

            if (transactions.length > 0) {
                // Link: store transaction doc_number in ticket_id field
                const txn = transactions[0];
                await sr.Activity.update(activity.id, {
                    ticket_id: txn.id
                });
                linked++;
                console.log(`🔗 [LinkRec] Linked activity ${activity.id} → transaction ${txn.doc_number} (${txn.id})`);
            } else {
                noMatch++;
            }
        }

        const stats = { total: allActivities.length, linked, alreadyLinked, noMatch };
        console.log(`✅ [LinkRec] Done:`, JSON.stringify(stats));

        await sr.SyncLog.create({
            sync_key: 'link_recordings_transactions',
            run_started_at: new Date().toISOString(),
            status: 'SUCCESS',
            records_fetched: allActivities.length,
            records_created: linked,
            records_skipped: alreadyLinked + noMatch,
            trigger_type: body.trigger_type || 'MANUAL',
            details_json: stats,
        });

        return Response.json({ success: true, stats });
    } catch (error) {
        console.error('❌ [LinkRec] Fatal:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});