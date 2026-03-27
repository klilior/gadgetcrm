import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        
        console.log("🔍 Debug: Starting diagnostic...");
        
        // בדיקה 1: בדיקת הגדרות WooCommerce
        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);
        
        const wooCommerceUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;
        
        console.log("🔍 Debug: Settings check", { hasUrl: !!wooCommerceUrl, hasKey: !!consumerKey, hasSecret: !!consumerSecret });
        
        if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
            return Response.json({ 
                success: false, 
                error: "Missing WooCommerce settings",
                debug: { wooCommerceUrl, hasKey: !!consumerKey, hasSecret: !!consumerSecret }
            });
        }
        
        // בדיקה 2: קריאת נתונים מ-WooCommerce
        const authString = btoa(`${consumerKey}:${consumerSecret}`);
        const response = await fetch(`${wooCommerceUrl}/wp-json/wc/v3/orders?per_page=1`, {
            headers: { 'Authorization': `Basic ${authString}` }
        });
        
        if (!response.ok) {
            return Response.json({ 
                success: false, 
                error: `WooCommerce API error: ${response.status}`,
                debug: { status: response.status, statusText: response.statusText }
            });
        }
        
        const wooOrders = await response.json();
        console.log("🔍 Debug: WooCommerce response", JSON.stringify(wooOrders, null, 2));
        
        if (wooOrders.length === 0) {
            return Response.json({ 
                success: false, 
                error: "No orders found in WooCommerce"
            });
        }
        
        // בדיקה 3: ניסיון יצירת הזמנה פשוטה
        const testOrder = wooOrders[0];
        console.log("🔍 Debug: Test order from WooCommerce", JSON.stringify(testOrder, null, 2));
        
        const testOrderData = {
            external_order_number: `TEST_${testOrder.id}`,
            source: "WooCommerce",
            customer_id: null, // נתחיל בלי לקוח
            order_date: new Date().toISOString(),
            fulfillment_status: "חדש", // סטטוס פשוט שקיים בוודאות
            shipping_method: "שליח עד הבית", // ערך שקיים בוודאות
            shipping_cost: "0",
            planned_carrier: "מהיר-לי", // ערך שקיים בוודאות
            total_amount: testOrder.total || "0",
            line_items: []
        };
        
        console.log("🔍 Debug: Attempting to create test order", JSON.stringify(testOrderData, null, 2));
        
        try {
            const createdOrder = await base44.entities.Order.create(testOrderData);
            console.log("✅ Debug: Successfully created test order", createdOrder);
            
            // נמחק את ההזמנה הזמנית
            await base44.entities.Order.delete(createdOrder.id);
            
            return Response.json({ 
                success: true, 
                debug: {
                    message: "Test order creation successful",
                    wooCommerceData: testOrder,
                    createdOrderData: testOrderData
                }
            });
            
        } catch (createError) {
            console.error("❌ Debug: Failed to create test order", createError);
            return Response.json({ 
                success: false, 
                error: "Failed to create test order",
                debug: {
                    createError: createError.message,
                    testOrderData,
                    wooCommerceData: testOrder
                }
            });
        }
        
    } catch (error) {
        console.error("❌ Debug: General error", error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack
        });
    }
});