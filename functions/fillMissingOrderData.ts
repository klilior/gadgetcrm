import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    try {
        console.log("🔧 [Fill Missing Data v1.1] מתחיל למלא מידע חסר עם JSON.stringify...");

        // קבל את הגדרות WooCommerce
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

        // קבל את כל ההזמנות עם מידע חסר - רק 15 בכל פעם
        const ordersWithoutData = await base44.entities.Order.filter({ raw_data: null });
        const realOrders = ordersWithoutData.filter(order => 
            !order.external_order_number.startsWith('SIMPLE_TEST') && 
            !order.external_order_number.startsWith('TEST')
        ).slice(0, 15);
        
        console.log(`📋 מעבד ${realOrders.length} הזמנות עם מידע חסר`);

        const authString = btoa(`${consumerKey}:${consumerSecret}`);
        let successCount = 0, failedCount = 0, skipCount = 0;

        for (const order of realOrders) {
            try {
                console.log(`🔍 מביא מידע עבור הזמנה #${order.external_order_number}...`);
                
                const response = await fetch(`${wooCommerceUrl}/wp-json/wc/v3/orders/${order.external_order_number}`, {
                    headers: { 
                        'Authorization': `Basic ${authString}`,
                        'User-Agent': 'GadgetCRM/1.0'
                    }
                });

                if (response.ok) {
                    const wooOrderData = await response.json();
                    
                    if (wooOrderData && wooOrderData.id) {
                        await base44.entities.Order.update(order.id, {
                            raw_data: JSON.stringify(wooOrderData)
                        });
                        
                        successCount++;
                        console.log(`✅ עודכן מידע עבור הזמנה #${order.external_order_number}`);
                    } else {
                        console.log(`⚠️ נתונים לא תקינים עבור הזמנה #${order.external_order_number}`);
                        failedCount++;
                    }
                } else if (response.status === 404) {
                    console.log(`⚠️ הזמנה #${order.external_order_number} לא קיימת יותר באתר (404)`);
                    skipCount++;
                } else {
                    console.log(`❌ שגיאה ${response.status} עבור הזמנה #${order.external_order_number}`);
                    failedCount++;
                }
            } catch (error) {
                console.error(`❌ שגיאה בעיבוד הזמנה #${order.external_order_number}:`, error.message);
                failedCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        const totalRemaining = ordersWithoutData.length - realOrders.length;
        let finalMessage = `✅ מילוי מידע הושלם: ${successCount} הזמנות עודכנו, ${failedCount} נכשלו, ${skipCount} לא קיימות יותר.`;
        
        if (totalRemaining > 0) {
            finalMessage += ` נותרו ${totalRemaining} הזמנות נוספות למילוי.`;
        }
        
        console.log(`🎉 ${finalMessage}`);
        
        return Response.json({ 
            success: true, 
            message: finalMessage,
            updated: successCount, 
            failed: failedCount,
            skipped: skipCount,
            totalProcessed: realOrders.length,
            remaining: totalRemaining
        });

    } catch (error) {
        console.error("❌ שגיאה במילוי מידע:", error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});