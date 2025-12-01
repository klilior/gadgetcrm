import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Webhook endpoint. Use POST.', { status: 200 });
    }

    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        const wooOrder = await req.json();
        
        if (!wooOrder || !wooOrder.id) {
            console.warn('Webhook received invalid or missing order data.');
            return new Response('OK', { status: 200 });
        }

        console.log(`📦 Webhook: Received update for order #${wooOrder.id}`);

        const orderData = {
            external_order_number: wooOrder.id.toString(),
            raw_data: JSON.stringify(wooOrder), // Store as string
        };

        const existingOrders = await base44.entities.Order.filter({
            external_order_number: wooOrder.id.toString(),
        });

        if (existingOrders.length > 0) {
            await base44.entities.Order.update(existingOrders[0].id, orderData);
            console.log(`✅ Webhook: Updated order #${wooOrder.id}.`);
        } else {
            await base44.entities.Order.create(orderData);
            console.log(`🆕 Webhook: Created new order #${wooOrder.id}.`);
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });

    } catch (error) {
        console.error('❌ Webhook Error:', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
    }
});