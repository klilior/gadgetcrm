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
        console.log('🧪 [TestVeloAuth] === START ===');
        
        // Get provider
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });
        
        if (!providers || providers.length === 0) {
            console.log('❌ No Velo provider found');
            return Response.json({
                success: false,
                error: 'לא נמצא ספק Velo פעיל במערכת'
            });
        }
        
        const config = providers[0].config || {};
        const VELO_API_KEY = config.apiKey;
        const VELO_API_SECRET = config.apiSecret;
        const VELO_EMAIL = config.email;
        const VELO_PASSWORD = config.password;
        const VELO_API_BASE = config.baseUrl || 'https://api.veloapp.io/api/enterprise';
        
        console.log('🔍 [TestVeloAuth] Config check:');
        console.log('  API Key:', VELO_API_KEY ? `${VELO_API_KEY.substring(0, 8)}...` : 'MISSING');
        console.log('  API Secret:', VELO_API_SECRET ? `${VELO_API_SECRET.substring(0, 8)}...` : 'MISSING');
        console.log('  Email:', VELO_EMAIL || 'MISSING');
        console.log('  Password:', VELO_PASSWORD ? '***' : 'MISSING');
        console.log('  Base URL:', VELO_API_BASE);
        
        if (!VELO_API_KEY || !VELO_API_SECRET || !VELO_EMAIL || !VELO_PASSWORD) {
            return Response.json({
                success: false,
                error: 'חסרים פרטי התחברות',
                details: {
                    hasKey: !!VELO_API_KEY,
                    hasSecret: !!VELO_API_SECRET,
                    hasEmail: !!VELO_EMAIL,
                    hasPassword: !!VELO_PASSWORD
                }
            });
        }
        
        // Try login
        console.log('🔐 [TestVeloAuth] Attempting login...');
        console.log('URL:', `${VELO_API_BASE}/login`);
        
        const loginPayload = {
            email: VELO_EMAIL,
            password: VELO_PASSWORD
        };
        
        console.log('📤 Request payload:', JSON.stringify({ ...loginPayload, password: '***' }));
        
        const loginResponse = await fetch(`${VELO_API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY
            },
            body: JSON.stringify(loginPayload)
        });
        
        console.log('📡 [TestVeloAuth] Login response status:', loginResponse.status);
        console.log('📡 Response headers:', Object.fromEntries(loginResponse.headers.entries()));
        
        const responseText = await loginResponse.text();
        console.log('📡 [TestVeloAuth] Login response body:', responseText);
        
        if (!loginResponse.ok) {
            let errorDetails = responseText;
            try {
                errorDetails = JSON.parse(responseText);
            } catch (e) {
                // Keep as text
            }
            
            return Response.json({
                success: false,
                error: 'התחברות נכשלה',
                status: loginResponse.status,
                response: errorDetails,
                hint: loginResponse.status === 401 ? 'פרטי ההתחברות שגויים - בדוק Email, Password ו-API Key' : null
            });
        }
        
        const loginData = JSON.parse(responseText);
        console.log('✅ [TestVeloAuth] Login successful!');
        console.log('JWT length:', loginData.jwt?.length);
        console.log('Expiry:', loginData.expiry);
        
        // Test refresh
        if (loginData.jwt) {
            try {
                console.log('🔄 [TestVeloAuth] Testing JWT refresh...');
                const hmac = await veloHmac({
                    jwt: loginData.jwt,
                    apiKey: VELO_API_KEY,
                    apiSecret: VELO_API_SECRET
                });
                
                const refreshRes = await fetch(`${VELO_API_BASE}/refresh`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Velo-Api-Key': VELO_API_KEY,
                        'X-Velo-Hmac': hmac,
                        'Authorization': `Bearer ${loginData.jwt}`
                    },
                    body: JSON.stringify({})
                });
                
                console.log('📡 Refresh status:', refreshRes.status);
                
                if (refreshRes.ok) {
                    console.log('✅ Refresh test successful');
                } else {
                    console.warn('⚠️ Refresh failed but login works');
                }
            } catch (e) {
                console.warn('⚠️ Refresh test error:', e.message);
            }
        }
        
        // Save session
        console.log('💾 [TestVeloAuth] Saving session...');
        const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);
        
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
        
        console.log('✅ [TestVeloAuth] Session saved!');
        
        return Response.json({
            success: true,
            message: 'התחברות הצליחה!',
            jwt_length: loginData.jwt?.length,
            expiry: loginData.expiry
        });
        
    } catch (error) {
        console.error('❌ [TestVeloAuth] Error:', error);
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});