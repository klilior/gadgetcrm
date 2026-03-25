import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { subDays } from 'npm:date-fns@2.30.0';

Deno.serve(async (req) => {
    console.log("🌙 Starting Nightly Linet Reconciliation...");

    try {
        const base44 = createClientFromRequest(req);

        const now = new Date();
        // Go back 5 days to catch any late updates or missed syncs
        const fromDatetime = subDays(now, 5).toISOString();
        const toDatetime = now.toISOString();

        console.log(`📅 Nightly Sync: ${fromDatetime} → ${toDatetime}`);

        const syncResult = await base44.asServiceRole.functions.invoke('runLinetSync', {
            from_datetime: fromDatetime,
            to_datetime: toDatetime,
            trigger_type: "NIGHTLY",
            update_last_successful: true,
            disable_customer_sync: false
        });

        console.log("✅ Nightly sync completed:", JSON.stringify(syncResult?.stats || {}));

        return Response.json({
            success: true,
            syncResult: syncResult
        });

    } catch (error) {
        console.error("❌ Nightly Sync Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});