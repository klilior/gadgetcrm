import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Enterprise HMAC: sha256(jwt + apiKey, secret=apiSecret)
async function veloHmac(jwt, apiKey, apiSecret) {
    const payload = `${jwt}${apiKey}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function getVeloJwt(base44, config) {
    const { apiKey, apiSecret, email, password, baseUrl } = config;
    
    // Check existing session
    const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);
    
    if (sessions.length > 0) {
        const session = sessions[0];
        const issuedAt = new Date(session.issued_at).getTime() / 1000;
        const now = Date.now() / 1000;
        const timeLeft = (issuedAt + session.expiry) - now;
        
        if (timeLeft > 120) {
            console.log('✅ [VeloOrder] Using cached JWT, time left:', Math.floor(timeLeft), 's');
            return session.jwt;
        }
        
        // Try refresh
        console.log('🔄 [VeloOrder] Refreshing JWT...');
        const hmac = await veloHmac(session.jwt, apiKey, apiSecret);
        const refreshRes = await fetch(`${baseUrl}/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': apiKey,
                'X-Velo-Hmac': hmac,
                'Authorization': `Bearer ${session.jwt}`
            },
            body: JSON.stringify({})
        });
        
        if (refreshRes.ok) {
            const data = await refreshRes.json();
            await base44.asServiceRole.entities.VeloSession.update(session.id, {
                jwt: data.jwt,
                expiry: data.expiry,
                issued_at: new Date().toISOString()
            });
            console.log('✅ [VeloOrder] JWT refreshed');
            return data.jwt;
        }
        console.log('⚠️ [VeloOrder] Refresh failed, logging in...');
    }
    
    // Fresh login
    console.log('🔑 [VeloOrder] Performing login...');
    const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Velo-Api-Key': apiKey },
        body: JSON.stringify({ email, password })
    });
    
    if (!loginRes.ok) {
        const err = await loginRes.text();
        throw new Error(`Velo login failed: ${err}`);
    }
    
    const loginData = await loginRes.json();
    console.log('✅ [VeloOrder] Login successful');
    
    if (sessions.length > 0) {
        await base44.asServiceRole.entities.VeloSession.update(sessions[0].id, {
            jwt: loginData.jwt, expiry: loginData.expiry,
            issued_at: new Date().toISOString(), user_email: email
        });
    } else {
        await base44.asServiceRole.entities.VeloSession.create({
            jwt: loginData.jwt, expiry: loginData.expiry,
            issued_at: new Date().toISOString(), user_email: email
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
        
        // Get Provider config
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo', is_active: true
        });
        if (!providers?.length) {
            return Response.json({ success: false, error: 'לא נמצא ספק Velo פעיל' }, { status: 200 });
        }

        const config = providers[0].config || {};
        const { apiKey, apiSecret, email, baseUrl } = config;
        
        if (!apiKey || !apiSecret || !email) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo' }, { status: 200 });
        }
        
        // Get JWT via Enterprise login
        const jwt = await getVeloJwt(base44, config);
        const hmac = await veloHmac(jwt, apiKey, apiSecret);
        const headers = {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': apiKey,
            'X-Velo-Hmac': hmac,
            'Authorization': `Bearer ${jwt}`
        };
        
        console.log('🔑 [VeloOrder] Auth ready (JWT + HMAC + Bearer)');
        
        // Get order and customer data
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
        
        const customer = order.client_id 
            ? await base44.asServiceRole.entities.Client.get(order.client_id) 
            : null;
        
        const products = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: orderId });
        
        let billing = {};
        try { billing = JSON.parse(order.raw_data_billing || '{}'); } catch (e) {}
        
        console.log('📋 [VeloOrder] Billing:', JSON.stringify(billing));
        
        // Resolve names
        const nameParts = (customer?.full_name || '').trim().split(/\s+/);
        const firstName = (billing.first_name || '').trim() || nameParts[0] || 'לקוח';
        const lastName = (billing.last_name || '').trim() || nameParts.slice(1).join(' ') || '-';
        
        console.log('👤 [VeloOrder] Name:', { firstName, lastName });
        
        // Parse address
        let street = billing.address_1 || customer?.full_address || '';
        let number = billing.address_2 || '';
        
        if (!number && street) {
            const match = street.match(/^(.+?)\s+(\d+[א-ת]?)$/);
            if (match) {
                street = match[1].trim();
                number = match[2];
            }
        }
        if (!number) number = '1';
        
        const phone = (billing.phone || customer?.phone || '').replace(/\D/g, '');
        const city = billing.city || customer?.city || '';
        const zipcode = billing.postcode || '';
        
        console.log('📍 [VeloOrder] Address:', { street, number, city });
        
        // Build payload matching working system format
        const orderPayload = {
            polygonId: polygonId,
            externalServiceId: externalServiceId || null,
            externalId: `Order${order.external_order_number || order.id}`,
            weight: weight || 1,
            dimensions: dimensions || { width: 20, height: 10, depth: 15 },
            note: order.customer_note || `הזמנה #${order.external_order_number}`,
            packagesCount: 1,
            first_name: firstName,
            last_name: lastName,
            customerAddress: {
                first_name: firstName,
                last_name: lastName,
                street: street,
                number: number,
                line2: '',
                city: city,
                zipcode: zipcode,
                state: '',
                country: 'Israel',
                phone: phone,
                longitude: '',
                latitude: ''
            },
            storeAddress: {
                first_name: 'Gadget',
                last_name: 'Team',
                street: 'סביונים',
                number: '1',
                line2: '',
                city: 'יהוד',
                zipcode: '',
                state: '',
                country: 'Israel',
                phone: phone,
                longitude: '',
                latitude: ''
            },
            products: products.map(p => ({
                name: p.name || 'מוצר',
                code: p.sku || p.product_id?.toString() || 'UNKNOWN',
                variation: '',
                price: parseFloat(p.total) || 0,
                quantity: p.quantity || 1
            }))
        };
        
        console.log('📦 [VeloOrder] Step 1 - Creating order...');
        console.log('📦 [VeloOrder] Payload:', JSON.stringify(orderPayload, null, 2));
        
        // Use enterprise endpoint
        const orderRes = await fetch(`${baseUrl || 'https://api.veloapp.io/api/enterprise'}/order`, {
            method: 'POST',
            headers,
            body: JSON.stringify(orderPayload)
        });
        
        const orderText = await orderRes.text();
        console.log('📦 [VeloOrder] Response status:', orderRes.status);
        console.log('📦 [VeloOrder] Response:', orderText);
        
        let orderData;
        try { orderData = JSON.parse(orderText); } catch (e) {
            return Response.json({ success: false, error: 'תגובה לא תקינה מ-Velo', details: orderText }, { status: 200 });
        }
        
        if (orderData.fail === true) {
            let errorMsg = orderData.message || 'שגיאה ביצירת הזמנה';
            if (orderData.errors) {
                const details = typeof orderData.errors === 'object' 
                    ? Object.entries(orderData.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
                    : JSON.stringify(orderData.errors);
                errorMsg += ` - ${details}`;
            }
            return Response.json({ success: false, error: errorMsg, details: orderData }, { status: 200 });
        }
        
        const veloOrderId = orderData.data?.name;
        if (!veloOrderId) {
            return Response.json({ success: false, error: 'לא התקבל מזהה הזמנה מ-Velo', details: orderData }, { status: 200 });
        }
        
        console.log('✅ [VeloOrder] Order created:', veloOrderId);
        
        // ===== STEP 2: Accept =====
        console.log('📦 [VeloOrder] Step 2 - Accept...');
        await new Promise(r => setTimeout(r, 1500));
        
        // Refresh HMAC with same JWT for subsequent calls
        const acceptRes = await fetch(`${baseUrl || 'https://api.veloapp.io/api/enterprise'}/accept`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ order_id: veloOrderId })
        });
        
        const acceptText = await acceptRes.text();
        console.log('📦 [VeloOrder] Accept response:', acceptText);
        
        let acceptData;
        try { acceptData = JSON.parse(acceptText); } catch (e) {
            acceptData = { fail: true, message: 'Invalid accept response' };
        }
        
        if (acceptData.fail === true) {
            console.warn('⚠️ [VeloOrder] Accept failed:', acceptData.message);
        }
        
        const barcode = acceptData.data?.barcode || null;
        const isConfirmed = !acceptData.fail && barcode;
        
        // ===== STEP 3: Label =====
        let labelUrl = null;
        if (isConfirmed) {
            console.log('📦 [VeloOrder] Step 3 - Label...');
            const labelRes = await fetch(`${baseUrl || 'https://api.veloapp.io/api/enterprise'}/label`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ order_id: veloOrderId })
            });
            const labelText = await labelRes.text();
            console.log('📦 [VeloOrder] Label response:', labelText.substring(0, 500));
            try {
                const labelData = JSON.parse(labelText);
                if (!labelData.fail) labelUrl = labelData.data?.label_pdf || labelData.data?.label || null;
            } catch (e) {}
        }
        
        // ===== STEP 4: Info =====
        console.log('📦 [VeloOrder] Step 4 - Info...');
        const infoRes = await fetch(`${baseUrl || 'https://api.veloapp.io/api/enterprise'}/info/${veloOrderId}`, {
            method: 'GET', headers
        });
        const infoText = await infoRes.text();
        console.log('📦 [VeloOrder] Info:', infoText.substring(0, 1000));
        
        let infoData = {};
        try { infoData = JSON.parse(infoText); } catch (e) {}
        
        const trackingUrl = infoData.data?.external_tracking_url || infoData.data?.tracking_link || null;
        const finalBarcode = barcode || infoData.data?.barcode || infoData.data?.shipping_code || null;
        const finalLabelUrl = labelUrl || infoData.data?.label_pdf || null;
        const finalStatus = infoData.data?.status || acceptData?.data?.status || 'placed';
        
        console.log('📋 [VeloOrder] Final:', { barcode: finalBarcode, label: finalLabelUrl, tracking: trackingUrl, status: finalStatus });
        
        // Save shipment
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            shipment_type: 'standard',
            order_id: orderId,
            external_order_number: order.external_order_number || null,
            client_id: order.client_id || null,
            consignee_name: `${firstName} ${lastName}`.trim(),
            consignee_phone: phone,
            consignee_city: city,
            consignee_street: street || null,
            consignee_house: number || null,
            consignee_zip: zipcode || null,
            status: isConfirmed ? 'created' : 'pending',
            tracking_number: finalBarcode || null,
            weight: orderPayload.weight || 1,
            num_packages: 1,
            reference: `Velo:${veloOrderId}`,
            notes: `Velo Order: ${veloOrderId}`,
            api_response: { order: orderData, accept: acceptData, info: infoData }
        });
        
        if (!isConfirmed) {
            return Response.json({
                success: true,
                warning: `המשלוח נוצר אך לא אושר (${acceptData?.message || 'unknown'}). יש לאשר במערכת Velo.`,
                shipment: { id: veloOrderId, shipping_code: finalBarcode, label_url: finalLabelUrl, tracking_url: trackingUrl, status: finalStatus },
                shipment_id: shipment.id
            });
        }
        
        return Response.json({
            success: true,
            shipment: { id: veloOrderId, shipping_code: finalBarcode, label_url: finalLabelUrl, tracking_url: trackingUrl, status: finalStatus },
            shipment_id: shipment.id
        });
        
    } catch (error) {
        console.error('❌ [VeloOrder] Error:', error);
        return Response.json({ 
            success: false, error: error.message || 'שגיאה ביצירת משלוח',
            details: error.stack
        }, { status: 200 });
    }
});