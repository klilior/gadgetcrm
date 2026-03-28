import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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
        console.log('🔐 [VeloAuth] Starting authentication...');

        // Get Velo provider from DB
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });

        if (!providers || providers.length === 0) {
            console.error('❌ [VeloAuth] No active Velo provider found');
            return Response.json({
                success: false,
                error: 'לא נמצא ספק Velo פעיל במערכת'
            }, { status: 500 });
        }

        const provider = providers[0];
        const config = provider.config || {};
        
        const VELO_API_BASE = config.baseUrl || 'https://api.veloapp.io/api/enterprise';
        const VELO_API_KEY = config.apiKey;
        const VELO_API_SECRET = config.apiSecret;
        const VELO_EMAIL = config.email;
        const VELO_PASSWORD = config.password;

        if (!VELO_API_KEY || !VELO_API_SECRET || !VELO_EMAIL || !VELO_PASSWORD) {
            console.error('❌ [VeloAuth] Missing Velo credentials in config');
            return Response.json({
                success: false,
                error: 'חסרים פרטי התחברות ל-Velo. נא להגדיר בהגדרות ספקי משלוחים.'
            }, { status: 500 });
        }

        // Check if we have a valid session
        const sessions = await base44.asServiceRole.entities.VeloSession.list('-issued_at', 1);
        
        if (sessions.length > 0) {
            const session = sessions[0];
            const issuedAt = new Date(session.issued_at).getTime() / 1000;
            const now = Date.now() / 1000;
            const timeLeft = (issuedAt + session.expiry) - now;
            
            console.log(`⏱️ [VeloAuth] Existing session found, time left: ${Math.floor(timeLeft)}s`);
            
            // If more than 2 minutes left, use it
            if (timeLeft > 120) {
                console.log('✅ [VeloAuth] Using existing JWT');
                return Response.json({
                    success: true,
                    jwt: session.jwt,
                    expiry: session.expiry,
                    source: 'cached'
                });
            }
            
            // Try to refresh
            console.log('🔄 [VeloAuth] Attempting refresh...');
            try {
                const hmac = await veloHmac({
                    jwt: session.jwt,
                    apiKey: VELO_API_KEY,
                    apiSecret: VELO_API_SECRET
                });
                
                const refreshResponse = await fetch(`${VELO_API_BASE}/refresh`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Velo-Api-Key': VELO_API_KEY,
                        'X-Velo-Hmac': hmac,
                        'Authorization': `Bearer ${session.jwt}`
                    },
                    body: JSON.stringify({})
                });
                
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    console.log('✅ [VeloAuth] JWT refreshed successfully');
                    
                    // Update session
                    await base44.asServiceRole.entities.VeloSession.update(session.id, {
                        jwt: refreshData.jwt,
                        expiry: refreshData.expiry,
                        issued_at: new Date().toISOString()
                    });
                    
                    return Response.json({
                        success: true,
                        jwt: refreshData.jwt,
                        expiry: refreshData.expiry,
                        source: 'refreshed'
                    });
                }
                
                console.log('⚠️ [VeloAuth] Refresh failed, will login again');
            } catch (refreshError) {
                console.error('⚠️ [VeloAuth] Refresh error:', refreshError.message);
            }
        }
        
        // Login
        console.log('🔑 [VeloAuth] Performing login...');
        const loginResponse = await fetch(`${VELO_API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Velo-Api-Key': VELO_API_KEY
            },
            body: JSON.stringify({
                email: VELO_EMAIL,
                password: VELO_PASSWORD
            })
        });
        
        if (!loginResponse.ok) {
            const errorText = await loginResponse.text();
            console.error('❌ [VeloAuth] Login failed:', errorText);
            return Response.json({
                success: false,
                error: 'Login failed',
                details: errorText
            }, { status: loginResponse.status });
        }
        
        const loginData = await loginResponse.json();
        console.log('✅ [VeloAuth] Login successful, expiry:', loginData.expiry);
        
        // Save new session
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
        
        return Response.json({
            success: true,
            jwt: loginData.jwt,
            expiry: loginData.expiry,
            source: 'fresh_login'
        });
        
    } catch (error) {
        console.error('❌ [VeloAuth] Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});