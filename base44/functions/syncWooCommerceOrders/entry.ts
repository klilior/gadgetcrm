import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ─── Phone normalization ───
function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
    else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('0972') && digits.length > 12) digits = '0' + digits.slice(4);
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
    }
    return variants;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Extract tracking from WooCommerce meta_data ───
function extractTrackingFromWoo(wooOrder) {
    const meta = wooOrder.meta_data || [];
    let tracking_number = '';
    let tracking_carrier = '';
    let tracking_url = '';

    // Common tracking plugins: WooCommerce Shipment Tracking, YITH, AfterShip, etc.
    const trackingKeys = [
        '_wc_shipment_tracking_items', 'wc_shipment_tracking_items',
        '_tracking_number', 'tracking_number',
        '_aftership_tracking_number', 'aftership_tracking_number',
        '_yith_tracking_code', 'yith_tracking_code',
        'pakkelabels_tracking_number'
    ];
    const carrierKeys = [
        '_tracking_provider', 'tracking_provider',
        '_aftership_tracking_provider', 'aftership_tracking_provider',
        '_yith_tracking_name', 'yith_tracking_name',
    ];
    const urlKeys = [
        '_tracking_link', 'tracking_link',
        '_aftership_tracking_url', 'aftership_tracking_url',
        '_yith_tracking_url', 'yith_tracking_url',
    ];

    // Check for shipment tracking items (array format from WooCommerce Shipment Tracking plugin)
    for (const m of meta) {
        if (trackingKeys.includes(m.key)) {
            if (Array.isArray(m.value) && m.value.length > 0) {
                const item = m.value[0]; // Take the first tracking item
                tracking_number = item.tracking_number || item.tracking_id || '';
                tracking_carrier = item.tracking_provider || item.custom_tracking_provider || '';
                tracking_url = item.tracking_link || item.custom_tracking_link || '';
            } else if (typeof m.value === 'string' && m.value.length > 2) {
                // Try to parse JSON
                try {
                    const parsed = JSON.parse(m.value);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        tracking_number = parsed[0].tracking_number || '';
                        tracking_carrier = parsed[0].tracking_provider || '';
                        tracking_url = parsed[0].tracking_link || '';
                    }
                } catch (_) {
                    // Plain string tracking number
                    tracking_number = m.value;
                }
            }
        }
    }

    // If not found yet, check individual meta keys
    if (!tracking_number) {
        for (const m of meta) {
            if (!tracking_number && trackingKeys.includes(m.key) && typeof m.value === 'string') {
                tracking_number = m.value;
            }
            if (!tracking_carrier && carrierKeys.includes(m.key) && typeof m.value === 'string') {
                tracking_carrier = m.value;
            }
            if (!tracking_url && urlKeys.includes(m.key) && typeof m.value === 'string') {
                tracking_url = m.value;
            }
        }
    }

    // Normalize carrier name
    if (tracking_carrier) {
        const lc = tracking_carrier.toLowerCase();
        if (lc.includes('cargo') || lc.includes('קארגו')) tracking_carrier = 'cargo';
        else if (lc.includes('ups')) tracking_carrier = 'ups';
        else if (lc.includes('getpackage') || lc.includes('get package')) tracking_carrier = 'getpackage';
        else if (lc.includes('velo')) tracking_carrier = 'velo';
    }

    return { tracking_number: tracking_number.trim(), tracking_carrier, tracking_url };
}

async function withRetry(fn, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (err.message?.includes('Rate limit') && attempt < retries) {
                const wait = 2000 + attempt * 3000;
                console.warn(`⏳ Rate limit, retry ${attempt + 1} in ${wait}ms...`);
                await delay(wait);
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

    if (phone) {
        for (const variant of phoneVariants(phone)) {
            const byPhone = await sr.Client.filter({ phone: variant }, null, 1);
            if (byPhone.length > 0) {
                const updates = {};
                if (customerId > 0 && !byPhone[0].woo_customer_id) updates.woo_customer_id = customerId;
                if (email && !byPhone[0].email) updates.email = email;
                if (byPhone[0].phone !== phone) updates.phone = phone;
                if (city && !byPhone[0].city) updates.city = city;
                if (address && !byPhone[0].full_address) updates.full_address = address;
                if (Object.keys(updates).length > 0) await sr.Client.update(byPhone[0].id, updates);
                return byPhone[0].id;
            }
        }
    }

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

// ─── Fetch all orders with pagination ───
async function fetchAllOrders(baseUrl, authString, afterDate) {
    let allOrders = [];
    let page = 1;
    const perPage = 100;

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
        console.log(`📄 Page ${page}: ${orders.length} orders (total: ${allOrders.length})`);

        if (orders.length < perPage) break;
        page++;
        await delay(300);
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

        // Fetch last 14 days (reduced from 30 for speed)
        const daysBack = new Date();
        daysBack.setDate(daysBack.getDate() - 14);
        const afterDate = daysBack.toISOString();

        const wooOrders = await fetchAllOrders(wooCommerceUrl, authString, afterDate);
        console.log(`📦 Total from WooCommerce: ${wooOrders.length}`);

        // Pre-fetch existing orders
        const existingOrderMap = {};
        const existingOrders = await sr.Order.filter({}, '-created_date', 500);
        for (const o of existingOrders) existingOrderMap[o.external_order_number] = o;

        // Categorize orders: status-only updates vs full processing
        const statusOnlyUpdates = []; // existing orders where only status changed
        const fullProcessing = [];     // new orders or orders needing client/products

        for (const wo of wooOrders) {
            const existing = existingOrderMap[wo.id.toString()];
            if (!existing) {
                // New order — full processing
                fullProcessing.push(wo);
            } else {
                // Check if any important fields changed
                const newShippingMethod = wo.shipping_lines?.[0]?.method_title || null;
                const pickupMeta = (wo.meta_data || []).find(m => m.key === 'pkps_json');
                const newPickupData = pickupMeta?.value ? (typeof pickupMeta.value === 'string' ? pickupMeta.value : JSON.stringify(pickupMeta.value)) : null;
                const newBilling = JSON.stringify(wo.billing || {});

                const hasStatusChange = existing.status !== wo.status;
                const hasShippingChange = newShippingMethod && newShippingMethod !== existing.shipping_method;
                const hasPickupChange = (newPickupData || null) !== (existing.pickup_point_data || null);
                const hasTotalChange = wo.total !== existing.total;
                const hasNoteChange = wo.customer_note && wo.customer_note !== existing.customer_note;
                const hasBillingChange = newBilling !== (existing.raw_data_billing || '{}');

                if (hasStatusChange || hasShippingChange || hasPickupChange || hasTotalChange || hasNoteChange || hasBillingChange) {
                    statusOnlyUpdates.push({ wo, existing, newShippingMethod, newPickupData, newBilling });
                }
                // Otherwise: unchanged, skip
            }
        }

        console.log(`🔍 ${statusOnlyUpdates.length} status updates, ${fullProcessing.length} new orders (${wooOrders.length - statusOnlyUpdates.length - fullProcessing.length} unchanged)`);

        let created = 0, updated = 0, failed = 0;

        // Phase 1: Fast status-only updates (lightweight, no client/product operations)
        for (let i = 0; i < statusOnlyUpdates.length; i++) {
            const { wo, existing, newShippingMethod, newPickupData, newBilling } = statusOnlyUpdates[i];
            try {
                const updateData = {};
                // Update all changed fields
                if (wo.status !== existing.status) updateData.status = wo.status;
                if (wo.total !== existing.total) updateData.total = wo.total;
                if (wo.customer_note && wo.customer_note !== existing.customer_note) updateData.customer_note = wo.customer_note;
                if (newShippingMethod && newShippingMethod !== existing.shipping_method) {
                    updateData.shipping_method = newShippingMethod;
                    updateData.shipping_total = wo.shipping_total;
                    console.log(`\u{1F69A} Shipping changed for #${wo.id}: ${existing.shipping_method} -> ${newShippingMethod}`);
                }
                if ((newPickupData || null) !== (existing.pickup_point_data || null)) {
                    updateData.pickup_point_data = newPickupData;
                    console.log(`\u{1F4CD} Pickup point updated for #${wo.id}`);
                }
                if (newBilling && newBilling !== (existing.raw_data_billing || '{}')) {
                    updateData.raw_data_billing = newBilling;
                }
                
                // Pull tracking info from WooCommerce meta_data
                const trackingInfo = extractTrackingFromWoo(wo);
                if (trackingInfo.tracking_number && trackingInfo.tracking_number !== existing.tracking_number) {
                    updateData.tracking_number = trackingInfo.tracking_number;
                    updateData.tracking_carrier = trackingInfo.tracking_carrier;
                    if (trackingInfo.tracking_url) updateData.tracking_url = trackingInfo.tracking_url;
                    console.log(`📦 Tracking found for #${wo.id}: ${trackingInfo.tracking_number} (${trackingInfo.tracking_carrier})`);
                    // Update client tracking info
                    if (existing.client_id) {
                        try {
                            await sr.Client.update(existing.client_id, {
                                last_tracking_number: trackingInfo.tracking_number,
                                last_tracking_carrier: trackingInfo.tracking_carrier,
                                last_tracking_url: trackingInfo.tracking_url || '',
                            });
                        } catch (_) {}
                    }
                }
                
                await withRetry(() => sr.Order.update(existing.id, updateData));
                updated++;
            } catch (err) {
                failed++;
                console.error(`❌ Status update #${wo.id}: ${err.message}`);
            }
            // Light delay — just 500ms since these are single updates
            if (i > 0 && i % 3 === 0) await delay(1500);
        }

        console.log(`✅ Phase 1 done: ${updated} status updates`);

        // Phase 2: Full processing for new orders
        for (let i = 0; i < fullProcessing.length; i++) {
            const wo = fullProcessing[i];
            try {
                const isPaidOrPending = ['processing', 'completed', 'on-hold', 'pending'].includes(wo.status);
                let clientId = null;
                if (isPaidOrPending) {
                    clientId = await withRetry(() => findOrCreateClient(sr, wo));
                }

                const pickupPointMeta = (wo.meta_data || []).find(m => m.key === 'pkps_json');
                let pickupPointData = null;
                if (pickupPointMeta?.value) {
                    pickupPointData = typeof pickupPointMeta.value === 'string' ? pickupPointMeta.value : JSON.stringify(pickupPointMeta.value);
                }

                const billingNoteMeta = (wo.meta_data || []).find(m => m.key === 'billing_note' || m.key === '_billing_note');

                // Extract tracking info
                const trackingInfo = extractTrackingFromWoo(wo);

                const orderData = {
                    external_order_number: wo.id.toString(),
                    order_date: wo.date_created,
                    status: wo.status,
                    total: wo.total,
                    shipping_total: wo.shipping_total,
                    shipping_method: wo.shipping_lines?.[0]?.method_title || null,
                    payment_method_title: wo.payment_method_title,
                    customer_note: wo.customer_note || billingNoteMeta?.value || '',
                    raw_data_billing: JSON.stringify(wo.billing),
                    pickup_point_data: pickupPointData,
                };
                if (clientId) orderData.client_id = clientId;
                if (trackingInfo.tracking_number) {
                    orderData.tracking_number = trackingInfo.tracking_number;
                    orderData.tracking_carrier = trackingInfo.tracking_carrier;
                    orderData.tracking_url = trackingInfo.tracking_url;
                    console.log(`📦 Tracking for new #${wo.id}: ${trackingInfo.tracking_number}`);
                }

                const createdOrder = await withRetry(() => sr.Order.create(orderData));

                const lineItems = Array.isArray(wo.line_items) ? wo.line_items : [];
                if (lineItems.length > 0) {
                    await withRetry(() => sr.OrderProduct.bulkCreate(lineItems.map(item => ({
                        order_id: createdOrder.id,
                        external_order_id: wo.id,
                        product_id: item.product_id,
                        name: item.name,
                        quantity: item.quantity,
                        total: item.total,
                        meta_data: item.meta_data ? JSON.stringify(item.meta_data) : null
                    }))));
                }

                created++;

                // Update client stats
                if (clientId) {
                    const clientOrders = await withRetry(() => sr.Order.filter({ client_id: clientId }));
                    const totalSpent = clientOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                    const clientUpdate = {
                        total_spent: Math.round(totalSpent),
                        total_orders: clientOrders.length,
                        last_interaction_date: new Date().toISOString(),
                    };
                    if (trackingInfo.tracking_number) {
                        clientUpdate.last_tracking_number = trackingInfo.tracking_number;
                        clientUpdate.last_tracking_carrier = trackingInfo.tracking_carrier;
                        clientUpdate.last_tracking_url = trackingInfo.tracking_url || '';
                    }
                    await withRetry(() => sr.Client.update(clientId, clientUpdate));
                }
            } catch (err) {
                failed++;
                console.error(`❌ New order #${wo.id}: ${err.message}`);
            }
            // Heavier delay for full processing (lots of DB operations)
            await delay(2000);
        }

        // Phase 3: Check stale open orders not covered by the date range
        const openStatuses = ['processing', 'on-hold', 'pending'];
        const recentWooIds = new Set(wooOrders.map(wo => wo.id.toString()));
        const staleOpenOrders = existingOrders.filter(o => 
            openStatuses.includes(o.status) && !recentWooIds.has(o.external_order_number)
        );
        
        let staleUpdated = 0;
        if (staleOpenOrders.length > 0) {
            console.log(`🔄 Phase 3: Checking ${staleOpenOrders.length} stale open orders...`);
            for (const staleOrder of staleOpenOrders) {
                try {
                    const url = `${wooCommerceUrl}/wp-json/wc/v3/orders/${staleOrder.external_order_number}`;
                    const resp = await fetch(url, { headers: { 'Authorization': `Basic ${authString}` } });
                    if (!resp.ok) {
                        if (resp.status === 404) {
                            console.warn(`⚠️ Order #${staleOrder.external_order_number} not found in WooCommerce`);
                        }
                        continue;
                    }
                    const wo = await resp.json();
                    const updateData = {};
                    if (wo.status !== staleOrder.status) updateData.status = wo.status;
                    if (wo.total !== staleOrder.total) updateData.total = wo.total;
                    const newShipping = wo.shipping_lines?.[0]?.method_title || null;
                    if (newShipping && newShipping !== staleOrder.shipping_method) {
                        updateData.shipping_method = newShipping;
                        updateData.shipping_total = wo.shipping_total;
                    }
                    const pickupMeta = (wo.meta_data || []).find(m => m.key === 'pkps_json');
                    const newPickup = pickupMeta?.value ? (typeof pickupMeta.value === 'string' ? pickupMeta.value : JSON.stringify(pickupMeta.value)) : null;
                    if ((newPickup || null) !== (staleOrder.pickup_point_data || null)) updateData.pickup_point_data = newPickup;
                    if (wo.customer_note && wo.customer_note !== staleOrder.customer_note) updateData.customer_note = wo.customer_note;
                    const trackingInfo = extractTrackingFromWoo(wo);
                    if (trackingInfo.tracking_number && trackingInfo.tracking_number !== staleOrder.tracking_number) {
                        updateData.tracking_number = trackingInfo.tracking_number;
                        updateData.tracking_carrier = trackingInfo.tracking_carrier;
                        if (trackingInfo.tracking_url) updateData.tracking_url = trackingInfo.tracking_url;
                    }
                    if (Object.keys(updateData).length > 0) {
                        await withRetry(() => sr.Order.update(staleOrder.id, updateData));
                        staleUpdated++;
                        console.log(`✅ Stale #${staleOrder.external_order_number}: ${staleOrder.status} → ${updateData.status || staleOrder.status}`);
                    }
                    await delay(500);
                } catch (err) {
                    console.error(`❌ Stale check #${staleOrder.external_order_number}: ${err.message}`);
                }
            }
            console.log(`✅ Phase 3 done: ${staleUpdated} stale orders updated`);
        }

        updated += staleUpdated;
        const msg = `סנכרון WooCommerce הושלם: ${created} נוצרו, ${updated} עודכנו, ${failed} נכשלו (מתוך ${wooOrders.length}, +${staleOpenOrders.length} ישנות).`;
        console.log(`✅ ${msg}`);
        return Response.json({ success: true, message: msg, created, updated, failed, total: wooOrders.length, staleChecked: staleOpenOrders.length, staleUpdated });

    } catch (error) {
        console.error("❌ WooSync Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});