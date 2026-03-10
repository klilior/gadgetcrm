import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// HMAC for Velo API: jwt + apiKey (same as veloCheck)
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

    // Check for existing session
    const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);

    if (sessions.length > 0) {
        const session = sessions[0];
        const issuedAt = new Date(session.issued_at).getTime() / 1000;
        const now = Date.now() / 1000;
        const expiry = Number(session.expiry) || 0;
        const timeLeft = (issuedAt + expiry) - now;

        if (timeLeft > 120) {
            console.log('✅ Using cached JWT');
            return session.jwt;
        }

        // Try refresh
        try {
            console.log('🔄 Attempting JWT refresh...');
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
                console.log('✅ JWT refreshed successfully');
                return refreshData.jwt;
            }
        } catch (e) {
            console.warn('⚠️ JWT Refresh failed:', e.message);
        }
    }

    // Login
    console.log('🔐 Performing fresh login...');
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
    
    // Save session
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

    console.log('✅ Fresh login successful');
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
        const { apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET, email: VELO_EMAIL, password: VELO_PASSWORD } = config;
        
        if (!VELO_API_KEY || !VELO_API_SECRET || !VELO_EMAIL || !VELO_PASSWORD) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo (apiKey, apiSecret, email, password)' }, { status: 200 });
        }
        
        // Get JWT (same as veloCheck)
        console.log('🔑 [VeloOrder] Getting JWT...');
        const jwt = await getVeloJwt(base44, config);
        console.log('🔑 [VeloOrder] Got JWT');
        
        // Generate HMAC (jwt + apiKey - same as veloCheck)
        const hmac = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        console.log('🔑 [VeloOrder] Generated HMAC');
        
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
        
        // Build order payload using Velo WooCommerce API (same format as official plugin)
        const customerAddress = {
            first_name: billingAddress.first_name || customer.full_name?.split(' ')[0] || 'לקוח',
            last_name: billingAddress.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '',
            phone: (billingAddress.phone || customer.phone || '').replace(/\D/g, ''),
            email: billingAddress.email || customer.email || null,
            line1: streetName + (streetNumber ? ' ' + streetNumber : ''),
            line2: '',
            city: billingAddress.city || customer.city || '',
            zipcode: billingAddress.postcode || '',
            state: billingAddress.state || '',
            country: 'Israel',
        };

        const orderPayload = {
            external_id: order.external_order_number || order.id,
            weight: weight || 0,
            dimensions: dimensions || { width: 0, height: 0, depth: 0 },
            note: order.customer_note || `הזמנה #${order.external_order_number}`,
            storeAddress: config.storeAddress || {
                line1: '',
                line2: '',
                city: '',
                state: '',
                zipcode: '',
                phone: '',
                country: 'Israel'
            },
            customerAddress: customerAddress,
            products: products.map(p => ({
                name: p.name || 'מוצר',
                code: p.sku || p.product_id?.toString() || 'UNKNOWN',
                variation: null,
                price: parseFloat(p.total) || 0,
                quantity: p.quantity || 1,
                weight: 0
            }))
        };

        // Add polygonId and externalServiceId if selected from check
        if (polygonId) orderPayload.polygonId = polygonId;
        if (externalServiceId) orderPayload.externalServiceId = externalServiceId;
        
        console.log('📦 [VeloOrder] Order payload:', JSON.stringify(orderPayload, null, 2));
        
        // Use WooCommerce API endpoint (same as official Velo WooCommerce plugin)
        // This creates the order as "exported" directly, no separate accept step needed
        console.log('📦 [VeloOrder] Creating order via WooCommerce API...');
        const orderResponse = await fetch('https://api.veloapp.io/api/woocommerce/order', {
            method: 'POST',
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmac,
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify(orderPayload)
        });
        
        const responseText = await orderResponse.text();
        console.log('📦 [VeloOrder] Raw response status:', orderResponse.status);
        console.log('📦 [VeloOrder] Raw response:', responseText);
        
        let orderData;
        try {
            orderData = JSON.parse(responseText);
        } catch (e) {
            return Response.json({ success: false, error: 'תגובה לא תקינה מ-Velo', details: responseText }, { status: 200 });
        }
        
        console.log('📦 [VeloOrder] Parsed response:', JSON.stringify(orderData, null, 2));
        
        // Check for errors
        if (!orderResponse.ok || orderData.fail === true) {
            let errorMsg = orderData.message || orderData.error || 'שגיאה ביצירת משלוח';
            if (orderData.errors) {
                const errorDetails = Object.entries(orderData.errors)
                    .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
                    .join('; ');
                errorMsg = `${errorMsg} - ${errorDetails}`;
            }
            return Response.json({ success: false, error: errorMsg, details: orderData }, { status: 200 });
        }
        
        console.log('✅ [VeloOrder] Order created successfully');
        
        // Extract order name/ID from response
        const veloOrderName = orderData.data?.name || orderData.data?.id || orderData.name || orderData.id;
        console.log('📦 [VeloOrder] Velo Order Name:', veloOrderName);
        
        // Wait briefly then get label info
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get label/tracking info via label endpoint
        const labelHmac = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        
        let labelUrl = null;
        let trackingUrl = null;
        let shippingCode = null;
        let orderStatus = 'exported';
        
        if (veloOrderName) {
            // Try to get label
            console.log('📦 [VeloOrder] Fetching label for:', veloOrderName);
            const labelResponse = await fetch(`https://api.veloapp.io/api/woocommerce/label/${veloOrderName}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Velo-Api-Key': VELO_API_KEY,
                    'X-Velo-Hmac': labelHmac,
                    'Authorization': `Bearer ${jwt}`
                }
            });
            
            const labelText = await labelResponse.text();
            console.log('📦 [VeloOrder] Label response status:', labelResponse.status);
            console.log('📦 [VeloOrder] Label response:', labelText.substring(0, 500));
            
            // Check if the response is a PDF (binary) or JSON
            const contentType = labelResponse.headers.get('content-type') || '';
            if (contentType.includes('application/pdf') || labelText.startsWith('%PDF')) {
                // The label endpoint returned a PDF directly - we need to save it
                // For now, construct the label URL
                labelUrl = `https://api.veloapp.io/api/woocommerce/label/${veloOrderName}`;
                console.log('📄 [VeloOrder] Label is a PDF, URL:', labelUrl);
            } else {
                try {
                    const labelData = JSON.parse(labelText);
                    labelUrl = labelData.data?.label_pdf || labelData.data?.label || labelData.label_url || null;
                    trackingUrl = labelData.data?.tracking_url || labelData.data?.external_tracking_url || null;
                    shippingCode = labelData.data?.shipping_code || labelData.data?.barcode || null;
                    orderStatus = labelData.data?.status || 'exported';
                } catch (e) {
                    console.warn('⚠️ Could not parse label response as JSON');
                }
            }
            
            // Also try tracking endpoint
            const trackHmac = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
            const trackResponse = await fetch(`https://api.veloapp.io/api/woocommerce/track/${veloOrderName}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Velo-Api-Key': VELO_API_KEY,
                    'X-Velo-Hmac': trackHmac,
                    'Authorization': `Bearer ${jwt}`
                }
            });
            
            const trackText = await trackResponse.text();
            console.log('📦 [VeloOrder] Track response:', trackText.substring(0, 500));
            
            try {
                const trackData = JSON.parse(trackText);
                if (!trackingUrl) trackingUrl = trackData.data?.tracking_url || trackData.data?.external_tracking_url || null;
                if (!shippingCode) shippingCode = trackData.data?.shipping_code || trackData.data?.barcode || trackData.data?.tracking_number || null;
                if (trackData.data?.status) orderStatus = trackData.data.status;
            } catch (e) {
                console.warn('⚠️ Could not parse track response');
            }
        }
        
        // Use veloOrderName as fallback for shippingCode
        if (!shippingCode) shippingCode = veloOrderName;
        
        console.log('📋 [VeloOrder] Final data:', { shippingCode, labelUrl, trackingUrl, orderStatus });
        
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            shipment_type: 'standard',
            order_id: orderId,
            external_order_number: order.external_order_number || null,
            client_id: order.client_id || null,
            consignee_name: customerAddress.first_name + ' ' + customerAddress.last_name,
            consignee_phone: customerAddress.phone,
            consignee_city: customerAddress.city,
            consignee_street: streetName || null,
            consignee_house: streetNumber || null,
            consignee_zip: customerAddress.zipcode || null,
            status: 'created',
            tracking_number: shippingCode || null,
            weight: orderPayload.weight || 1,
            num_packages: 1,
            reference: `Velo:${veloOrderName || 'unknown'}`,
            notes: `Velo Order: ${veloOrderName || 'unknown'}`,
            api_response: orderData
        });
        
        return Response.json({
            success: true,
            shipment: {
                id: veloOrderName,
                shipping_code: shippingCode,
                label_url: labelUrl,
                tracking_url: trackingUrl,
                status: orderStatus
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