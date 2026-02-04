import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Helper function to find or create a client
async function findOrCreateClient(base44, wooOrder) {
    const billing = wooOrder.billing;
    const customerId = wooOrder.customer_id;

    // Try to find client by WooCommerce ID
    if (customerId && customerId > 0) {
        const existingByWooId = await base44.entities.Client.filter({ woo_customer_id: customerId });
        if (existingByWooId.length > 0) return existingByWooId[0].id;
    }

    // Try by email
    if (billing.email) {
        const existingByEmail = await base44.entities.Client.filter({ email: billing.email });
        if (existingByEmail.length > 0) {
            if (!existingByEmail[0].woo_customer_id && customerId > 0) {
                await base44.entities.Client.update(existingByEmail[0].id, { woo_customer_id: customerId });
            }
            return existingByEmail[0].id;
        }
    }

    // Create new client
    const newClient = {
        full_name: `${billing.first_name} ${billing.last_name}`,
        email: billing.email,
        phone: billing.phone,
        full_address: `${billing.address_1}, ${billing.city}`,
        city: billing.city,
        woo_customer_id: customerId > 0 ? customerId : null,
    };
    const createdClient = await base44.entities.Client.create(newClient);
    return createdClient.id;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    try {
        console.log("🚀 [Sync] Starting WooCommerce Sync...");

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
        
        // Fetch recent orders (last 7 days + all pending/processing)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const afterDate = sevenDaysAgo.toISOString();
        
        const fetchUrl = `${wooCommerceUrl}/wp-json/wc/v3/orders?per_page=100&after=${afterDate}&orderby=date&order=desc`;
        
        const response = await fetch(fetchUrl, {
            headers: { 'Authorization': `Basic ${authString}` }
        });

        if (!response.ok) {
            throw new Error(`WooCommerce API error: ${response.status} - ${response.statusText}`);
        }

        const wooOrders = await response.json();
        let createdCount = 0, updatedCount = 0, failedCount = 0;

        for (const wooOrder of wooOrders) {
            try {
                const clientId = await findOrCreateClient(base44, wooOrder);
                
                // Extract billing note from meta_data (custom field used by WooCommerce)
                const billingNoteMeta = (wooOrder.meta_data || []).find(m => 
                    m.key === 'billing_note' || m.key === '_billing_note'
                );
                const customerNote = wooOrder.customer_note || billingNoteMeta?.value || '';
                
                const orderData = {
                    external_order_number: wooOrder.id.toString(),
                    client_id: clientId,
                    order_date: wooOrder.date_created,
                    status: wooOrder.status,
                    total: wooOrder.total,
                    shipping_total: wooOrder.shipping_total,
                    shipping_method: wooOrder.shipping_lines?.[0]?.method_title || null,
                    payment_method_title: wooOrder.payment_method_title,
                    customer_note: customerNote,
                    raw_data_billing: JSON.stringify(wooOrder.billing),
                };
                
                const existingOrders = await base44.entities.Order.filter({ external_order_number: wooOrder.id.toString() });

                if (existingOrders.length > 0) {
                    // Update existing order
                    await base44.entities.Order.update(existingOrders[0].id, orderData);
                    updatedCount++;
                    
                    // Update products - delete old ones and create new
                    const existingProducts = await base44.entities.OrderProduct.filter({ order_id: existingOrders[0].id });
                    for (const product of existingProducts) {
                        await base44.entities.OrderProduct.delete(product.id);
                    }
                    
                    if (Array.isArray(wooOrder.line_items) && wooOrder.line_items.length > 0) {
                        const productItems = wooOrder.line_items.map(item => ({
                            order_id: existingOrders[0].id,
                            external_order_id: wooOrder.id,
                            product_id: item.product_id,
                            name: item.name,
                            quantity: item.quantity,
                            total: item.total
                        }));
                        await base44.entities.OrderProduct.bulkCreate(productItems);
                    }
                } else {
                    // Create new order
                    const createdOrder = await base44.entities.Order.create(orderData);
                    
                    // Create order products
                    if (Array.isArray(wooOrder.line_items) && wooOrder.line_items.length > 0) {
                        const productItems = wooOrder.line_items.map(item => ({
                            order_id: createdOrder.id,
                            external_order_id: wooOrder.id,
                            product_id: item.product_id,
                            name: item.name,
                            quantity: item.quantity,
                            total: item.total
                        }));
                        await base44.entities.OrderProduct.bulkCreate(productItems);
                    }
                    
                    createdCount++;
                }
            } catch (orderError) {
                 failedCount++;
                 console.error(`❌ Processing FAILED for order #${wooOrder.id}. Error: ${orderError.message}`);
            }
        }

        const message = `סנכרון הושלם: ${createdCount} הזמנות נוצרו, ${updatedCount} עודכנו, ${failedCount} נכשלו.`;
        console.log(`✅ ${message}`);
        return Response.json({ success: true, message, created: createdCount, updated: updatedCount, failed: failedCount });

    } catch (error) {
        console.error("❌ Sync Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});