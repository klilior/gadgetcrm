import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// This function is intended for a one-time fix.
Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    try {
        console.log("🚀 [Fix v1.1] Starting to fix existing orders with JSON stringify...");

        // Get settings
        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);

        const wooCommerceUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;

        if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
            throw new Error("פרטי התחברות WooCommerce חסרים בהגדרות.");
        }
        
        const authString = btoa(`${consumerKey}:${consumerSecret}`);

        // Get orders with invalid raw_data
        const ordersToFix = await base44.entities.Order.filter({
            raw_data: "[object Object]"
        }, null, 50); // Fix up to 50 at a time

        if (ordersToFix.length === 0) {
            return Response.json({ success: true, message: "לא נמצאו הזמנות לתיקון." });
        }

        console.log(`🔧 Found ${ordersToFix.length} orders to fix.`);
        let updated = 0, failed = 0;

        for (const order of ordersToFix) {
            try {
                const fetchUrl = `${wooCommerceUrl}/wp-json/wc/v3/orders/${order.external_order_number}`;
                const response = await fetch(fetchUrl, { headers: { 'Authorization': `Basic ${authString}` } });
                
                if (!response.ok) {
                    console.warn(`⚠️ Could not fetch order #${order.external_order_number}. Status: ${response.status}`);
                    continue;
                }
                
                const wooOrder = await response.json();
                
                // Correctly stringify the object before updating
                const orderData = {
                    raw_data: JSON.stringify(wooOrder),
                };

                await base44.entities.Order.update(order.id, orderData);
                updated++;
                console.log(`✅ Fixed order #${order.external_order_number}`);

            } catch (e) {
                failed++;
                console.error(`❌ Failed to fix order #${order.external_order_number}:`, e.message);
            }
        }

        const message = `תיקון הושלם: ${updated} הזמנות תוקנו, ${failed} נכשלו.`;
        return Response.json({ success: true, message, updated, failed });

    } catch (error) {
        console.error("❌ Fix Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});