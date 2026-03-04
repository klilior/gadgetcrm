import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) {
        digits = digits.slice(3);
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

async function findOrCreateClient(sr, billing, shipping, customerId) {
    const phone = normalizePhone(billing?.phone) || normalizePhone(shipping?.phone);
    const email = billing?.email || '';
    const fullName = `${billing?.first_name || ''} ${billing?.last_name || ''}`.trim() || 'לקוח מהאתר';
    const city = billing?.city || shipping?.city || '';
    const address = billing?.address_1 ? `${billing.address_1}${billing.address_2 ? ' ' + billing.address_2 : ''}, ${city}` : '';

    // 1. By WooCommerce ID
    if (customerId && customerId > 0) {
        const byWoo = await sr.Client.filter({ woo_customer_id: customerId }, null, 1);
        if (byWoo.length > 0) {
            const updates = {};
            if (phone && !byWoo[0].phone) updates.phone = phone;
            if (email && !byWoo[0].email) updates.email = email;
            if (city && !byWoo[0].city) updates.city = city;
            if (address && !byWoo[0].full_address) updates.full_address = address;
            if (Object.keys(updates).length > 0) await sr.Client.update(byWoo[0].id, updates);
            return byWoo[0].id;
        }
    }

    // 2. By phone
    if (phone) {
        const byPhone = await sr.Client.filter({ phone }, null, 1);
        if (byPhone.length > 0) {
            const updates = {};
            if (customerId > 0 && !byPhone[0].woo_customer_id) updates.woo_customer_id = customerId;
            if (email && !byPhone[0].email) updates.email = email;
            if (Object.keys(updates).length > 0) await sr.Client.update(byPhone[0].id, updates);
            return byPhone[0].id;
        }
    }

    // 3. By email
    if (email) {
        const byEmail = await sr.Client.filter({ email }, null, 1);
        if (byEmail.length > 0) {
            const updates = {};
            if (customerId > 0 && !byEmail[0].woo_customer_id) updates.woo_customer_id = customerId;
            if (phone && !byEmail[0].phone) updates.phone = phone;
            if (Object.keys(updates).length > 0) await sr.Client.update(byEmail[0].id, updates);
            return byEmail[0].id;
        }
    }

    // 4. Create new
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
    return newClient.id;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Webhook endpoint. Use POST.', { status: 200 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;
        const wooOrder = await req.json();
        
        if (!wooOrder || !wooOrder.id) {
            console.warn('Webhook received invalid data.');
            return new Response('OK', { status: 200 });
        }

        console.log(`📦 Webhook: Order #${wooOrder.id}, status: ${wooOrder.status}`);

        const isPaid = ['processing', 'completed', 'on-hold'].includes(wooOrder.status);

        // Find or create client only for paid orders
        let clientId = null;
        if (isPaid && wooOrder.billing) {
            clientId = await findOrCreateClient(sr, wooOrder.billing, wooOrder.shipping, wooOrder.customer_id);
            console.log(`👤 Client: ${clientId}`);
        }

        // Check existing
        const existingOrders = await sr.Order.filter({
            external_order_number: wooOrder.id.toString(),
        }, null, 1);

        const billingNoteMeta = (wooOrder.meta_data || []).find(m => 
            m.key === 'billing_note' || m.key === '_billing_note'
        );

        const orderData = {
            external_order_number: wooOrder.id.toString(),
            client_id: clientId || (existingOrders[0]?.client_id || null),
            order_date: wooOrder.date_created,
            status: wooOrder.status,
            total: wooOrder.total,
            shipping_total: wooOrder.shipping_total,
            shipping_method: wooOrder.shipping_lines?.[0]?.method_title || null,
            payment_method_title: wooOrder.payment_method_title,
            customer_note: wooOrder.customer_note || billingNoteMeta?.value || '',
            raw_data_billing: JSON.stringify(wooOrder.billing),
        };

        if (existingOrders.length > 0) {
            await sr.Order.update(existingOrders[0].id, orderData);
            
            // Update order products
            const existingProducts = await sr.OrderProduct.filter({ order_id: existingOrders[0].id });
            for (const p of existingProducts) await sr.OrderProduct.delete(p.id);
            
            if (Array.isArray(wooOrder.line_items) && wooOrder.line_items.length > 0) {
                await sr.OrderProduct.bulkCreate(wooOrder.line_items.map(item => ({
                    order_id: existingOrders[0].id,
                    external_order_id: wooOrder.id,
                    product_id: item.product_id,
                    name: item.name,
                    quantity: item.quantity,
                    total: item.total
                })));
            }
            console.log(`✅ Updated order #${wooOrder.id}`);
        } else {
            const createdOrder = await sr.Order.create(orderData);
            
            if (Array.isArray(wooOrder.line_items) && wooOrder.line_items.length > 0) {
                await sr.OrderProduct.bulkCreate(wooOrder.line_items.map(item => ({
                    order_id: createdOrder.id,
                    external_order_id: wooOrder.id,
                    product_id: item.product_id,
                    name: item.name,
                    quantity: item.quantity,
                    total: item.total
                })));
            }
            console.log(`🆕 Created order #${wooOrder.id}`);
        }

        // Update client stats for paid orders
        if (clientId && isPaid) {
            try {
                const allOrders = await sr.Order.filter({ client_id: clientId });
                const totalSpent = allOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                await sr.Client.update(clientId, {
                    total_spent: Math.round(totalSpent),
                    total_orders: allOrders.length,
                    last_interaction_date: new Date().toISOString(),
                });
            } catch (_e) {}
        }

        return Response.json({ success: true });
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});