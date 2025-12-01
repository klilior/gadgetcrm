import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const body = await req.json();
        const { orderId, providerId, carrier, packageDetails } = body;

        console.log('📦 [CreateShipment] Request:', JSON.stringify(body, null, 2));

        if (!orderId || !providerId) {
            return Response.json({
                success: false,
                error: 'Missing required fields: orderId or providerId'
            }, { status: 400 });
        }

        // Get order
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) {
            return Response.json({
                success: false,
                error: 'Order not found'
            }, { status: 404 });
        }

        // Get client
        const client = await base44.asServiceRole.entities.Client.get(order.client_id);
        if (!client) {
            return Response.json({
                success: false,
                error: 'Client not found'
            }, { status: 404 });
        }

        // Get provider
        const provider = await base44.asServiceRole.entities.ShippingProvider.get(providerId);
        if (!provider || !provider.is_active) {
            return Response.json({
                success: false,
                error: 'Provider not found or inactive'
            }, { status: 404 });
        }

        console.log('✅ [CreateShipment] Using provider:', provider.name);

        // Parse billing address
        let billingAddress;
        try {
            billingAddress = JSON.parse(order.raw_data_billing || '{}');
        } catch (e) {
            billingAddress = {};
        }

        const shippingAddress = {
            name: client.full_name || `${billingAddress.first_name} ${billingAddress.last_name}`,
            phone: client.phone || billingAddress.phone,
            email: client.email || billingAddress.email,
            address: billingAddress.address_1 || client.full_address,
            city: billingAddress.city || client.city,
            zip: billingAddress.postcode
        };

        console.log('📍 [CreateShipment] Shipping address:', shippingAddress);

        // TODO: כאן תתווסף הלוגיקה הספציפית לכל ספק
        // לעת עתה, נשמור את המשלוח כ-pending
        
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            order_id: orderId,
            external_order_number: order.external_order_number,
            client_id: order.client_id,
            provider_id: providerId,
            carrier: carrier || null,
            status: 'pending',
            shipping_address: shippingAddress,
            package_details: packageDetails || {},
            created_by: (await base44.auth.me())?.id || null,
            raw_request: {
                orderId,
                providerId,
                carrier,
                packageDetails,
                shippingAddress
            }
        });

        console.log('✅ [CreateShipment] Shipment created:', shipment.id);

        // כאן נוסיף את הקריאה לספק החיצוני
        if (provider.provider_type === 'velo') {
            // TODO: קריאה ל-Velo API
            console.log('📞 [CreateShipment] Would call Velo API here');
        }

        return Response.json({
            success: true,
            shipment: shipment
        });

    } catch (error) {
        console.error('❌ [CreateShipment] Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});