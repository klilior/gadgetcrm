import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.startsWith('+972')) cleaned = '0' + cleaned.slice(4);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
}

async function findOrCreateClient(sr, wooOrder) {
    const billing = wooOrder.billing || {};
    const shipping = wooOrder.shipping || {};
    const customerId = wooOrder.customer_id;
    const phone = normalizePhone(billing.phone) || normalizePhone(shipping.phone);
    const email = billing.email || '';
    const fullName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'לקוח מהאתר';
    const city = billing.city || shipping.city || '';
    const address = billing.address_1 ? `${billing.address_1}${billing.address_2 ? ' ' + billing.address_2 : ''}, ${city}` : '';

    // 1. Try by WooCommerce customer ID
    if (customerId && customerId > 0) {
        const byWoo = await sr.Client.filter({ woo_customer_id: customerId }, null, 1);
        if (byWoo.length > 0) {
            // Enrich with any missing data
            const updates = {};
            if (phone && !byWoo[0].phone) updates.phone = phone;
            if (email && !byWoo[0].email) updates.email = email;
            if (city && !byWoo[0].city) updates.city = city;
            if (address && !byWoo[0].full_address) updates.full_address = address;
            if (!byWoo[0].full_name || byWoo[0].full_name === 'לקוח חדש') updates.full_name = fullName;
            if (Object.keys(updates).length > 0) {
                await sr.Client.update(byWoo[0].id, updates);
            }
            return byWoo[0].id;
        }
    }

    // 2. Try by phone
    if (phone) {
        const byPhone = await sr.Client.filter({ phone }, null, 1);
        if (byPhone.length > 0) {
            const updates = {};
            if (customerId > 0 && !byPhone[0].woo_customer_id) updates.woo_customer_id = customerId;
            if (email && !byPhone[0].email) updates.email = email;
            if (city && !byPhone[0].city) updates.city = city;
            if (address && !byPhone[0].full_address) updates.full_address = address;
            if (Object.keys(updates).length > 0) {
                await sr.Client.update(byPhone[0].id, updates);
            }
            return byPhone[0].id;
        }
    }

    // 3. Try by email
    if (email) {
        const byEmail = await sr.Client.filter({ email }, null, 1);
        if (byEmail.length > 0) {
            const updates = {};
            if (customerId > 0 && !byEmail[0].woo_customer_id) updates.woo_customer_id = customerId;
            if (phone && !byEmail[0].phone) updates.phone = phone;
            if (city && !byEmail[0].city) updates.city = city;
            if (address && !byEmail[0].full_address) updates.full_address = address;
            if (Object.keys(updates).length > 0) {
                await sr.Client.update(byEmail[0].id, updates);
            }
            return byEmail[0].id;
        }
    }

    // 4. Create new client
    const newClient = await sr.Client.create({
        full_name: fullName,
        phone: phone || null,
        email: email || null,
        city: city || null,
        full_address: address || null,
        woo_customer_id: customerId > 0 ? customerId : null,
        source: 'WooCommerce',
        preferred_channel: 'website',
    });
    console.log(`🆕 New client created: ${fullName} (${phone || email})`);
    return newClient.id;
}

// WooCommerce statuses:
// pending = ממתין לתשלום
// processing = בטיפול (שולם!)
// on-hold = בהמתנה
// completed = הושלם
// cancelled = בוטל
// refunded = הוחזר
// failed = נכשל

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;
    
    try {
        console.log("🚀 [Sync] Starting WooCommerce Sync...");

        const [urlSetting, keySetting, secretSetting] = await Promise.all([
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
        ]);

        const wooCommerceUrl = urlSetting[0]?.setting_value;
        const consumerKey = keySetting[0]?.setting_value;
        const consumerSecret = secretSetting[0]?.setting_value;

        if (!wooCommerceUrl || !consumerKey || !consumerSecret) {
            throw new Error("פרטי התחברות WooCommerce חסרים בהגדרות.");
        }

        const authString = btoa(`${consumerKey}:${consumerSecret}`);
        
        // Fetch recent orders (last 7 days)
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
        let createdCount = 0, updatedCount = 0, failedCount = 0, clientsCreated = 0;

        // Helper: delay to avoid rate limits
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (let idx = 0; idx < wooOrders.length; idx++) {
            const wooOrder = wooOrders[idx];
            // Throttle: pause every 5 orders to avoid rate limits
            if (idx > 0 && idx % 5 === 0) {
                await delay(2000);
            }
            try {
                // Only create/update client for PAID orders (processing, completed, on-hold)
                const isPaid = ['processing', 'completed', 'on-hold'].includes(wooOrder.status);
                
                let clientId = null;
                
                if (isPaid) {
                    // Find or create client with full details
                    clientId = await findOrCreateClient(sr, wooOrder);
                }

                // Check existing order
                const existingOrders = await sr.Order.filter({ external_order_number: wooOrder.id.toString() }, null, 1);
                
                // If order exists but didn't have client (was pending before), now link it
                if (existingOrders.length > 0 && clientId && !existingOrders[0].client_id) {
                    clientsCreated++;
                }
                
                // Extract billing note
                const billingNoteMeta = (wooOrder.meta_data || []).find(m => 
                    m.key === 'billing_note' || m.key === '_billing_note'
                );
                const customerNote = wooOrder.customer_note || billingNoteMeta?.value || '';

                const orderData = {
                    external_order_number: wooOrder.id.toString(),
                    client_id: clientId || (existingOrders[0]?.client_id || null),
                    order_date: wooOrder.date_created,
                    status: wooOrder.status,
                    total: wooOrder.total,
                    shipping_total: wooOrder.shipping_total,
                    shipping_method: wooOrder.shipping_lines?.[0]?.method_title || null,
                    payment_method_title: wooOrder.payment_method_title,
                    customer_note: customerNote,
                    raw_data_billing: JSON.stringify(wooOrder.billing),
                };

                if (existingOrders.length > 0) {
                    await sr.Order.update(existingOrders[0].id, orderData);
                    updatedCount++;

                    // Update products
                    const existingProducts = await sr.OrderProduct.filter({ order_id: existingOrders[0].id });
                    for (const product of existingProducts) {
                        await sr.OrderProduct.delete(product.id);
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
                        await sr.OrderProduct.bulkCreate(productItems);
                    }
                } else {
                    // Only create order if it has a client (paid) or we want to track pending too
                    if (!clientId) {
                        // For unpaid orders, still track them but without client
                        orderData.client_id = null;
                    }
                    const createdOrder = await sr.Order.create(orderData);
                    
                    if (Array.isArray(wooOrder.line_items) && wooOrder.line_items.length > 0) {
                        const productItems = wooOrder.line_items.map(item => ({
                            order_id: createdOrder.id,
                            external_order_id: wooOrder.id,
                            product_id: item.product_id,
                            name: item.name,
                            quantity: item.quantity,
                            total: item.total
                        }));
                        await sr.OrderProduct.bulkCreate(productItems);
                    }
                    
                    createdCount++;
                }

                // Update client stats for paid orders
                if (clientId && isPaid) {
                    try {
                        const clientOrders = await sr.Order.filter({ client_id: clientId });
                        const totalSpent = clientOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                        const totalOrders = clientOrders.length;
                        await sr.Client.update(clientId, {
                            total_spent: Math.round(totalSpent),
                            total_orders: totalOrders,
                            last_interaction_date: new Date().toISOString(),
                        });
                    } catch (statsErr) {
                        console.warn(`⚠️ Failed to update client stats: ${statsErr.message}`);
                    }
                }

            } catch (orderError) {
                failedCount++;
                console.error(`❌ Processing FAILED for order #${wooOrder.id}. Error: ${orderError.message}`);
            }
        }

        const message = `סנכרון הושלם: ${createdCount} הזמנות נוצרו, ${updatedCount} עודכנו, ${clientsCreated} לקוחות חדשים, ${failedCount} נכשלו.`;
        console.log(`✅ ${message}`);
        return Response.json({ success: true, message, created: createdCount, updated: updatedCount, clients_created: clientsCreated, failed: failedCount });

    } catch (error) {
        console.error("❌ Sync Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});