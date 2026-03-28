import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const MIRAKL_API_URL = Deno.env.get('MIRAKL_API_URL');
const MIRAKL_API_KEY = Deno.env.get('MIRAKL_API_KEY');

async function fetchMiraklOrders(params = {}) {
  const url = new URL(`${MIRAKL_API_URL}/orders`);
  for (const [key, val] of Object.entries(params)) {
    if (val != null) url.searchParams.set(key, String(val));
  }
  
  console.log(`[Mirakl] GET ${url.pathname}?${url.searchParams}`);
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': MIRAKL_API_KEY,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mirakl API ${res.status}: ${text}`);
  }
  return await res.json();
}

function extractOrderData(miraklOrder) {
  const shipping = miraklOrder.customer?.shipping_address || {};
  const lines = miraklOrder.order_lines || [];

  const orderLinesSimple = lines.map(line => ({
    id: line.order_line_id,
    offer_sku: line.offer_sku,
    product_title: line.product_title || line.offer_sku,
    quantity: line.quantity,
    price: line.price,
    total_price: line.total_price,
    commission_total: line.commission_total,
    status: line.status?.state,
  }));

  return {
    mirakl_order_id: miraklOrder.order_id,
    order_state: miraklOrder.order_state,
    customer_first_name: shipping.firstname || miraklOrder.customer?.firstname || '',
    customer_last_name: shipping.lastname || miraklOrder.customer?.lastname || '',
    customer_phone: shipping.phone || miraklOrder.customer?.phone || '',
    shipping_city: shipping.city || '',
    shipping_street: `${shipping.street_1 || ''} ${shipping.street_2 || ''}`.trim(),
    shipping_zip: shipping.zip_code || '',
    shipping_address_full: [
      shipping.street_1, shipping.street_2, shipping.city, shipping.zip_code
    ].filter(Boolean).join(', '),
    total_price: miraklOrder.total_price || 0,
    total_commission: miraklOrder.total_commission || 0,
    currency: miraklOrder.currency_iso_code || 'ILS',
    order_lines_json: JSON.stringify(orderLinesSimple),
    order_lines_count: lines.length,
    created_at_mirakl: miraklOrder.created_date || null,
    last_updated_mirakl: miraklOrder.last_updated_date || null,
    acceptance_decision_date: miraklOrder.acceptance_decision_date || null,
    shipping_deadline: miraklOrder.shipping_deadline || null,
    raw_mirakl_json: JSON.stringify(miraklOrder),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow admin or automation
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (user && user.role !== 'admin' && user.role !== 'מנהל') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole.entities;

    // Determine what states to fetch
    const states = body.order_state_codes || 'WAITING_ACCEPTANCE,WAITING_DEBIT,WAITING_DEBIT_PAYMENT,SHIPPING,SHIPPED,TO_COLLECT,RECEIVED';
    
    const params = {
      order_state_codes: states,
      max: body.max || 50,
      sort: 'date_created',
      order: 'desc',
    };
    if (body.start_update_date) {
      params.start_update_date = body.start_update_date;
    }

    const data = await fetchMiraklOrders(params);
    const miraklOrders = data.orders || [];
    console.log(`[Mirakl] Received ${miraklOrders.length} orders`);

    let created = 0, updated = 0, skipped = 0;

    for (const mOrder of miraklOrders) {
      const orderData = extractOrderData(mOrder);

      // Check if exists
      const existing = await sr.SuperPharmOrder.filter(
        { mirakl_order_id: orderData.mirakl_order_id }, null, 1
      );

      if (existing.length > 0) {
        // Update only if state changed or data changed
        const ex = existing[0];
        if (ex.order_state !== orderData.order_state || ex.last_updated_mirakl !== orderData.last_updated_mirakl) {
          // Preserve local fields
          const updates = { ...orderData };
          if (ex.tracking_number) {
            updates.tracking_number = ex.tracking_number;
            updates.carrier_code = ex.carrier_code;
            updates.carrier_name = ex.carrier_name;
          }
          if (ex.accepted_at) updates.accepted_at = ex.accepted_at;
          if (ex.shipped_at) updates.shipped_at = ex.shipped_at;
          if (ex.notes) updates.notes = ex.notes;
          await sr.SuperPharmOrder.update(ex.id, updates);
          updated++;
        } else {
          skipped++;
        }
      } else {
        await sr.SuperPharmOrder.create(orderData);
        created++;
      }
    }

    console.log(`[Mirakl Sync] Done: ${created} created, ${updated} updated, ${skipped} skipped`);

    return Response.json({
      success: true,
      total_fetched: miraklOrders.length,
      created,
      updated,
      skipped,
      message: `סנכרון הושלם: ${created} חדשות, ${updated} עודכנו`,
    });
  } catch (error) {
    console.error('[Mirakl Sync] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});