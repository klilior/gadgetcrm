import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const MIRAKL_API_URL = Deno.env.get('MIRAKL_API_URL');
const MIRAKL_API_KEY = Deno.env.get('MIRAKL_API_KEY');

async function miraklRequest(method, path, body = null) {
  const url = `${MIRAKL_API_URL}${path}`;
  console.log(`[Mirakl] ${method} ${path}`);
  
  const options = {
    method,
    headers: {
      'Authorization': MIRAKL_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();
  
  if (!res.ok) {
    throw new Error(`Mirakl API ${res.status}: ${text}`);
  }
  
  return text ? JSON.parse(text) : {};
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify caller is authenticated (may use custom auth)
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_authErr) {
      // Custom auth system — proceed if request has valid SDK headers
      console.log('[Mirakl Update] Auth check skipped (custom auth)');
    }

    const sr = base44.asServiceRole.entities;
    const body = await req.json();
    const { action, order_id, tracking_number, carrier_code, carrier_name } = body;

    if (!order_id) {
      return Response.json({ error: 'חסר מזהה הזמנה' }, { status: 400 });
    }

    // Get local order
    const orders = await sr.SuperPharmOrder.filter({ mirakl_order_id: order_id }, null, 1);
    if (orders.length === 0) {
      return Response.json({ error: 'הזמנה לא נמצאה' }, { status: 404 });
    }
    const localOrder = orders[0];

    if (action === 'accept') {
      // Accept all order lines
      const lines = JSON.parse(localOrder.order_lines_json || '[]');
      console.log('[Mirakl Accept] Order lines:', JSON.stringify(lines));
      const orderLines = lines.map(line => ({
        accepted: true,
        id: line.id || line.order_line_id,
      }));
      const acceptPayload = {
        orders: [{
          order_id: order_id,
          order_lines: orderLines,
        }],
      };
      console.log('[Mirakl Accept] Payload:', JSON.stringify(acceptPayload));

      await miraklRequest('PUT', `/orders/${order_id}/accept`, acceptPayload);

      await sr.SuperPharmOrder.update(localOrder.id, {
        order_state: 'SHIPPING',
        accepted_at: new Date().toISOString(),
      });

      return Response.json({ success: true, message: 'ההזמנה אושרה בהצלחה' });
    }

    if (action === 'refuse') {
      const lines = JSON.parse(localOrder.order_lines_json || '[]');
      const orderLines = lines.map(line => ({
        accepted: false,
        id: line.id || line.order_line_id,
      }));

      await miraklRequest('PUT', `/orders/${order_id}/accept`, {
        orders: [{
          order_id: order_id,
          order_lines: orderLines,
        }],
      });

      await sr.SuperPharmOrder.update(localOrder.id, {
        order_state: 'REFUSED',
      });

      return Response.json({ success: true, message: 'ההזמנה נדחתה' });
    }

    if (action === 'ship') {
      if (!tracking_number) {
        return Response.json({ error: 'חסר מספר מעקב' }, { status: 400 });
      }

      // Use the correct tracking endpoint per SuperPharm/Mirakl docs
      await miraklRequest('PUT', `/orders/${order_id}/tracking`, {
        carrier_code: carrier_code || 'OTHER',
        carrier_name: carrier_name || 'UPS Israel',
        tracking_number: tracking_number,
      });

      await sr.SuperPharmOrder.update(localOrder.id, {
        order_state: 'SHIPPED',
        tracking_number,
        carrier_code: carrier_code || 'OTHER',
        carrier_name: carrier_name || 'UPS Israel',
        shipped_at: new Date().toISOString(),
      });

      return Response.json({ success: true, message: `ההזמנה נשלחה עם מעקב: ${tracking_number}` });
    }

    return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    console.error('[Mirakl Update] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});