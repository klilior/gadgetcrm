import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Velo JSON API HMAC: sha256(email + apiKey, secret=apiSecret)
// Per official docs: "a string made of your email and API key"
async function veloHmac(email, apiKey, apiSecret) {
    const payload = `${email}${apiKey}`;
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
            provider_type: 'velo',
            is_active: true
        });
        
        if (!providers || providers.length === 0) {
            return Response.json({ success: false, error: 'לא נמצא ספק Velo פעיל במערכת' }, { status: 200 });
        }
        
        const config = providers[0].config || {};
        const { apiKey, apiSecret, email } = config;
        
        if (!apiKey || !apiSecret || !email) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo' }, { status: 200 });
        }

        // Build HMAC per official Velo JSON API docs
        const hmac = await veloHmac(email, apiKey, apiSecret);
        const headers = {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': apiKey,
            'X-Velo-Hmac': hmac
        };
        
        console.log('🔑 [VeloCheck] HMAC generated (email+apiKey method)');
        
        // Get order and customer data
        console.log('📥 [VeloCheck] Getting order data...');
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
        
        const customer = await base44.asServiceRole.entities.Client.get(order.client_id);
        if (!customer) return Response.json({ success: false, error: 'לקוח לא נמצא' }, { status: 200 });
        
        // Parse billing
        let billing = {};
        try {
            if (order.raw_data_billing) billing = JSON.parse(order.raw_data_billing);
        } catch (e) {}
        
        // Parse address: street and number
        let street = billing.address_1 || customer.full_address || 'רחוב';
        let number = billing.address_2 || '';
        
        if (!number && street) {
            const match = street.match(/^(.+?)\s+(\d+[א-ת]?)$/);
            if (match) {
                street = match[1].trim();
                number = match[2];
            }
        }
        if (!number) number = '1';
        
        console.log('📍 [VeloCheck] Address:', { street, number, city: billing.city || customer.city });
        
        // Build check payload per Velo JSON API docs
        const checkPayload = {
            weight: body.weight || 0,
            dimensions: body.dimensions || { width: 0, height: 0, depth: 0 },
            customerAddress: {
                street: street,
                number: number,
                city: billing.city || customer.city || '',
                zip: billing.postcode || '',
                country: 'Israel',
                phone: (billing.phone || customer.phone || '').replace(/\D/g, '')
            }
        };
        
        console.log('📦 [VeloCheck] Payload:', JSON.stringify(checkPayload, null, 2));
        
        const checkRes = await fetch('https://api.veloapp.io/api/json/v1/check', {
            method: 'POST',
            headers,
            body: JSON.stringify(checkPayload)
        });
        
        const responseText = await checkRes.text();
        console.log('📡 [VeloCheck] Response status:', checkRes.status);
        console.log('📡 [VeloCheck] Response body:', responseText);
        
        let checkData;
        try {
            checkData = JSON.parse(responseText);
        } catch (e) {
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
            success: false, 
            error: error.message || 'שגיאה בבדיקת משלוח',
            details: error.stack
        }, { status: 200 });
    }
});