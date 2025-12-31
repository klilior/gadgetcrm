import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format, eachDayOfInterval, parseISO } from 'npm:date-fns@2.30.0';

/**
 * Catch-up sync for a date range - runs day by day to ensure completion
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'מנהל') {
            return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
        }

        let body = {};
        try {
            const text = await req.text();
            if (text && text.trim()) body = JSON.parse(text);
        } catch (e) {
            console.log("No request body");
        }

        const fromDate = body.from_date || '2024-12-09';
        const toDate = body.to_date || format(new Date(), 'yyyy-MM-dd');
        
        console.log(`🎯 Catch-up sync: ${fromDate} to ${toDate}`);

        // Get all days in range
        const days = eachDayOfInterval({
            start: parseISO(fromDate),
            end: parseISO(toDate)
        });

        console.log(`📅 Will sync ${days.length} days`);

        const results = [];
        let totalCreated = 0;
        let totalUpdated = 0;
        let totalFailed = 0;

        // Sync each day
        for (const day of days) {
            const dayStr = format(day, 'yyyy-MM-dd');
            console.log(`\n🔄 Syncing ${dayStr}...`);

            try {
                const result = await base44.asServiceRole.functions.invoke('runLinetSync', {
                    from_datetime: `${dayStr}T00:00:00Z`,
                    to_datetime: `${dayStr}T23:59:59Z`,
                    trigger_type: 'CATCHUP',
                    update_last_successful: false
                });

                if (result?.data?.success) {
                    const stats = result.data.stats || {};
                    totalCreated += stats.created || 0;
                    totalUpdated += stats.updated || 0;
                    results.push({
                        date: dayStr,
                        success: true,
                        stats: stats
                    });
                    console.log(`✅ ${dayStr}: ${stats.created} created, ${stats.updated} updated`);
                } else {
                    totalFailed++;
                    results.push({
                        date: dayStr,
                        success: false,
                        error: result?.data?.error || 'Unknown error'
                    });
                    console.log(`❌ ${dayStr}: Failed - ${result?.data?.error}`);
                }

                // Small delay between days
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (err) {
                totalFailed++;
                results.push({
                    date: dayStr,
                    success: false,
                    error: err.message
                });
                console.log(`❌ ${dayStr}: Error - ${err.message}`);
            }
        }

        const summary = {
            total_days: days.length,
            successful_days: days.length - totalFailed,
            failed_days: totalFailed,
            total_created: totalCreated,
            total_updated: totalUpdated
        };

        console.log('\n📊 Catch-up Summary:', summary);

        return Response.json({
            success: totalFailed === 0,
            summary,
            results,
            message: `סנכרון ${days.length} ימים הושלם: ${totalCreated} נוצרו, ${totalUpdated} עודכנו, ${totalFailed} נכשלו`
        });

    } catch (error) {
        console.error('❌ Catch-up error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});