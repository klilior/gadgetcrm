import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const RAW_MIRAKL_API_URL = Deno.env.get('MIRAKL_API_URL');
const MIRAKL_API_KEY = Deno.env.get('MIRAKL_API_KEY');

function getMiraklBaseUrl() {
  try {
    const u = new URL(RAW_MIRAKL_API_URL);
    return `${u.protocol}//${u.host}/api`;
  } catch (e) {
    return RAW_MIRAKL_API_URL;
  }
}

async function fetchMiraklOrder(orderId) {
  const baseUrl = getMiraklBaseUrl();
  const url = `${baseUrl}/orders?order_ids=${orderId}`;
  console.log(`[Resync] GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'Authorization': MIRAKL_API_KEY,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mirakl API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data?.orders?.[0] || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow admin or automation (no user context)
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (user && user.role !== 'admin' && user.role !== 'מנהל') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sr = base44.asServiceRole.entities;

    // Find all orders in active states that might need updates
    const [shippingOrders, waitingDebit, waitingDebitPayment, waitingAcceptance] = await Promise.all([
      sr.SuperPharmOrder.filter({ order_state: 'SHIPPING' }, '-updated_date', 50),
      sr.SuperPharmOrder.filter({ order_state: 'WAITING_DEBIT' }, '-updated_date', 50),
      sr.SuperPharmOrder.filter({ order_state: 'WAITING_DEBIT_PAYMENT' }, '-updated_date', 50),
      sr.SuperPharmOrder.filter({ order_state: 'WAITING_ACCEPTANCE' }, '-updated_date', 50),
    ]);

    // Include: orders missing shipping data OR recently accepted (last 30 min)
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const allActive = [...shippingOrders, ...waitingDebit, ...waitingDebitPayment, ...waitingAcceptance];
    const candidates = allActive.filter(o => {
      const missingShipping = !o.shipping_city || !o.shipping_street;
      const recentlyAccepted = o.accepted_at && o.accepted_at >= cutoff;
      return missingShipping || recentlyAccepted;
    });

    console.log(`[Resync] Found ${candidates.length} orders to check (${allActive.length} total active)`);

    let updated = 0;
    let unchanged = 0;

    for (const local of candidates) {
      const miraklOrder = await fetchMiraklOrder(local.mirakl_order_id);
      if (!miraklOrder) {
        console.log(`[Resync] Order ${local.mirakl_order_id} not found on Mirakl, skipping`);
        continue;
      }

      const shipping = miraklOrder.customer?.shipping_address || {};
      const billing = miraklOrder.customer?.billing_address || {};
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

      // Use shipping address, fallback to billing
      const city = shipping.city || billing.city || '';
      const street = [shipping.street_1 || billing.street_1, shipping.street_2 || billing.street_2].filter(Boolean).join(', ');
      const zip = shipping.zip_code || billing.zip_code || '';
      const phone = shipping.phone || billing.phone || '';

      const updates = {
        order_state: miraklOrder.order_state,
        customer_first_name: miraklOrder.customer?.firstname || local.customer_first_name || '',
        customer_last_name: miraklOrder.customer?.lastname || shipping.lastname || local.customer_last_name || '',
        customer_phone: phone || local.customer_phone || '',
        shipping_city: city || local.shipping_city || '',
        shipping_street: street || local.shipping_street || '',
        shipping_zip: zip || local.shipping_zip || '',
        shipping_address_full: [
          shipping.street_1 || billing.street_1,
          shipping.street_2 || billing.street_2,
          city, zip
        ].filter(Boolean).join(', ') || local.shipping_address_full || '',
        total_price: miraklOrder.total_price || local.total_price,
        total_commission: miraklOrder.total_commission || local.total_commission,
        order_lines_json: JSON.stringify(orderLinesSimple),
        order_lines_count: lines.length,
        last_updated_mirakl: miraklOrder.last_updated_date || null,
        shipping_deadline: miraklOrder.shipping_deadline || local.shipping_deadline || null,
        raw_mirakl_json: JSON.stringify(miraklOrder),
      };

      // Preserve local fields that shouldn't be overwritten
      if (local.tracking_number) {
        updates.tracking_number = local.tracking_number;
        updates.carrier_code = local.carrier_code;
        updates.carrier_name = local.carrier_name;
      }
      if (local.accepted_at) updates.accepted_at = local.accepted_at;
      if (local.shipped_at) updates.shipped_at = local.shipped_at;
      if (local.notes) updates.notes = local.notes;

      // Check if anything meaningful changed
      const hasNewData = (
        updates.order_state !== local.order_state ||
        updates.shipping_city !== (local.shipping_city || '') ||
        updates.shipping_street !== (local.shipping_street || '') ||
        updates.customer_phone !== (local.customer_phone || '') ||
        updates.shipping_deadline !== (local.shipping_deadline || null)
      );

      if (hasNewData) {
        await sr.SuperPharmOrder.update(local.id, updates);
        console.log(`[Resync] Updated ${local.mirakl_order_id}: state=${updates.order_state}, city=${updates.shipping_city}, street=${updates.shipping_street}, phone=${updates.customer_phone}`);
        updated++;
      } else {
        unchanged++;
      }

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 500));
    }

    const summary = `סנכרון חוזר: ${updated} עודכנו, ${unchanged} ללא שינוי (מתוך ${candidates.length})`;
    console.log(`[Resync] ${summary}`);

    return Response.json({ success: true, checked: candidates.length, updated, unchanged, message: summary });
  } catch (error) {
    console.error('[Resync] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});