import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { subDays } from 'npm:date-fns@2.30.0';

Deno.serve(async (req) => {
    console.log("🌙 Starting Nightly Linet Reconciliation...");

    try {
        const base44 = createClientFromRequest(req);

        const now = new Date();
        // Go back 3 days to catch any late updates
        const fromDatetime = subDays(now, 3).toISOString();
        const toDatetime = now.toISOString();

        console.log(`📅 Nightly Sync: ${fromDatetime} → ${toDatetime}`);

        // Call the main sync function
        const syncResponse = await base44.functions.invoke('runLinetSync', {
            from_datetime: fromDatetime,
            to_datetime: toDatetime,
            trigger_type: "NIGHTLY",
            update_last_successful: true
        });

        console.log("✅ Nightly sync completed:", syncResponse);

        return Response.json({
            success: true,
            syncResult: syncResponse
        });

    } catch (error) {
        console.error("❌ Nightly Sync Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});