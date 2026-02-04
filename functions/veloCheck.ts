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
        console.log('🔵 [VeloCheck] Starting...');
        
        const body = await req.json();
        const { orderId } = body;
        
        if (!orderId) {
            return Response.json({ success: false, error: 'חסר מספר הזמנה' }, { status: 200 });
        }
        
        console.log('📦 [VeloCheck] Order ID:', orderId);
        
        // Get Velo provider
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });
        
        if (!providers || providers.length === 0) {
            return Response.json({ success: false, error: 'לא נמצא ספק Velo פעיל במערכת' }, { status: 200 });
        }
        
        const provider = providers[0];
        const config = provider.config || {};
        const { apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET, baseUrl } = config;
        const VELO_API_BASE = baseUrl || 'https://api.veloapp.io/api/enterprise';
        
        if (!VELO_API_KEY || !VELO_API_SECRET) {
            return Response.json({ 
                success: false, 
                error: 'חסרים פרטי התחברות ל-Velo. נא להגדיר ב-"הגדרות משלוחים"' 
            }, { status: 200 });
        }

        console.log('🔑 [VeloCheck] Getting JWT...');
        let jwt;
        try {
            jwt = await getVeloJwt(base44, config);
        } catch (e) {
            console.error('❌ [VeloCheck] Auth failed:', e.message);
            return Response.json({ success: false, error: `שגיאת אימות: ${e.message}` }, { status: 200 });
        }
        
        console.log('📥 [VeloCheck] Getting order data...');
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) {
            return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
        }
        
        const customer = await base44.asServiceRole.entities.Client.get(order.client_id);
        if (!customer) {
            return Response.json({ success: false, error: 'לקוח לא נמצא' }, { status: 200 });
        }
        
        // Parse billing
        let billing = {};
        try {
            if (order.raw_data_billing) billing = JSON.parse(order.raw_data_billing);
        } catch (e) {
            console.warn('⚠️ [VeloCheck] Failed to parse billing');
        }
        
        // Extract street and number from address_1 (e.g., "הפרחים 35" -> street: "הפרחים", number: "35")
        let streetName = billing.address_1 || customer.full_address || 'רחוב';
        let streetNumber = billing.address_2 || '';
        
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
        
        console.log('📍 [VeloCheck] Address parsed:', { street: streetName, number: streetNumber, city: billing.city || customer.city });
        
        // Call Velo Check
        console.log('🌐 [VeloCheck] Calling Velo API...');
        const hmac = await veloHmac({ jwt, apiKey: VELO_API_KEY, apiSecret: VELO_API_SECRET });
        
        const checkPayload = {
            weight: body.weight || 1.0,
            dimensions: body.dimensions || { width: 20, height: 10, depth: 15 },
            customerAddress: {
                first_name: billing.first_name || customer.full_name?.split(' ')[0] || 'לקוח',
                last_name: billing.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '',
                street: streetName,
                number: streetNumber,
                line2: '',
                city: billing.city || customer.city || 'תל אביב',
                zipcode: billing.postcode || '',
                state: billing.state || '',
                country: billing.country || 'Israel',
                phone: (billing.phone || customer.phone || '0500000000').replace(/\D/g, ''),
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
                state: 'Central',
                country: 'Israel',
                phone: '0300000000',
                longitude: '34.7655444',
                latitude: '32.073768'
            }
        };
        
        console.log('📦 [VeloCheck] Payload:', JSON.stringify(checkPayload, null, 2));
        
        const checkRes = await fetch(`${VELO_API_BASE}/check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY,
                'X-Velo-Hmac': hmac,
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify(checkPayload)
        });
        
        const responseText = await checkRes.text();
        console.log('📡 [VeloCheck] Response status:', checkRes.status);
        
        let checkData;
        try {
            checkData = JSON.parse(responseText);
        } catch (e) {
            return Response.json({ 
                success: false, 
                error: 'תגובה לא תקינה מ-Velo', 
                debug: responseText 
            }, { status: 200 });
        }
        
        if (!checkRes.ok) {
            // Build detailed error message from validation errors
            let errorMsg = checkData.message || checkData.error || 'שגיאה מ-Velo API';
            if (checkData.errors) {
                const errorDetails = Object.entries(checkData.errors)
                    .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
                    .join('; ');
                errorMsg = `${errorMsg} - ${errorDetails}`;
            }
            console.log('❌ [VeloCheck] Validation error:', JSON.stringify(checkData));
            return Response.json({ 
                success: false, 
                error: errorMsg, 
                debug: checkData 
            }, { status: 200 });
        }
        
        console.log('✅ [VeloCheck] Success');
        return Response.json({ success: true, options: checkData });
        
    } catch (error) {
        console.error('❌ [VeloCheck] FATAL ERROR:', error);
        return Response.json({ 
            success: false, 
            error: error.message || 'שגיאה כללית בבדיקת משלוח',
            details: error.stack
        }, { status: 200 });
    }
});