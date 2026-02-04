import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

async function veloHmac({ jwt, apiKey, apiSecret }) {
    const payload = `${jwt}${apiKey}`;
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
            const hmac = await veloHmac({ jwt: session.jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
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
        const { apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET, baseUrl } = config;
        const VELO_API_BASE = baseUrl || 'https://api.veloapp.io/api/enterprise';
        
        if (!VELO_API_KEY || !VELO_API_SECRET) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo' }, { status: 200 });
        }
        
        let jwt;
        try {
            jwt = await getVeloJwt(base44, config);
        } catch (e) {
            return Response.json({ success: false, error: `שגיאת אימות: ${e.message}` }, { status: 200 });
        }
        
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
        
        const hmac = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        
        const orderPayload = {
            polygon_id: polygonId,
            external_service_id: externalServiceId || null,
            weight: weight || 1.0,
            dimensions: dimensions || { width: 20, height: 10, depth: 15 },
            note: `הזמנה #${order.external_order_number}`,
            customerAddress: {
                first_name: billingAddress.first_name || customer.full_name?.split(' ')[0] || 'לקוח',
                last_name: billingAddress.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '',
                street: streetName,
                number: streetNumber,
                line2: '',
                city: billingAddress.city || customer.city || '',
                zipcode: billingAddress.postcode || '',
                state: billingAddress.state || '',
                country: billingAddress.country || 'Israel',
                phone: (billingAddress.phone || customer.phone || '').replace(/\D/g, ''),
                longitude: '',
                latitude: ''
            },
            billingAddress: null,
            storeAddress: {
                first_name: 'Gadget',
                last_name: 'Team',
                street: 'סביונים',
                number: '1',
                line2: '',
                city: 'יהוד',
                zipcode: '',
                state: 'Central',
                country: 'Israel',
                phone: '0300000000',
                longitude: '34.7655444',
                latitude: '32.073768'
            },
            products: products.map(p => ({
                name: p.name,
                code: p.product_id?.toString() || 'UNKNOWN',
                variation: '',
                price: parseFloat(p.total) || 0,
                quantity: p.quantity || 1
            }))
        };
        
        const orderResponse = await fetch(`${VELO_API_BASE}/order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmac,
                'Authorization': `Bearer ${jwt}`
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
        
        if (!orderResponse.ok) {
            return Response.json({ success: false, error: 'Order failed', details: orderData }, { status: 200 });
        }
        
        const currentUser = await base44.auth.me().catch(() => null);
        
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            order_id: orderId,
            external_order_number: order.external_order_number,
            client_id: order.client_id,
            provider_id: 'velo',
            status: 'created',
            tracking_number: orderData.shipping_code || null,
            shipment_id: orderData.id?.toString() || null,
            shipping_address: orderPayload.customerAddress,
            pickup_address: orderPayload.storeAddress,
            package_details: { weight: orderPayload.weight, dimensions: orderPayload.dimensions },
            created_by: currentUser?.id || null,
            raw_request: orderPayload,
            raw_response: orderData
        });
        
        return Response.json({
            success: true,
            shipment: orderData,
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