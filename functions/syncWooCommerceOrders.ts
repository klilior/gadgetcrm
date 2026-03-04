import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// ─── Phone normalization (unified across all webhooks) ───
function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) {
        digits = digits.slice(3); // 9720... → 0...
    } else if (digits.length === 12 && digits.startsWith('972')) {
        digits = '0' + digits.slice(3);
    } else if (digits.startsWith('0972') && digits.length > 12) {
        digits = '0' + digits.slice(4);
    }
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    if (digits.length >= 9 && digits.length <= 11) {
        if (!digits.startsWith('0')) digits = '0' + digits;
        return digits.slice(0, 10);
    }
    return null;
}

function phoneVariants(phone) {
    if (!phone) return [];
    const variants = [phone];
    if (phone.startsWith('0') && phone.length === 10) {
        variants.push('972' + phone.slice(1));
        variants.push('+972' + phone.slice(1));
        variants.push('9720' + phone.slice(1));
        variants.push('+9720' + phone.slice(1));
    }
    return variants;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Retry helper for rate limits ───
async function withRetry(fn, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (err.message?.includes('Rate limit') && attempt < retries) {
                console.warn(`⏳ Rate limit, retrying in ${3 + attempt * 2}s...`);
                await delay(3000 + attempt * 2000);
                continue;
            }
            throw err;
        }
    }
}

// ─── Find or create client ───
async function findOrCreateClient(sr, wooOrder) {
    const billing = wooOrder.billing || {};
    const shipping = wooOrder.shipping || {};
    const customerId = wooOrder.customer_id;
    const phone = normalizePhone(billing.phone) || normalizePhone(shipping.phone);
    const email = (billing.email || '').toLowerCase().trim();
    const fullName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'לקוח מהאתר';
    const city = billing.city || shipping.city || '';
    const address = billing.address_1 ? `${billing.address_1}${billing.address_2 ? ' ' + billing.address_2 : ''}, ${city}` : '';

    // 1. By WooCommerce customer ID
    if (customerId && customerId > 0) {
        const byWoo = await sr.Client.filter({ woo_customer_id: customerId }, null, 1);
        if (byWoo.length > 0) {
            const updates = {};
            if (phone && !byWoo[0].phone) updates.phone = phone;
            if (email && !byWoo[0].email) updates.email = email;
            if (city && !byWoo[0].city) updates.city = city;
            if (address && !byWoo[0].full_address) updates.full_address = address;
            if (!byWoo[0].full_name || byWoo[0].full_name === 'לקוח חדש') updates.full_name = fullName;
            if (Object.keys(updates).length > 0) await sr.Client.update(byWoo[0].id, updates);
            return byWoo[0].id;
        }
    }

    // 2. By phone (all variants)
    if (phone) {
        for (const variant of phoneVariants(phone)) {
            const byPhone = await sr.Client.filter({ phone: variant }, null, 1);
            if (byPhone.length > 0) {
                const updates = {};
                if (customerId > 0 && !byPhone[0].woo_customer_id) updates.woo_customer_id = customerId;
                if (email && !byPhone[0].email) updates.email = email;
                if (byPhone[0].phone !== phone) updates.phone = phone; // normalize stored phone
                if (city && !byPhone[0].city) updates.city = city;
                if (address && !byPhone[0].full_address) updates.full_address = address;
                if (Object.keys(updates).length > 0) await sr.Client.update(byPhone[0].id, updates);
                return byPhone[0].id;
            }
        }
    }

    // 3. By email
    if (email) {
        const byEmail = await sr.Client.filter({ email }, null, 1);
        if (byEmail.length > 0) {
            const updates = {};
            if (customerId > 0 && !byEmail[0].woo_customer_id) updates.woo_customer_id = customerId;
            if (phone && !byEmail[0].phone) updates.phone = phone;
            if (city && !byEmail[0].city) updates.city = city;
            if (address && !byEmail[0].full_address) updates.full_address = address;
            if (Object.keys(updates).length > 0) await sr.Client.update(byEmail[0].id, updates);
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
    console.log(`🆕 Client: ${fullName} (${phone || email})`);
    return newClient.id;
}

// ─── Process a single order ───
async function processOrder(sr, wooOrder) {
    const isPaid = ['processing', 'completed', 'on-hold'].includes(wooOrder.status);
    let clientId = null;

    if (isPaid) {
        clientId = await findOrCreateClient(sr, wooOrder);
    }

    const existingOrders = await sr.Order.filter({ external_order_number: wooOrder.id.toString() }, null, 1);

    const billingNoteMeta = (wooOrder.meta_data || []).find(m =>
        m.key === 'billing_note' || m.key === '_billing_note'
    );

    const resolvedClientId = clientId || existingOrders[0]?.client_id || '';
    const orderData = {
        external_order_number: wooOrder.id.toString(),
        order_date: wooOrder.date_created,
        status: wooOrder.status,
        total: wooOrder.total,
        shipping_total: wooOrder.shipping_total,
        shipping_method: wooOrder.shipping_lines?.[0]?.method_title || null,
        payment_method_title: wooOrder.payment_method_title,
        customer_note: wooOrder.customer_note || billingNoteMeta?.value || '',
        raw_data_billing: JSON.stringify(wooOrder.billing),
    };

    // Only set client_id if we have a valid one (avoid null → validation error)
    if (resolvedClientId) {
        orderData.client_id = resolvedClientId;
    }

    const lineItems = Array.isArray(wooOrder.line_items) ? wooOrder.line_items : [];

    if (existingOrders.length > 0) {
        await sr.Order.update(existingOrders[0].id, orderData);

        // Refresh products
        const existingProducts = await sr.OrderProduct.filter({ order_id: existingOrders[0].id });
        if (existingProducts.length > 0) {
            for (const p of existingProducts) await sr.OrderProduct.delete(p.id);
        }
        if (lineItems.length > 0) {
            await sr.OrderProduct.bulkCreate(lineItems.map(item => ({
                order_id: existingOrders[0].id,
                external_order_id: wooOrder.id,
                product_id: item.product_id,
                name: item.name,
                quantity: item.quantity,
                total: item.total
            })));
        }
        return { action: 'updated', clientId };
    } else {
        const createdOrder = await sr.Order.create(orderData);
        if (lineItems.length > 0) {
            await sr.OrderProduct.bulkCreate(lineItems.map(item => ({
                order_id: createdOrder.id,
                external_order_id: wooOrder.id,
                product_id: item.product_id,
                name: item.name,
                quantity: item.quantity,
                total: item.total
            })));
        }
        return { action: 'created', clientId };
    }
}

// ─── Update client stats ───
async function updateClientStats(sr, clientId) {
    const clientOrders = await sr.Order.filter({ client_id: clientId });
    const totalSpent = clientOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    await sr.Client.update(clientId, {
        total_spent: Math.round(totalSpent),
        total_orders: clientOrders.length,
        last_interaction_date: new Date().toISOString(),
    });
}

// ─── Fetch all orders with pagination ───
async function fetchAllOrders(baseUrl, authString, afterDate) {
    let allOrders = [];
    let page = 1;
    const perPage = 50; // lower per-page to be safe with WC API

    while (true) {
        const url = `${baseUrl}/wp-json/wc/v3/orders?per_page=${perPage}&page=${page}&after=${afterDate}&orderby=date&order=desc`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Basic ${authString}` }
        });

        if (!response.ok) {
            throw new Error(`WooCommerce API error: ${response.status} - ${response.statusText}`);
        }

        const orders = await response.json();
        if (!orders || orders.length === 0) break;

        allOrders = allOrders.concat(orders);
        console.log(`📄 Page ${page}: ${orders.length} orders (total so far: ${allOrders.length})`);

        // If we got less than perPage, we've reached the last page
        if (orders.length < perPage) break;
        page++;

        // Small delay between pages
        await delay(500);
    }

    return allOrders;
}

// ─── Main handler ───
Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;

    try {
        console.log("🚀 [WooSync] Starting...");

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

        // Fetch last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const afterDate = sevenDaysAgo.toISOString();

        const wooOrders = await fetchAllOrders(wooCommerceUrl, authString, afterDate);
        console.log(`📦 Total orders from WooCommerce: ${wooOrders.length}`);

        let created = 0, updated = 0, failed = 0, clientsLinked = 0;

        for (let i = 0; i < wooOrders.length; i++) {
            // Throttle: pause every 2 orders to avoid rate limits
            if (i > 0 && i % 2 === 0) {
                await delay(2500);
            }

            try {
                const result = await withRetry(() => processOrder(sr, wooOrders[i]));

                if (result.action === 'created') created++;
                else updated++;

                // Update client stats
                if (result.clientId) {
                    clientsLinked++;
                    await withRetry(() => updateClientStats(sr, result.clientId));
                }
            } catch (err) {
                failed++;
                console.error(`❌ Order #${wooOrders[i].id}: ${err.message}`);
            }
        }

        const msg = `סנכרון WooCommerce הושלם: ${created} נוצרו, ${updated} עודכנו, ${clientsLinked} לקוחות שויכו, ${failed} נכשלו (מתוך ${wooOrders.length}).`;
        console.log(`✅ ${msg}`);
        return Response.json({ success: true, message: msg, created, updated, clients_linked: clientsLinked, failed, total: wooOrders.length });

    } catch (error) {
        console.error("❌ WooSync Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});