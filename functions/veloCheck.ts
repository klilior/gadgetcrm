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
    
    const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);
    
    if (sessions.length > 0) {
        const session = sessions[0];
        const issuedAt = new Date(session.issued_at).getTime() / 1000;
        const now = Date.now() / 1000;
        const timeLeft = (issuedAt + session.expiry) - now;
        
        if (timeLeft > 120) {
            console.log('✅ [VeloCheck] Using cached JWT');
            return session.jwt;
        }
        
        console.log('🔄 [VeloCheck] Refreshing JWT...');
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
                jwt: data.jwt, expiry: data.expiry, issued_at: new Date().toISOString()
            });
            console.log('✅ [VeloCheck] JWT refreshed');
            return data.jwt;
        }
        console.log('⚠️ [VeloCheck] Refresh failed, logging in...');
    }
    
    console.log('🔑 [VeloCheck] Performing login...');
    const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Velo-Api-Key': apiKey },
        body: JSON.stringify({ email, password })
    });
    
    if (!loginRes.ok) throw new Error(`Velo login failed: ${await loginRes.text()}`);
    
    const loginData = await loginRes.json();
    console.log('✅ [VeloCheck] Login successful');
    
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
        console.log('🔵 [VeloCheck] Starting...');
        
        const body = await req.json();
        const { orderId } = body;
        
        if (!orderId) {
            return Response.json({ success: false, error: 'חסר מספר הזמנה' }, { status: 200 });
        }
        
        // Get Velo provider config
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
        
        console.log('🔑 [VeloCheck] Auth ready (JWT + HMAC + Bearer)');
        
        // Get order and customer data
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
        
        const customer = order.client_id 
            ? await base44.asServiceRole.entities.Client.get(order.client_id) 
            : null;
        
        let billing = {};
        try { if (order.raw_data_billing) billing = JSON.parse(order.raw_data_billing); } catch (e) {}
        
        // Parse address
        let street = billing.address_1 || customer?.full_address || 'רחוב';
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
        const firstName = (billing.first_name || '').trim() || (customer?.full_name || '').split(/\s+/)[0] || 'לקוח';
        const lastName = (billing.last_name || '').trim() || (customer?.full_name || '').split(/\s+/).slice(1).join(' ') || '-';
        
        console.log('📍 [VeloCheck] Address:', { street, number, city: billing.city || customer?.city });
        
        // Build check payload matching working format
        const checkPayload = {
            weight: body.weight || 1,
            dimensions: body.dimensions || { width: 20, height: 10, depth: 15 },
            customerAddress: {
                first_name: firstName,
                last_name: lastName,
                street: street,
                number: number,
                line2: '',
                city: billing.city || customer?.city || '',
                zipcode: billing.postcode || '',
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
            }
        };
        
        console.log('📦 [VeloCheck] Payload:', JSON.stringify(checkPayload, null, 2));
        
        // Use enterprise endpoint
        const checkRes = await fetch(`${baseUrl || 'https://api.veloapp.io/api/enterprise'}/check`, {
            method: 'POST',
            headers,
            body: JSON.stringify(checkPayload)
        });
        
        const responseText = await checkRes.text();
        console.log('📡 [VeloCheck] Response status:', checkRes.status);
        console.log('📡 [VeloCheck] Response:', responseText);
        
        let checkData;
        try { checkData = JSON.parse(responseText); } catch (e) {
            return Response.json({ success: false, error: 'תגובה לא תקינה מ-Velo', debug: responseText }, { status: 200 });
        }
        
        if (checkData.fail === true) {
            let errorMsg = checkData.message || 'שגיאה מ-Velo API';
            if (checkData.errors) {
                const details = typeof checkData.errors === 'object'
                    ? Object.entries(checkData.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
                    : JSON.stringify(checkData.errors);
                errorMsg += ` - ${details}`;
            }
            return Response.json({ success: false, error: errorMsg, debug: checkData }, { status: 200 });
        }
        
        console.log('✅ [VeloCheck] Success');
        return Response.json({ success: true, options: checkData });
        
    } catch (error) {
        console.error('❌ [VeloCheck] Error:', error);
        return Response.json({ 
            success: false, error: error.message || 'שגיאה בבדיקת משלוח',
            details: error.stack
        }, { status: 200 });
    }
});