import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { subHours } from 'npm:date-fns@2.30.0';

const SYNC_KEY = "linet_main_sync";

Deno.serve(async (req) => {
    console.log("⏰ Starting Hourly Linet Sync...");

    try {
        const base44 = createClientFromRequest(req);

        // Check if we're in business hours (09:00-22:00 Israel time)
        const now = new Date();
        const israelHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })).getHours();
        
        if (israelHour < 9 || israelHour > 22) {
            console.log(`⏸️ Outside business hours (${israelHour}:00), skipping hourly sync`);
            return Response.json({ 
                success: true, 
                skipped: true, 
                reason: `Outside business hours (${israelHour}:00)` 
            });
        }

        // Get last successful sync time
        const metadataList = await base44.asServiceRole.entities.SyncMetadata.filter({ sync_key: SYNC_KEY });
        let fromDatetime;

        if (metadataList.length > 0 && metadataList[0].last_successful_sync) {
            fromDatetime = metadataList[0].last_successful_sync;
        } else {
            // First run - sync last 24 hours
            fromDatetime = subHours(now, 24).toISOString();
        }

        const toDatetime = now.toISOString();

        console.log(`📅 Hourly Sync: ${fromDatetime} → ${toDatetime}`);

        // Call the main sync function using internal fetch (same auth context)
        const baseUrl = req.url.replace(/\/[^\/]*$/, '');
        const syncResponse = await fetch(`${baseUrl}/runLinetSync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.get('Authorization') || '',
                'X-Base44-App-Id': req.headers.get('X-Base44-App-Id') || ''
            },
            body: JSON.stringify({
                from_datetime: fromDatetime,
                to_datetime: toDatetime,
                trigger_type: "HOURLY",
                update_last_successful: true
            })
        });

        if (!syncResponse.ok) {
            const errorText = await syncResponse.text();
            throw new Error(`Sync function failed: ${syncResponse.status} - ${errorText}`);
        }

        const syncResult = await syncResponse.json();
        console.log("✅ Hourly sync completed:", syncResult);

        return Response.json({
            success: true,
            syncResult: syncResult
        });

    } catch (error) {
        console.error("❌ Hourly Sync Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});