import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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
            console.log('✅ [VeloOrder] Using cached JWT, time left:', Math.floor(timeLeft), 's');
            return session.jwt;
        }
        
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
        
        // Support two modes:
        // Mode 1 (existing): orderId + polygonId (WooCommerce orders)
        // Mode 2 (new): superpharm order data directly
        const isSuperPharm = !!body.superpharm;
        
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
        
        // Get JWT
        const jwt = await getVeloJwt(base44, config);
        const hmac = await veloHmac(jwt, apiKey, apiSecret);
        const headers = {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': apiKey,
            'X-Velo-Hmac': hmac,
            'Authorization': `Bearer ${jwt}`
        };
        
        console.log('🔑 [VeloOrder] Auth ready');

        let firstName, lastName, phone, city, street, number, zipcode, note, externalId, products, polygonId, externalServiceId, weight, dimensions;

        if (isSuperPharm) {
            // SuperPharm mode — data comes directly from frontend
            const sp = body.superpharm;
            firstName = sp.firstName || 'לקוח';
            lastName = sp.lastName || '-';
            phone = (sp.phone || '').replace(/\D/g, '');
            city = sp.city || '';
            street = sp.street || '';
            number = sp.number || '1';
            zipcode = sp.zip || '';
            note = sp.note || '';
            externalId = `SP-${sp.miraklOrderId}`;
            polygonId = null; // Let Velo auto-assign
            externalServiceId = sp.externalServiceId || null;
            weight = sp.weight || 1;
            dimensions = sp.dimensions || { width: 20, height: 10, depth: 15 };
            products = sp.products || [{ name: 'מוצר', code: 'SP', variation: '', price: 0, quantity: 1 }];
        } else {
            // WooCommerce mode — existing logic
            const { orderId, polygonId: pid, externalServiceId: esid, weight: w, dimensions: d } = body;
            
            if (!orderId) {
                return Response.json({ success: false, error: 'חסר מזהה הזמנה' }, { status: 200 });
            }
            
            polygonId = pid || null; // Optional — Velo auto-assigns if null
            externalServiceId = esid || null;
            weight = w || 1;
            dimensions = d || { width: 20, height: 10, depth: 15 };
            
            const order = await base44.asServiceRole.entities.Order.get(orderId);
            if (!order) return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
            
            const customer = order.client_id 
                ? await base44.asServiceRole.entities.Client.get(order.client_id) 
                : null;
            
            const orderProducts = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: orderId });
            
            let billing = {};
            try { billing = JSON.parse(order.raw_data_billing || '{}'); } catch (_e) {}
            
            const nameParts = (customer?.full_name || '').trim().split(/\s+/);
            firstName = (billing.first_name || '').trim() || nameParts[0] || 'לקוח';
            lastName = (billing.last_name || '').trim() || nameParts.slice(1).join(' ') || '-';
            
            street = billing.address_1 || customer?.full_address || '';
            number = billing.address_2 || '';
            if (!number && street) {
                const match = street.match(/^(.+?)\s+(\d+[א-ת]?)$/);
                if (match) { street = match[1].trim(); number = match[2]; }
            }
            if (!number) number = '1';
            
            phone = (billing.phone || customer?.phone || '').replace(/\D/g, '');
            city = billing.city || customer?.city || '';
            zipcode = billing.postcode || '';
            note = order.customer_note || `הזמנה #${order.external_order_number}`;
            externalId = `Order${order.external_order_number || order.id}`;
            
            products = orderProducts.map(p => ({
                name: p.name || 'מוצר',
                code: p.sku || p.product_id?.toString() || 'UNKNOWN',
                variation: '',
                price: parseFloat(p.total) || 0,
                quantity: p.quantity || 1
            }));
        }

        console.log('📍 [VeloOrder] Address:', { firstName, lastName, city, street, number });

        // ===== STEP 1: Create draft =====
        const orderPayload = {
            ...(polygonId ? { polygonId } : {}),
            externalServiceId: externalServiceId || null,
            externalId,
            weight: weight || 1,
            dimensions: dimensions || { width: 20, height: 10, depth: 15 },
            note,
            packagesCount: 1,
            customerAddress: {
                first_name: firstName,
                last_name: lastName,
                street, number, line2: '',
                city, zipcode,
                state: '', country: 'Israel',
                phone, longitude: '', latitude: ''
            },
            storeAddress: {
                first_name: 'Gadget', last_name: 'Team',
                street: 'סביונים', number: '1', line2: '',
                city: 'יהוד', zipcode: '', state: '', country: 'Israel',
                phone, longitude: '', latitude: ''
            },
            products: products.length > 0 ? products : [{ name: 'מוצר', code: 'SP', variation: '', price: 0, quantity: 1 }]
        };
        
        console.log('📦 [VeloOrder] Step 1 - Creating draft...');
        
        const apiBase = baseUrl || 'https://api.veloapp.io/api/enterprise';
        const orderRes = await fetch(`${apiBase}/order`, {
            method: 'POST', headers,
            body: JSON.stringify(orderPayload)
        });
        
        const orderText = await orderRes.text();
        console.log('📦 [VeloOrder] Step 1 response:', orderRes.status, orderText.substring(0, 500));
        
        let orderData;
        try { orderData = JSON.parse(orderText); } catch (_e) {
            return Response.json({ success: false, error: 'שגיאה ביצירת משלוח ב-Velo: תגובה לא תקינה', details: orderText }, { status: 200 });
        }
        
        if (orderData.fail === true) {
            let errorMsg = 'שגיאה ביצירת משלוח ב-Velo';
            if (orderData.errors) {
                const details = typeof orderData.errors === 'object' 
                    ? Object.entries(orderData.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
                    : JSON.stringify(orderData.errors);
                errorMsg += ` - ${details}`;
            } else if (orderData.message) {
                errorMsg += ` - ${orderData.message}`;
            }
            return Response.json({ success: false, error: errorMsg, details: orderData }, { status: 200 });
        }
        
        const veloOrderId = orderData.data?.name;
        if (!veloOrderId) {
            return Response.json({ success: false, error: 'שגיאה ביצירת משלוח ב-Velo: לא התקבל מזהה', details: orderData }, { status: 200 });
        }
        
        console.log('✅ [VeloOrder] Draft created:', veloOrderId);

        // ===== STEP 2: Accept (confirm the draft) =====
        console.log('📦 [VeloOrder] Step 2 - Accept...');
        await new Promise(r => setTimeout(r, 1500));
        
        const acceptRes = await fetch(`${apiBase}/accept`, {
            method: 'POST', headers,
            body: JSON.stringify({ order_id: veloOrderId })
        });
        
        const acceptText = await acceptRes.text();
        console.log('📦 [VeloOrder] Accept response:', acceptText.substring(0, 500));
        
        let acceptData;
        try { acceptData = JSON.parse(acceptText); } catch (_e) {
            acceptData = { fail: true, message: 'Invalid accept response' };
        }
        
        if (acceptData.fail === true) {
            console.warn('⚠️ [VeloOrder] Accept failed:', acceptData.message);
            return Response.json({
                success: false,
                error: `המשלוח נוצר אבל לא אושר — ${acceptData.message || 'פנה לתמיכה'}`,
                velo_order_id: veloOrderId,
                details: acceptData
            }, { status: 200 });
        }
        
        const barcode = acceptData.data?.barcode || null;
        console.log('✅ [VeloOrder] Accepted, barcode:', barcode);

        // ===== STEP 3: Get barcode (Cargo assigns asynchronously) =====
        let labelUrl = `https://api.veloapp.io/storage/stickers/${veloOrderId}.pdf`;
        let cargoBarcode = barcode;

        // Re-accept to try to get barcode (Cargo may have assigned it by now)
        if (!cargoBarcode) {
            await new Promise(r => setTimeout(r, 3000));
            console.log('📦 [VeloOrder] Step 3 - Re-accept to get Cargo barcode...');
            try {
                const reAcceptRes = await fetch(`${apiBase}/accept`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ order_id: veloOrderId })
                });
                const reAcceptText = await reAcceptRes.text();
                console.log('📦 [VeloOrder] Re-accept response:', reAcceptText.substring(0, 500));
                try {
                    const reAcceptData = JSON.parse(reAcceptText);
                    if (reAcceptData.data?.barcode) {
                        cargoBarcode = reAcceptData.data.barcode;
                        console.log('✅ [VeloOrder] Got barcode from re-accept:', cargoBarcode);
                    }
                } catch (_e) {}
            } catch (_e) {}
        }

        // If still no barcode after re-accept, try one more time with longer wait
        if (!cargoBarcode) {
            await new Promise(r => setTimeout(r, 3000));
            console.log('📦 [VeloOrder] Step 3b - Second re-accept attempt...');
            try {
                const reAcceptRes2 = await fetch(`${apiBase}/accept`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ order_id: veloOrderId })
                });
                const reAcceptText2 = await reAcceptRes2.text();
                console.log('📦 [VeloOrder] Second re-accept response:', reAcceptText2.substring(0, 500));
                try {
                    const reAcceptData2 = JSON.parse(reAcceptText2);
                    if (reAcceptData2.data?.barcode) {
                        cargoBarcode = reAcceptData2.data.barcode;
                        console.log('✅ [VeloOrder] Got barcode from second re-accept:', cargoBarcode);
                    }
                } catch (_e) {}
            } catch (_e) {}
        }

        const finalBarcode = cargoBarcode || veloOrderId;
        const finalLabelUrl = labelUrl;
        const finalStatus = 'confirmed';
        
        console.log('📋 [VeloOrder] Final:', { barcode: finalBarcode, label: finalLabelUrl, status: finalStatus });

        // Save shipment record (only for WooCommerce mode)
        if (!isSuperPharm && body.orderId) {
            await base44.asServiceRole.entities.Shipment.create({
                shipment_type: 'standard',
                order_id: body.orderId,
                external_order_number: externalId,
                consignee_name: `${firstName} ${lastName}`.trim(),
                consignee_phone: phone,
                consignee_city: city,
                consignee_street: street || null,
                consignee_house: number || null,
                consignee_zip: zipcode || null,
                status: 'created',
                tracking_number: finalBarcode || null,
                weight: weight || 1,
                num_packages: 1,
                reference: `Velo:${veloOrderId}`,
                notes: `Velo Order: ${veloOrderId}`,
                api_response: { order: orderData, accept: acceptData }
            });
        }
        
        return Response.json({
            success: true,
            tracking_number: finalBarcode,
            label_url: finalLabelUrl,
            velo_order_id: veloOrderId,
            service_name: 'קרגו שליחויות',
            status: finalStatus
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