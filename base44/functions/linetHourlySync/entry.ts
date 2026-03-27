import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { subHours, subDays } from 'npm:date-fns@2.30.0';

const SYNC_KEY = "linet_main_sync";

Deno.serve(async (req) => {
    console.log("⏰ Starting Hourly Linet Sync...");

    try {
        const base44 = createClientFromRequest(req);

        // Check if we're in business hours (08:00-23:00 Israel time)
        const now = new Date();
        const israelHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })).getHours();
        
        if (israelHour < 8 || israelHour > 23) {
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
            const lastSync = new Date(metadataList[0].last_successful_sync);
            const hoursSinceLastSync = (now - lastSync) / (1000 * 60 * 60);
            
            // Safety: if last sync was more than 3 days ago, cap at 3 days to avoid timeout
            if (hoursSinceLastSync > 72) {
                console.log(`⚠️ Last sync was ${hoursSinceLastSync.toFixed(1)}h ago, capping at 3 days`);
                fromDatetime = subDays(now, 3).toISOString();
            } else {
                fromDatetime = metadataList[0].last_successful_sync;
            }
        } else {
            // First run - sync last 24 hours
            fromDatetime = subHours(now, 24).toISOString();
        }

        const toDatetime = now.toISOString();

        console.log(`📅 Hourly Sync: ${fromDatetime} → ${toDatetime}`);

        const rawResult = await base44.asServiceRole.functions.invoke('runLinetSync', {
            from_datetime: fromDatetime,
            to_datetime: toDatetime,
            trigger_type: "HOURLY",
            update_last_successful: true,
            disable_customer_sync: true
        });

        // Extract only serializable fields to avoid circular reference errors
        const syncResult = {
            success: rawResult?.success,
            stats: rawResult?.stats || {},
            message: rawResult?.message || '',
            device_sync: rawResult?.device_sync || null,
        };

        console.log("✅ Hourly sync completed:", JSON.stringify(syncResult.stats));

        return Response.json({
            success: true,
            syncResult
        });

    } catch (error) {
        console.error("❌ Hourly Sync Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});