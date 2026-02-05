import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

async function veloHmac({ email, apiKey, apiSecret }) {
    // HMAC is computed from: email + apiKey, using apiSecret as the key
    const payload = `${email}${apiKey}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiSecret);
    const messageData = encoder.encode(payload);
    
    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Note: The JSON API uses HMAC-based auth (email+apiKey), not JWT
// Keeping this for legacy enterprise API if needed
async function getVeloJwt(base44, config) {
    const { apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET, email: VELO_EMAIL, password: VELO_PASSWORD, baseUrl } = config;
    const VELO_API_BASE = baseUrl || 'https://api.veloapp.io/api/enterprise';

    const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);

    if (sessions.length > 0) {
        const session = sessions[0];
        const issuedAt = new Date(session.issued_at).getTime() / 1000;
        const now = Date.now() / 1000;
        const expiry = Number(session.expiry) || 0;
        const timeLeft = (issuedAt + expiry) - now;

        if (timeLeft > 120) {
            return session.jwt;
        }

        try {
            const hmac = await veloHmac({ email: VELO_EMAIL, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
            const refreshRes = await fetch(`${VELO_API_BASE}/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Velo-Api-Key': VELO_API_KEY,
                    'X-Velo-Hmac': hmac,
                    'Authorization': `Bearer ${session.jwt}`
                },
                body: JSON.stringify({})
            });

            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                await base44.asServiceRole.entities.VeloSession.update(session.id, {
                    jwt: refreshData.jwt,
                    expiry: refreshData.expiry,
                    issued_at: new Date().toISOString()
                });
                return refreshData.jwt;
            }
        } catch (e) {
            console.warn('JWT Refresh failed:', e);
        }
    }

    const loginRes = await fetch(`${VELO_API_BASE}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': VELO_API_KEY
        },
        body: JSON.stringify({ email: VELO_EMAIL, password: VELO_PASSWORD })
    });

    if (!loginRes.ok) {
        const err = await loginRes.text();
        throw new Error(`Velo Login Failed: ${err}`);
    }

    const loginData = await loginRes.json();
    
    if (sessions.length > 0) {
        await base44.asServiceRole.entities.VeloSession.update(sessions[0].id, {
            jwt: loginData.jwt,
            expiry: loginData.expiry,
            issued_at: new Date().toISOString(),
            user_email: VELO_EMAIL
        });
    } else {
        await base44.asServiceRole.entities.VeloSession.create({
            jwt: loginData.jwt,
            expiry: loginData.expiry,
            issued_at: new Date().toISOString(),
            user_email: VELO_EMAIL
        });
    }

    return loginData.jwt;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🔵 [VeloOrder] Starting...');
        
        const body = await req.json();
        const { orderId, polygonId, externalServiceId, weight, dimensions } = body;
        
        if (!orderId || !polygonId) {
            return Response.json({ success: false, error: 'חסרים שדות נדרשים' }, { status: 200 });
        }
        
        // Get Provider
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });

        if (!providers || providers.length === 0) {
            return Response.json({ success: false, error: 'לא נמצא ספק Velo פעיל' }, { status: 200 });
        }

        const provider = providers[0];
        const config = provider.config || {};
        const { apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET, email: VELO_EMAIL } = config;
        
        if (!VELO_API_KEY || !VELO_API_SECRET || !VELO_EMAIL) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo (apiKey, apiSecret, email)' }, { status: 200 });
        }
        
        // Generate HMAC for JSON API (email + apiKey)
        const hmac = await veloHmac({ email: VELO_EMAIL, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        console.log('🔑 [VeloOrder] Generated HMAC for:', VELO_EMAIL);
        
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) return Response.json({ success: false, error: 'Order not found' }, { status: 200 });
        
        const customer = await base44.asServiceRole.entities.Client.get(order.client_id);
        if (!customer) return Response.json({ success: false, error: 'Client not found' }, { status: 200 });
        
        const products = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: orderId });
        
        let billingAddress = {};
        try { 
            billingAddress = JSON.parse(order.raw_data_billing || '{}'); 
        } catch (e) {
            console.warn('Failed to parse billing', e);
        }
        
        // Extract street and number from address_1 (e.g., "הפרחים 35" -> street: "הפרחים", number: "35")
        let streetName = billingAddress.address_1 || customer.full_address || '';
        let streetNumber = billingAddress.address_2 || '';
        
        // If no address_2, try to extract number from end of address_1
        if (!streetNumber && streetName) {
            const match = streetName.match(/^(.+?)\s+(\d+[א-ת]?)$/);
            if (match) {
                streetName = match[1].trim();
                streetNumber = match[2];
            }
        }
        
        // Fallback to '1' if still no number
        if (!streetNumber) streetNumber = '1';
        
        console.log('📍 [VeloOrder] Address parsed:', { street: streetName, number: streetNumber, city: billingAddress.city || customer.city });
        
        // Build order payload per Velo JSON API spec
        const orderPayload = {
            polygonId: polygonId,
            externalServiceId: externalServiceId || null,
            externalId: `Order${order.external_order_number || order.id}`,
            weight: weight || 1,
            dimensions: dimensions || { width: 20, height: 10, depth: 15 },
            note: `הזמנה #${order.external_order_number}`,
            packagesCount: 1,
            customerAddress: {
                first_name: billingAddress.first_name || customer.full_name?.split(' ')[0] || 'לקוח',
                last_name: billingAddress.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '',
                street: streetName,
                number: streetNumber,
                line2: '',
                city: billingAddress.city || customer.city || '',
                zip: billingAddress.postcode || '',
                country: 'Israel',
                phone: (billingAddress.phone || customer.phone || '').replace(/\D/g, '')
            },
            products: products.map(p => ({
                name: p.name || 'מוצר',
                code: p.product_id?.toString() || 'UNKNOWN',
                variation: '',
                price: parseFloat(p.total) || 0,
                quantity: p.quantity || 1
            }))
        };
        
        console.log('📦 [VeloOrder] Order payload:', JSON.stringify(orderPayload, null, 2));
        
        // Step 1: Create order (status: "placed")
        console.log('📦 [VeloOrder] Creating order...');
        const orderResponse = await fetch('https://api.veloapp.io/api/json/v1/order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmac
            },
            body: JSON.stringify(orderPayload)
        });
        
        const responseText = await orderResponse.text();
        let orderData;
        try {
            orderData = JSON.parse(responseText);
        } catch (e) {
            return Response.json({ success: false, error: 'Invalid response from Velo', details: responseText }, { status: 200 });
        }
        
        if (!orderResponse.ok || !orderData.success) {
            return Response.json({ success: false, error: 'Order creation failed', details: orderData }, { status: 200 });
        }
        
        console.log('✅ [VeloOrder] Order created:', orderData);
        
        // Get the order ID from response
        const veloOrderId = orderData.data?.id || orderData.id;
        if (!veloOrderId) {
            return Response.json({ success: false, error: 'No order ID returned from Velo', details: orderData }, { status: 200 });
        }
        
        // Step 2: Confirm delivery (accept) - this generates the barcode/shipping_code
        console.log('📦 [VeloOrder] Confirming delivery for order:', veloOrderId);
        
        // Generate fresh HMAC for accept call
        const hmacAccept = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        
        const acceptResponse = await fetch('https://api.veloapp.io/api/json/v1/accept', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmacAccept
            },
            body: JSON.stringify({ order: veloOrderId })
        });
        
        const acceptText = await acceptResponse.text();
        let acceptData;
        try {
            acceptData = JSON.parse(acceptText);
        } catch (e) {
            console.error('Failed to parse accept response:', acceptText);
            acceptData = { error: 'Invalid accept response' };
        }
        
        console.log('✅ [VeloOrder] Accept response:', acceptData);
        
        // Step 3: Get order info to retrieve shipping code and label
        console.log('📦 [VeloOrder] Getting order info...');
        
        const hmacInfo = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        
        const infoResponse = await fetch(`https://api.veloapp.io/api/json/v1/info/${veloOrderId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmacInfo
            }
        });
        
        const infoText = await infoResponse.text();
        let infoData;
        try {
            infoData = JSON.parse(infoText);
        } catch (e) {
            console.error('Failed to parse info response:', infoText);
            infoData = {};
        }
        
        console.log('✅ [VeloOrder] Order info:', infoData);
        
        // Extract shipping code and label URL from info response
        const shippingCode = infoData.data?.shipping_code || acceptData.data?.shipping_code || orderData.data?.shipping_code;
        const labelUrl = infoData.data?.label_pdf || null;
        const trackingUrl = infoData.data?.external_tracking_url || infoData.data?.tracking_link || null;
        
        const currentUser = await base44.auth.me().catch(() => null);
        
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            order_id: orderId,
            external_order_number: order.external_order_number,
            client_id: order.client_id,
            provider_id: 'velo',
            status: acceptData.success ? 'confirmed' : 'created',
            tracking_number: shippingCode || null,
            shipment_id: veloOrderId?.toString() || null,
            shipping_address: orderPayload.customerAddress,
            pickup_address: null,
            package_details: { weight: orderPayload.weight, dimensions: orderPayload.dimensions },
            created_by: currentUser?.id || null,
            raw_request: orderPayload,
            raw_response: { order: orderData, accept: acceptData, info: infoData }
        });
        
        return Response.json({
            success: true,
            shipment: {
                id: veloOrderId,
                shipping_code: shippingCode,
                label_url: labelUrl,
                tracking_url: trackingUrl,
                status: infoData.data?.status || 'accepted'
            },
            shipment_id: shipment.id
        });
        
    } catch (error) {
        console.error('❌ [VeloOrder] Error:', error);
        return Response.json({ 
            success: false, 
            error: error.message || 'שגיאה ביצירת משלוח',
            details: error.stack
        }, { status: 200 });
    }
});