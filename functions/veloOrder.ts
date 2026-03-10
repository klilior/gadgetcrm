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
        console.log('🔵 [VeloOrder] Starting...');
        
        const body = await req.json();
        const { orderId, polygonId, externalServiceId, weight, dimensions } = body;
        
        if (!orderId || !polygonId) {
            return Response.json({ success: false, error: 'חסרים שדות נדרשים' }, { status: 200 });
        }
        
        // Get Provider config
        const providers = await base44.asServiceRole.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });

        if (!providers || providers.length === 0) {
            return Response.json({ success: false, error: 'לא נמצא ספק Velo פעיל' }, { status: 200 });
        }

        const config = providers[0].config || {};
        const { apiKey, apiSecret, email } = config;
        
        if (!apiKey || !apiSecret || !email) {
            return Response.json({ success: false, error: 'חסרים פרטי התחברות ל-Velo' }, { status: 200 });
        }
        
        // Build HMAC per official Velo JSON API docs: sha256(email + apiKey, apiSecret)
        const hmac = await veloHmac(email, apiKey, apiSecret);
        const headers = {
            'Content-Type': 'application/json',
            'X-Velo-Api-Key': apiKey,
            'X-Velo-Hmac': hmac
        };
        
        console.log('🔑 [VeloOrder] HMAC generated (email+apiKey method)');
        
        // Get order and customer data
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order) return Response.json({ success: false, error: 'הזמנה לא נמצאה' }, { status: 200 });
        
        const customer = await base44.asServiceRole.entities.Client.get(order.client_id);
        if (!customer) return Response.json({ success: false, error: 'לקוח לא נמצא' }, { status: 200 });
        
        const products = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: orderId });
        
        let billing = {};
        try { billing = JSON.parse(order.raw_data_billing || '{}'); } catch (e) {}
        
        console.log('📋 [VeloOrder] Billing data:', JSON.stringify(billing));
        console.log('📋 [VeloOrder] Customer data:', JSON.stringify({ full_name: customer.full_name, city: customer.city, phone: customer.phone, full_address: customer.full_address }));
        
        // Resolve first_name and last_name - MUST NOT be empty for Velo API
        const nameParts = (customer.full_name || '').trim().split(/\s+/);
        let firstName = (billing.first_name || '').trim() || nameParts[0] || 'לקוח';
        let lastName = (billing.last_name || '').trim() || nameParts.slice(1).join(' ') || '-';
        
        console.log('👤 [VeloOrder] Name resolved:', { firstName, lastName });
        
        // Parse address: street and number
        let street = billing.address_1 || customer.full_address || '';
        let number = billing.address_2 || '';
        
        if (!number && street) {
            const match = street.match(/^(.+?)\s+(\d+[א-ת]?)$/);
            if (match) {
                street = match[1].trim();
                number = match[2];
            }
        }
        if (!number) number = '1';
        
        console.log('📍 [VeloOrder] Address:', { street, number, city: billing.city || customer.city });
        
        // ===== STEP 1: Create Order via /api/json/v1/order =====
        const orderPayload = {
            polygonId: polygonId,
            externalServiceId: externalServiceId || null,
            externalId: `Order${order.external_order_number || order.id}`,
            weight: weight || 0,
            dimensions: dimensions || { width: 0, height: 0, depth: 0 },
            note: order.customer_note || `הזמנה #${order.external_order_number}`,
            packagesCount: 1,
            customerAddress: {
                first_name: billing.first_name || customer.full_name?.split(' ')[0] || 'לקוח',
                last_name: billing.last_name || customer.full_name?.split(' ').slice(1).join(' ') || '',
                street: street,
                number: number,
                city: billing.city || customer.city || '',
                zip: billing.postcode || '',
                country: 'Israel',
                phone: (billing.phone || customer.phone || '').replace(/\D/g, '')
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
        
        const orderRes = await fetch('https://api.veloapp.io/api/json/v1/order', {
            method: 'POST',
            headers,
            body: JSON.stringify(orderPayload)
        });
        
        const orderText = await orderRes.text();
        console.log('📦 [VeloOrder] Order response status:', orderRes.status);
        console.log('📦 [VeloOrder] Order response:', orderText);
        
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
        
        console.log('✅ [VeloOrder] Order created:', veloOrderId, 'status:', orderData.data?.status);
        
        // ===== STEP 2: Accept/Confirm Delivery via /api/json/v1/accept =====
        // This transmits to the delivery company and returns a barcode
        console.log('📦 [VeloOrder] Step 2 - Confirming delivery (accept)...');
        
        // Small delay to let Velo process
        await new Promise(r => setTimeout(r, 1500));
        
        const acceptRes = await fetch('https://api.veloapp.io/api/json/v1/accept', {
            method: 'POST',
            headers,
            body: JSON.stringify({ order_id: veloOrderId })
        });
        
        const acceptText = await acceptRes.text();
        console.log('📦 [VeloOrder] Accept response status:', acceptRes.status);
        console.log('📦 [VeloOrder] Accept response:', acceptText);
        
        let acceptData;
        try { acceptData = JSON.parse(acceptText); } catch (e) {
            acceptData = { fail: true, message: 'Invalid accept response' };
        }
        
        if (acceptData.fail === true) {
            console.warn('⚠️ [VeloOrder] Accept failed:', acceptData.message);
            // Still save the order but mark as pending
        }
        
        const barcode = acceptData.data?.barcode || null;
        const acceptStatus = acceptData.data?.status || orderData.data?.status || 'placed';
        const isConfirmed = !acceptData.fail && barcode;
        
        console.log('📦 [VeloOrder] Accept result:', { barcode, status: acceptStatus, confirmed: isConfirmed });
        
        // ===== STEP 3: Generate Label via /api/json/v1/label =====
        let labelUrl = null;
        
        if (isConfirmed) {
            console.log('📦 [VeloOrder] Step 3 - Generating label...');
            
            const labelRes = await fetch('https://api.veloapp.io/api/json/v1/label', {
                method: 'POST',
                headers,
                body: JSON.stringify({ order_id: veloOrderId })
            });
            
            const labelText = await labelRes.text();
            console.log('📦 [VeloOrder] Label response status:', labelRes.status);
            console.log('📦 [VeloOrder] Label response:', labelText.substring(0, 500));
            
            try {
                const labelData = JSON.parse(labelText);
                if (!labelData.fail) {
                    labelUrl = labelData.data?.label_pdf || labelData.data?.label || null;
                }
                console.log('📄 [VeloOrder] Label URL:', labelUrl);
            } catch (e) {
                console.warn('⚠️ [VeloOrder] Could not parse label response');
            }
        }
        
        // ===== STEP 4: Get full order info via /api/json/v1/info/{order} =====
        console.log('📦 [VeloOrder] Step 4 - Getting order info...');
        
        const infoRes = await fetch(`https://api.veloapp.io/api/json/v1/info/${veloOrderId}`, {
            method: 'GET',
            headers
        });
        
        const infoText = await infoRes.text();
        console.log('📦 [VeloOrder] Info response:', infoText.substring(0, 1000));
        
        let infoData = {};
        try { infoData = JSON.parse(infoText); } catch (e) {}
        
        // Collect all tracking data from info response
        const trackingUrl = infoData.data?.external_tracking_url || infoData.data?.tracking_link || null;
        const finalBarcode = barcode || infoData.data?.barcode || infoData.data?.shipping_code || null;
        const finalLabelUrl = labelUrl || infoData.data?.label_pdf || null;
        const finalStatus = infoData.data?.status || acceptStatus;
        
        console.log('📋 [VeloOrder] Final:', { barcode: finalBarcode, label: finalLabelUrl, tracking: trackingUrl, status: finalStatus });
        
        // Save shipment record
        const shipment = await base44.asServiceRole.entities.Shipment.create({
            shipment_type: 'standard',
            order_id: orderId,
            external_order_number: order.external_order_number || null,
            client_id: order.client_id || null,
            consignee_name: (orderPayload.customerAddress.first_name + ' ' + orderPayload.customerAddress.last_name).trim(),
            consignee_phone: orderPayload.customerAddress.phone,
            consignee_city: orderPayload.customerAddress.city,
            consignee_street: street || null,
            consignee_house: number || null,
            consignee_zip: orderPayload.customerAddress.zip || null,
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
                warning: `המשלוח נוצר אך לא אושר (${acceptData.message || 'unknown'}). יש לאשר במערכת Velo.`,
                shipment: {
                    id: veloOrderId,
                    shipping_code: finalBarcode,
                    label_url: finalLabelUrl,
                    tracking_url: trackingUrl,
                    status: finalStatus
                },
                shipment_id: shipment.id
            });
        }
        
        return Response.json({
            success: true,
            shipment: {
                id: veloOrderId,
                shipping_code: finalBarcode,
                label_url: finalLabelUrl,
                tracking_url: trackingUrl,
                status: finalStatus
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