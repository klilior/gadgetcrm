import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Helper function to find or create a client
async function findOrCreateClient(base44, wooOrder) {
    const billing = wooOrder.billing;
    const customerId = wooOrder.customer_id;

    // Try to find client by WooCommerce ID first
    if (customerId && customerId > 0) {
        const existingByWooId = await base44.entities.Client.filter({ woo_customer_id: customerId });
        if (existingByWooId.length > 0) {
            return existingByWooId[0].id;
        }
    }

    // Then try by email
    if (billing.email) {
        const existingByEmail = await base44.entities.Client.filter({ email: billing.email });
        if (existingByEmail.length > 0) {
            // Update with WooCommerce ID if missing
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
        console.log("🔥 [RESYNC v2] Starting complete order resynchronization...");

        // 1. Delete existing order products
        console.log("🗑️ Step 1: Deleting existing order products...");
        try {
            const existingProducts = await base44.entities.OrderProduct.filter({});
            console.log(`📋 Found ${existingProducts.length} order products to delete`);
            
            if (Array.isArray(existingProducts) && existingProducts.length > 0) {
                for (const product of existingProducts) {
                    try {
                        await base44.entities.OrderProduct.delete(product.id);
                    } catch (err) {
                        console.error(`Failed to delete product ${product.id}:`, err.message);
                    }
                }
                console.log(`✅ Deleted ${existingProducts.length} products`);
            } else {
                console.log("ℹ️ No order products to delete");
            }
        } catch (e) {
            console.log("⚠️ Error deleting order products:", e.message);
        }
        
        // 2. Delete existing orders
        console.log("🗑️ Step 2: Deleting existing orders...");
        try {
            const existingOrders = await base44.entities.Order.filter({});
            console.log(`📦 Found ${existingOrders.length} orders to delete`);
            
            if (Array.isArray(existingOrders) && existingOrders.length > 0) {
                for (const order of existingOrders) {
                    try {
                        await base44.entities.Order.delete(order.id);
                    } catch (err) {
                        console.error(`Failed to delete order ${order.id}:`, err.message);
                    }
                }
                console.log(`✅ Deleted ${existingOrders.length} orders`);
            } else {
                console.log("ℹ️ No orders to delete");
            }
        } catch (e) {
            console.log("⚠️ Error deleting orders:", e.message);
        }

        // 3. Get WooCommerce settings
        console.log("🔑 Step 3: Getting WooCommerce settings...");
        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            base44.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);
        const wooCommerceUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;

        if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
            throw new Error("WooCommerce settings missing.");
        }
        console.log(`✅ Settings loaded: ${wooCommerceUrl}`);

        // 4. Fetch orders from WooCommerce
        console.log("🚚 Step 4: Fetching orders from WooCommerce...");
        const authString = btoa(`${consumerKey}:${consumerSecret}`);
        let allWooOrders = [];
        let page = 1;
        let totalPages = 1;

        do {
            const fetchUrl = `${wooCommerceUrl}/wp-json/wc/v3/orders?per_page=100&page=${page}&status=any`;
            const response = await fetch(fetchUrl, { headers: { 'Authorization': `Basic ${authString}` } });
            
            if (!response.ok) {
                throw new Error(`WooCommerce API Error: ${response.status}`);
            }
            
            totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1', 10);
            const wooOrdersPage = await response.json();
            
            if (Array.isArray(wooOrdersPage)) {
                allWooOrders.push(...wooOrdersPage);
                console.log(`📦 Page ${page}/${totalPages}: ${wooOrdersPage.length} orders (total: ${allWooOrders.length})`);
            }
            
            page++;
        } while (page <= totalPages);
        
        console.log(`✅ Fetched ${allWooOrders.length} orders from WooCommerce`);

        // 5. Process and create new records
        console.log("🛠️ Step 5: Creating new records...");
        let createdOrders = 0;
        let createdProducts = 0;
        let errors = 0;

        for (let i = 0; i < allWooOrders.length; i++) {
            const wooOrder = allWooOrders[i];
            try {
                // Find or create client
                const clientId = await findOrCreateClient(base44, wooOrder);

                // Create order
                const newOrderData = {
                    external_order_number: wooOrder.id.toString(),
                    client_id: clientId,
                    order_date: wooOrder.date_created,
                    status: wooOrder.status,
                    total: wooOrder.total,
                    shipping_total: wooOrder.shipping_total,
                    shipping_method: wooOrder.shipping_lines?.[0]?.method_title || null,
                    payment_method_title: wooOrder.payment_method_title,
                    customer_note: wooOrder.customer_note,
                    raw_data_billing: JSON.stringify(wooOrder.billing),
                };

                const createdOrder = await base44.entities.Order.create(newOrderData);
                createdOrders++;

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
                    createdProducts += productItems.length;
                }
                
                if ((i + 1) % 10 === 0) {
                    console.log(`📊 Progress: ${i + 1}/${allWooOrders.length} orders processed`);
                }
            } catch (error) {
                errors++;
                console.error(`❌ Error processing order #${wooOrder.id}:`, error.message);
            }
        }
        
        const message = `✅ Resync complete! Created ${createdOrders} orders, ${createdProducts} products. ${errors} errors.`;
        console.log(message);
        return Response.json({ 
            success: true, 
            message,
            stats: {
                ordersCreated: createdOrders,
                productsCreated: createdProducts,
                errors: errors
            }
        });

    } catch (error) {
        console.error("❌ Resync Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});