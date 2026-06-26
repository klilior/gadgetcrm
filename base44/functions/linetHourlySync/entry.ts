import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { subHours, subDays } from 'npm:date-fns@2.30.0';

const SYNC_KEY = "linet_main_sync";

function getBusinessWindowStatus(now = new Date()) {
    const israelNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    const day = israelNow.getDay();
    const minutes = israelNow.getHours() * 60 + israelNow.getMinutes();
    const timeLabel = `${String(israelNow.getHours()).padStart(2, '0')}:${String(israelNow.getMinutes()).padStart(2, '0')}`;

    const sunToThu = day >= 0 && day <= 4;
    const friday = day === 5;
    const inSunToThuWindow = sunToThu && minutes >= 9 * 60 && minutes <= 22 * 60;
    const inFridayWindow = friday && minutes >= 9 * 60 && minutes <= (15 * 60 + 30);

    return {
        isOpen: inSunToThuWindow || inFridayWindow,
        timeLabel,
        day,
        reason: day === 6 ? 'Saturday - no Linet sync needed' : `Outside Linet business hours (${timeLabel})`
    };
}

Deno.serve(async (req) => {
    console.log("⏰ Starting Linet Sync...");

    try {
        const base44 = createClientFromRequest(req);
        let body = {};
        try {
            const text = await req.text();
            if (text && text.trim()) body = JSON.parse(text);
        } catch (_e) {}

        const isManual = body.manual === true || body.trigger_type === 'MANUAL';
        const now = new Date();
        const businessWindow = getBusinessWindowStatus(now);
        
        if (!isManual && !businessWindow.isOpen) {
            console.log(`⏸️ ${businessWindow.reason}, skipping scheduled sync`);
            return Response.json({ 
                success: true, 
                skipped: true, 
                reason: businessWindow.reason
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

        console.log(`📅 Linet Sync: ${fromDatetime} → ${toDatetime}`);

        const rawResult = await base44.asServiceRole.functions.invoke('runLinetSync', {
            from_datetime: fromDatetime,
            to_datetime: toDatetime,
            trigger_type: isManual ? "MANUAL" : "HOURLY",
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
        // Return 200 even on failure to prevent automation from auto-disabling
        // after consecutive failures (e.g. temporary rate limits or Linet downtime)
        return Response.json({ 
            success: false, 
            error: error.message,
            note: 'Returned 200 to keep automation alive despite error'
        }, { status: 200 });
    }
});