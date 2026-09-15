import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { resolveOrCreateCustomer, PRODUCERS } from '../../shared/customerIdentity.ts';

/**
 * BATCH 3 — WooCommerce is now a thin producer.
 * No local normalization, no find-first behaviour, no direct Client.create.
 * Registered customers: Woo customer ID is the primary external identity and beats phone.
 * Guest orders: billing/shipping phone + valid email + corroborating name, never name-only.
 */
async function resolveClientForWooOrder(base44, billing, shipping, customerId, orderId) {
    const rawPhone = billing?.phone || shipping?.phone || null;
    const email = billing?.email || '';
    const fullName = `${billing?.first_name || ''} ${billing?.last_name || ''}`.trim() || 'לקוח מהאתר';
    const city = billing?.city || shipping?.city || '';
    const address = billing?.address_1 ? `${billing.address_1}${billing.address_2 ? ' ' + billing.address_2 : ''}, ${city}` : '';
    const registeredId = Number(customerId) > 0 ? Number(customerId) : null;

    const result = await resolveOrCreateCustomer(
        base44,
        {
            producer: PRODUCERS.WOOCOMMERCE_WEBHOOK,
            phone: rawPhone,
            email,
            name: fullName,
            woo_customer_id: registeredId,
            source_record_id: `WOO_ORDER_${orderId}`,
        },
        {
            full_name: fullName,
            phone: rawPhone,
            email: email || null,
            city: city || null,
            full_address: address || null,
            source: 'WooCommerce',
            preferred_channel: 'website',
        },
    );

    if (result.status !== 'MATCHED' || !result.client_id) {
        console.warn(`⛔ Customer not resolved for Woo order #${orderId}: ${result.status} (${result.evidence || ''})`);
        return { clientId: null, result };
    }

    // Enrich empty fields only. A changed phone on a known Woo customer never creates a new Client.
    const sr = base44.asServiceRole.entities;
    const client = await sr.Client.get(result.client_id).catch(() => null);
    if (client && !result.created) {
        const updates = {};
        if (rawPhone && !client.phone) updates.phone = rawPhone;
        if (email && !client.email) updates.email = email;
        if (city && !client.city) updates.city = city;
        if (address && !client.full_address) updates.full_address = address;
        if (registeredId && !client.woo_customer_id) updates.woo_customer_id = registeredId;
        if (Object.keys(updates).length > 0) await sr.Client.update(client.id, updates);
    }

    return { clientId: result.client_id, result };
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
        let identityStatus = null;
        if (isPaid && wooOrder.billing) {
            const resolved = await resolveClientForWooOrder(base44, wooOrder.billing, wooOrder.shipping, wooOrder.customer_id, wooOrder.id);
            clientId = resolved.clientId;
            identityStatus = resolved.result?.status || null;
            console.log(`👤 Client: ${clientId || 'unresolved'} (${identityStatus})`);
        }

        // Check existing
        const existingOrders = await sr.Order.filter({
            external_order_number: wooOrder.id.toString(),
        }, null, 1);

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
        // Only set client_id if valid (avoid null → validation error)
        if (resolvedClientId) {
            orderData.client_id = resolvedClientId;
        }

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

        return Response.json({ success: true, client_id: clientId, identity_status: identityStatus });
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});