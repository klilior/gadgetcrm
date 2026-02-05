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

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🔵 [DebugVelo] Starting comprehensive debug...');
        
        // Get Velo provider config
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });
        
        if (!providers || providers.length === 0) {
            return Response.json({ error: 'No Velo provider found' }, { status: 200 });
        }
        
        const config = providers[0].config || {};
        const { apiKey, apiSecret, email, password, baseUrl } = config;
        const VELO_API_BASE = baseUrl || 'https://api.veloapp.io/api/enterprise';
        
        console.log('📋 Config:', { 
            apiKey: apiKey ? `${apiKey.slice(0,6)}...` : 'MISSING',
            apiSecret: apiSecret ? `${apiSecret.slice(0,6)}...` : 'MISSING',
            email,
            baseUrl: VELO_API_BASE
        });
        
        // Force fresh login to ensure valid JWT
        console.log('🔐 Performing fresh login...');
        const loginRes = await fetch(`${VELO_API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': apiKey
            },
            body: JSON.stringify({ email, password })
        });
        
        const loginText = await loginRes.text();
        console.log('🔑 Login response status:', loginRes.status);
        console.log('🔑 Login response:', loginText);
        
        if (!loginRes.ok) {
            return Response.json({ 
                error: 'Login failed', 
                status: loginRes.status,
                response: loginText 
            }, { status: 200 });
        }
        
        const loginData = JSON.parse(loginText);
        const jwt = loginData.jwt;
        
        console.log('✅ Got fresh JWT');
        
        // Generate HMAC
        const hmac = await veloHmac({ jwt, apiKey, apiSecret });
        console.log('🔐 Generated HMAC:', hmac.slice(0, 20) + '...');
        
        // Build exact payload matching what support sent
        const checkPayload = {
            weight: 1,
            dimensions: {
                width: 20,
                height: 10,
                depth: 15
            },
            customerAddress: {
                first_name: "עומר",
                last_name: "ענבר",
                street: "הפרחים",
                number: "35",
                line2: "",
                city: "כרמיאל",
                zipcode: "2160237",
                state: "",
                country: "Israel",
                phone: "972547827289",
                longitude: "",
                latitude: ""
            },
            storeAddress: {
                first_name: "Gadget",
                last_name: "Team",
                street: "סביונים",
                number: "1",
                line2: "",
                city: "יהוד",
                zipcode: "",
                state: "Central",
                country: "Israel",
                phone: "0300000000",
                longitude: "34.7655444",
                latitude: "32.073768"
            }
        };
        
        // Build headers exactly
        const headers = {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': apiKey,
            'X-Velo-Hmac': hmac,
            'Authorization': `Bearer ${jwt}`
        };
        
        console.log('📤 Request URL:', `${VELO_API_BASE}/check`);
        console.log('📤 Request Headers:', JSON.stringify({
            'Content-Type': headers['Content-Type'],
            'X-Velo-Api-Key': headers['X-Velo-Api-Key'],
            'X-Velo-Hmac': headers['X-Velo-Hmac'].slice(0, 20) + '...',
            'Authorization': 'Bearer ' + jwt.slice(0, 30) + '...'
        }, null, 2));
        console.log('📤 Request Body:', JSON.stringify(checkPayload, null, 2));
        
        // Make the request
        const checkRes = await fetch(`${VELO_API_BASE}/check`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(checkPayload)
        });
        
        const responseText = await checkRes.text();
        console.log('📥 Response Status:', checkRes.status);
        console.log('📥 Response Headers:', JSON.stringify(Object.fromEntries(checkRes.headers.entries()), null, 2));
        console.log('📥 Response Body:', responseText);
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = { raw: responseText };
        }
        
        // Return full debug info
        return Response.json({
            success: checkRes.ok,
            request: {
                url: `${VELO_API_BASE}/check`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Velo-Api-Key': apiKey,
                    'X-Velo-Hmac': hmac,
                    'Authorization': `Bearer ${jwt}`
                },
                body: checkPayload
            },
            response: {
                status: checkRes.status,
                headers: Object.fromEntries(checkRes.headers.entries()),
                body: responseData
            }
        }, { status: 200 });
        
    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 200 });
    }
});