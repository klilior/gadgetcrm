import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;

    try {
        console.log("🚀 [CatchUp] Starting catch-up sync for stale processing orders...");

        // Get WooCommerce settings
        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);

        const wooUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;

        if (!wooUrl || !consumerKey || !consumerSecret) {
            return Response.json({ success: false, error: "חסרים פרטי WooCommerce" }, { status: 200 });
        }

        const authString = btoa(`${consumerKey}:${consumerSecret}`);

        // Get all local orders with status "processing"
        const processingOrders = await sr.Order.filter({ status: "processing" }, '-created_date', 500);
        console.log(`📦 [CatchUp] Found ${processingOrders.length} orders with status 'processing'`);

        if (processingOrders.length === 0) {
            return Response.json({ success: true, message: "אין הזמנות processing לעדכון", updated: 0 });
        }

        let updated = 0;
        let failed = 0;
        let unchanged = 0;
        const batchSize = 10;

        for (let i = 0; i < processingOrders.length; i += batchSize) {
            const batch = processingOrders.slice(i, i + batchSize);
            
            // Fetch each order's current status from WooCommerce
            const promises = batch.map(async (localOrder) => {
                const extId = localOrder.external_order_number;
                if (!extId) return { action: 'skip' };

                try {
                    const url = `${wooUrl}/wp-json/wc/v3/orders/${extId}`;
                    const res = await fetch(url, {
                        headers: { 'Authorization': `Basic ${authString}` }
                    });

                    if (!res.ok) {
                        console.warn(`⚠️ [CatchUp] Order ${extId}: HTTP ${res.status}`);
                        return { action: 'failed', id: extId };
                    }

                    const wooOrder = await res.json();

                    if (wooOrder.status !== localOrder.status) {
                        console.log(`🔄 [CatchUp] Order ${extId}: ${localOrder.status} → ${wooOrder.status}`);
                        await sr.Order.update(localOrder.id, { status: wooOrder.status });
                        return { action: 'updated', id: extId, from: localOrder.status, to: wooOrder.status };
                    } else {
                        return { action: 'unchanged', id: extId };
                    }
                } catch (err) {
                    console.error(`❌ [CatchUp] Order ${extId}: ${err.message}`);
                    return { action: 'failed', id: extId };
                }
            });

            const results = await Promise.all(promises);
            for (const r of results) {
                if (r.action === 'updated') updated++;
                else if (r.action === 'failed') failed++;
                else if (r.action === 'unchanged') unchanged++;
            }

            // Rate limit protection
            if (i + batchSize < processingOrders.length) {
                await delay(1000);
            }
        }

        const msg = `עדכון סטטוסים הושלם: ${updated} עודכנו, ${unchanged} ללא שינוי, ${failed} נכשלו (מתוך ${processingOrders.length})`;
        console.log(`✅ [CatchUp] ${msg}`);
        return Response.json({ success: true, message: msg, updated, unchanged, failed, total: processingOrders.length });

    } catch (error) {
        console.error("❌ [CatchUp] Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});