import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        
        console.log("🔍 [Debug] Starting WooCommerce Data Analysis...");
        
        // Step 1: Get WooCommerce settings
        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);

        const wooCommerceUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;

        if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
            return Response.json({ error: "WooCommerce settings missing" });
        }

        // Step 2: Fetch data from WooCommerce
        const authString = btoa(`${consumerKey}:${consumerSecret}`);
        const { orderId } = await req.json().catch(() => ({}));
        
        const fetchUrl = orderId 
            ? `${wooCommerceUrl}/wp-json/wc/v3/orders/${orderId}`
            : `${wooCommerceUrl}/wp-json/wc/v3/orders?per_page=3&status=any`;
            
        const response = await fetch(fetchUrl, {
            headers: { 'Authorization': `Basic ${authString}` }
        });

        if (!response.ok) {
            return Response.json({ error: `WooCommerce API error: ${response.status}` });
        }

        const wooData = await response.json();
        const wooOrders = orderId ? [wooData] : wooData;
        
        // If single order, return full raw data
        if (orderId) {
            return Response.json({
                success: true,
                orderId,
                raw_woo_data: wooData,
                customer_note: wooData.customer_note,
                meta_data: wooData.meta_data
            });
        }
        
        // Step 3: Check what's currently in our database
        const existingOrders = await base44.entities.Order.list("-created_date", 50);
        const existingClients = await base44.entities.Client.list("-created_date", 50);
        
        // Step 4: Analyze the data
        const analysis = {
            wooCommerceData: wooOrders.map(order => ({
                id: order.id,
                status: order.status,
                customer_name: `${order.billing.first_name} ${order.billing.last_name}`,
                customer_email: order.billing.email,
                customer_phone: order.billing.phone,
                total: order.total,
                date_created: order.date_created,
                line_items: order.line_items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    total: item.total
                }))
            })),
            existingOrdersInDB: existingOrders.map(order => ({
                id: order.id,
                external_order_number: order.external_order_number,
                source: order.source,
                fulfillment_status: order.fulfillment_status,
                total_amount: order.total_amount,
                order_date: order.order_date,
                created_date: order.created_date
            })),
            existingClientsInDB: existingClients.map(client => ({
                id: client.id,
                full_name: client.full_name,
                email: client.email,
                phone: client.phone,
                created_date: client.created_date
            })),
            statusMapping: {
                'pending': 'ממתינה לתשלום',
                'processing': 'בטיפול שולם',
                'on-hold': 'מושהה',
                'completed': 'ההזמנה הושלמה',
                'cancelled': 'ההזמנה בוטלה',
                'refunded': 'הוחזרה',
                'failed': 'התשלום נכשל'
            }
        };

        console.log("🔍 [Debug] Analysis complete:", JSON.stringify(analysis, null, 2));
        
        return Response.json({
            success: true,
            analysis,
            summary: {
                wooCommerceOrdersFound: wooOrders.length,
                existingOrdersInDB: existingOrders.length,
                existingClientsInDB: existingClients.length,
                wooCommerceUrl: wooCommerceUrl
            }
        });

    } catch (error) {
        console.error("❌ [Debug] Error:", error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});