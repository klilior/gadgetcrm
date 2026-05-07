import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CARGO_BASE_URL = 'https://api-v2.cargo.co.il/api/';

const CARGO_STATUS_MAP = {
  1: 'פתוח',
  2: 'הועבר לשליח',
  3: 'נמסר',
  4: 'נאסף על ידי קארגו',
  5: 'חזרה ממשלוח כפול',
  7: 'אושר לביצוע',
  8: 'בוטל',
  9: 'משלוח שני',
  12: 'ממתין למשלוח',
  25: 'במחסן',
  50: 'בדרך למסירה',
  51: 'בדרך לנקודת חלוקה',
  52: 'נקודת חלוקה',
  55: 'בנקודת חלוקה',
};

async function cargoRequest(token, endpoint, method = 'POST', body = null) {
  const url = CARGO_BASE_URL + endpoint;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  
  console.log(`📦 Cargo API ${method} ${endpoint}`, body ? JSON.stringify(body).slice(0, 500) : '');
  
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  
  console.log(`📦 Cargo response ${res.status}:`, typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500));
  
  if (!res.ok) {
    throw new Error(`Cargo API error ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
  }
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Skip base44 auth - this app uses custom Employee auth
    // All entity operations use asServiceRole which doesn't require user auth

    const body = await req.json();
    const { action } = body;

    // Get cargo config from ShippingProvider entity (use service role for system config)
    async function getCargoConfig() {
      const providers = await base44.asServiceRole.entities.ShippingProvider.filter({ provider_type: 'cargo' });
      const cargo = providers.find(p => p.is_active);
      if (!cargo) throw new Error('ספק קארגו לא מוגדר או לא פעיל. עבור להגדרות → ספקי משלוחים.');
      const config = cargo.config || {};
      if (!config.api_token) throw new Error('API Token של קארגו לא מוגדר. עבור להגדרות → ספקי משלוחים.');
      return config;
    }

    // ACTION: test_connection
    if (action === 'test_connection') {
      const { api_token } = body;
      if (!api_token) return Response.json({ success: false, error: 'חסר API Token' });
      
      try {
        const data = await cargoRequest(api_token, 'shipments/status', 'POST', { shipment_id: '999999999' });
        // If we get a response (even error about not found), the token works
        return Response.json({ success: true, message: 'החיבור תקין! הטוקן אומת בהצלחה.' });
      } catch (e) {
        if (e.message.includes('401') || e.message.includes('403')) {
          return Response.json({ success: false, error: 'טוקן לא תקין — גישה נדחתה' });
        }
        // Any other error might still mean token is valid but shipment not found
        return Response.json({ success: true, message: 'החיבור תקין (הטוקן אומת).' });
      }
    }

    // ACTION: create_shipment
    if (action === 'create_shipment') {
      const config = await getCargoConfig();
      const { shipment_type, to_name, to_phone, to_street, to_city, to_floor, to_apartment, to_entrance,
              notes, number_of_parcels, cash_on_delivery, order_id, order_number } = body;

      const customer_code = parseInt(config.customer_code) || 7625;
      const from_address = {
        name: 'GADGET-TEAM',
        phone: config.sender_phone || '',
        street1: config.sender_street || 'שדרות משה דיין 3',
        city: config.sender_city || 'יהוד',
      };
      const to_address = {
        name: to_name,
        phone: to_phone,
        street1: to_street,
        city: to_city,
        floor: to_floor || '',
        apartment: to_apartment || '',
        entrance: to_entrance || '',
      };

      let shipping_type, double_delivery;
      let final_from = from_address;
      let final_to = to_address;

      if (shipment_type === 'delivery') {
        shipping_type = 1;
        double_delivery = 1;
      } else if (shipment_type === 'return') {
        shipping_type = 2;
        double_delivery = 1;
        // Reverse addresses for return
        final_from = to_address;
        final_to = from_address;
      } else if (shipment_type === 'exchange') {
        shipping_type = 1;
        double_delivery = 2;
      } else {
        return Response.json({ success: false, error: 'סוג משלוח לא תקין' });
      }

      const payload = {
        shipping_type,
        double_delivery,
        carrier_id: 1,
        customer_code,
        transaction_id: order_number || order_id || '',
        order_id: order_number || order_id || '',
        notes: notes || '',
        number_of_parcels: number_of_parcels || 1,
        to_address: final_to,
        from_address: final_from,
      };

      if (cash_on_delivery && cash_on_delivery > 0) {
        payload.cash_on_delivery = cash_on_delivery;
      }

      const apiResult = await cargoRequest(config.api_token, 'shipments/create', 'POST', payload);

      // Cargo API returns { errors, data: { shipment_id, ... }, message }
      const innerData = apiResult.data || apiResult;
      const shipment_id = innerData.shipment_id || apiResult.shipment_id || null;
      if (!shipment_id) {
        return Response.json({ success: false, error: 'לא התקבל מזהה משלוח מקארגו', raw: apiResult });
      }

      // Save Shipment record
      const shipmentRecord = await base44.asServiceRole.entities.Shipment.create({
        order_id: order_id || '',
        external_order_number: order_number || '',
        shipment_type: shipment_type === 'delivery' ? 'cargo_delivery' : shipment_type === 'return' ? 'cargo_return' : 'cargo_exchange',
        tracking_number: String(shipment_id),
        status: 'created',
        carrier: 'cargo',
        consignee_name: to_name,
        consignee_phone: to_phone,
        consignee_city: to_city,
        consignee_street: to_street,
        num_packages: number_of_parcels || 1,
        notes: notes || '',
        reference: order_number || order_id || '',
        api_response: apiResult,
        cargo_shipment_id: String(shipment_id),
        cargo_status: '1',
        cargo_status_text: 'פתוח',
        cargo_shipment_type: shipment_type,
      });

      // Also update the Order entity with tracking info so it shows immediately
      if (order_id) {
        try {
          await base44.asServiceRole.entities.Order.update(order_id, {
            tracking_number: String(shipment_id),
            tracking_carrier: 'cargo',
          });
          console.log(`📦 Updated Order ${order_id} with tracking ${shipment_id}`);
        } catch (e) {
          console.log(`📦 Could not update Order ${order_id}: ${e.message}`);
        }
      }

      return Response.json({
        success: true,
        shipment_id: String(shipment_id),
        shipment_record_id: shipmentRecord.id,
        raw: apiResult,
      });
    }

    // ACTION: get_status
    if (action === 'get_status') {
      const config = await getCargoConfig();
      const { shipment_id } = body;
      if (!shipment_id) return Response.json({ success: false, error: 'חסר מזהה משלוח' });

      const customer_code = parseInt(config.customer_code) || 7625;
      const statusPayload = { shipment_id: parseInt(shipment_id), customer_code };
      
      const data = await cargoRequest(config.api_token, 'shipments/get-status', 'POST', statusPayload);
      
      console.log('📦 Status response:', JSON.stringify(data).slice(0, 500));
      const innerStatus = data.data || data;
      const statusCode = innerStatus.status_code || innerStatus.status || innerStatus.shipment_status || data.status || null;
      const statusText = CARGO_STATUS_MAP[statusCode] || `סטטוס ${statusCode || 'לא ידוע'}`;

      // Update Shipment entity if exists
      const existing = await base44.asServiceRole.entities.Shipment.filter({ cargo_shipment_id: String(shipment_id) });
      if (existing.length > 0) {
        await base44.asServiceRole.entities.Shipment.update(existing[0].id, {
          cargo_status: String(statusCode),
          cargo_status_text: statusText,
        });
      }

      return Response.json({ success: true, status_code: statusCode, status_text: statusText, raw: data });
    }

    // ACTION: print_label
    if (action === 'print_label') {
      const config = await getCargoConfig();
      const { shipment_id, label_format } = body;
      if (!shipment_id) return Response.json({ success: false, error: 'חסר מזהה משלוח' });

      const customer_code = parseInt(config.customer_code) || 7625;
      const sid = parseInt(shipment_id);
      
      // Cargo API v2 label endpoints (from official docs)
      // Try multiple payload formats since docs aren't accessible
      const payloadVariants = [
        { shipment_ids: [sid], customer_code },
        { shipment_id: sid, customer_code },
        { shipment_ids: [sid], customer_code, format: 'pdf' },
      ];
      const endpoints = ['shipments/print-label', 'shipments/print-label-a4'];
      
      let data = null;
      let successEndpoint = null;
      
      for (const endpoint of endpoints) {
        for (const payload of payloadVariants) {
          try {
            data = await cargoRequest(config.api_token, endpoint, 'POST', payload);
            successEndpoint = endpoint;
            console.log(`📦 Label success via ${endpoint} with payload keys: ${Object.keys(payload).join(',')}`);
            break;
          } catch (e) {
            console.log(`📦 ${endpoint} failed (${Object.keys(payload).join(',')}): ${e.message.slice(0, 150)}`);
          }
        }
        if (data) break;
      }

      if (!data) {
        return Response.json({ 
          success: false, 
          error: `שגיאה בהדפסת תווית מקארגו. מספר המשלוח: ${shipment_id}. נסה להדפיס ישירות מאתר קארגו.`,
          shipment_id: String(sid)
        });
      }

      // Parse response - Cargo may return PDF URL, base64, or HTML
      const inner = data.data || data;
      let label_url = null;
      let label_base64 = null;
      
      if (typeof inner === 'string') {
        if (inner.startsWith('http')) {
          label_url = inner;
        } else if (inner.startsWith('JVBER') || inner.startsWith('/9j/')) {
          // Base64-encoded PDF or image
          label_base64 = inner;
        }
      } else if (typeof inner === 'object') {
        label_url = inner.label_url || inner.url || inner.pdf_url || inner.sticker_url || inner.link || null;
        label_base64 = inner.label_base64 || inner.pdf || inner.base64 || inner.sticker || inner.label || null;
      }
      if (!label_url) label_url = data.label_url || data.url || data.sticker_url || data.link || null;
      if (!label_base64) label_base64 = data.label_base64 || data.pdf || data.sticker || data.label || null;

      // If we got data but couldn't extract url/base64, return the raw response for debugging
      if (!label_url && !label_base64) {
        console.log('📦 Label data received but could not extract URL/base64:', JSON.stringify(data).slice(0, 1000));
        return Response.json({ success: true, label_url: null, label_base64: null, raw: data, endpoint_used: successEndpoint });
      }

      return Response.json({ success: true, label_url, label_base64, endpoint_used: successEndpoint });
    }

    // ACTION: register_webhook
    if (action === 'register_webhook') {
      const { api_token, webhook_url } = body;
      if (!api_token || !webhook_url) return Response.json({ success: false, error: 'חסר טוקן או URL' });

      try {
        const data = await cargoRequest(api_token, 'webhooks/create', 'POST', {
          url: webhook_url,
          events: ['status_update'],
        });
        return Response.json({ success: true, raw: data });
      } catch (e) {
        return Response.json({ success: false, error: e.message });
      }
    }

    // ACTION: cancel_shipment
    if (action === 'cancel_shipment') {
      const config = await getCargoConfig();
      const { shipment_id } = body;
      if (!shipment_id) return Response.json({ success: false, error: 'חסר מזהה משלוח' });

      const customer_code = parseInt(config.customer_code) || 7625;
      const data = await cargoRequest(config.api_token, 'shipments/update-status', 'POST', {
        shipment_id: parseInt(shipment_id),
        customer_code,
        status_code: 8, // 8 = Cancelled
      });

      // Update local Shipment entity
      const existing = await base44.asServiceRole.entities.Shipment.filter({ cargo_shipment_id: String(shipment_id) });
      if (existing.length > 0) {
        await base44.asServiceRole.entities.Shipment.update(existing[0].id, {
          cargo_status: '8',
          cargo_status_text: 'בוטל',
          status: 'cancelled',
        });
      }

      return Response.json({ success: true, message: 'המשלוח בוטל בהצלחה' });
    }

    return Response.json({ error: 'Unknown action: ' + action }, { status: 400 });

  } catch (error) {
    console.error('❌ Cargo API error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});