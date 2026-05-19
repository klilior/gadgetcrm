import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const sr = base44.asServiceRole.entities;
    const errs = [];

    // WooCommerce
    let woo = [];
    try {
      let raw = await sr.Order.list('-order_date', 200);
      if (!Array.isArray(raw)) raw = [];
      const cs = await sr.Client.list(null, 1000).catch(function() { return []; });
      const ps = await sr.OrderProduct.list(null, 2000).catch(function() { return []; });
      const cM = {};
      for (const c of (Array.isArray(cs) ? cs : [])) cM[c.id] = c;
      const pM = {};
      for (const p of (Array.isArray(ps) ? ps : [])) {
        if (!pM[p.order_id]) pM[p.order_id] = [];
        pM[p.order_id].push(p);
      }
      const closedSet = new Set(['completed', 'cancelled', 'refunded', 'failed']);
      for (const o of raw) {
        if (closedSet.has(o.status)) continue;
        const c = cM[o.client_id];
        const prods = pM[o.id] || [];
        woo.push({
          id: 'woo_' + o.id, source: 'woocommerce',
          order_number: o.external_order_number || '',
          order_date: o.order_date || '',
          customer_name: c ? (c.full_name || '') : '',
          customer_phone: c ? (c.phone || '') : '',
          customer_email: c ? (c.email || '') : '',
          shipping_city: c ? (c.city || '') : '',
          shipping_street: c ? (c.full_address || '') : '',
          products: prods.map(function(x) { return {name: x.name || '', quantity: x.quantity || 1, total: parseFloat(x.total) || 0}; }),
          total: parseFloat(o.total) || 0,
          shipping_method: o.shipping_method || '',
          status: o.status || '', notes: o.customer_note || '',
          raw_id: o.id, client_id: o.client_id || '', currency: 'ILS',
          pickup_point_data: o.pickup_point_data || '',
          tracking_number: o.tracking_number || '',
          tracking_carrier: o.tracking_carrier || '',
        });
      }
    } catch (e1) { errs.push({source: 'woocommerce', message: e1.message}); }

    // Mirakl
    let mk = [];
    try {
      let raw2 = await sr.SuperPharmOrder.list('-created_at_mirakl', 200);
      if (!Array.isArray(raw2)) raw2 = [];
      const closedSet2 = new Set(['CLOSED', 'REFUSED', 'CANCELED', 'RECEIVED']);
      for (const o of raw2) {
        if (closedSet2.has(o.order_state)) continue;
        let lines = [];
        try { lines = JSON.parse(o.order_lines_json || '[]'); } catch (ep) { lines = []; }
        mk.push({
          id: 'mirakl_' + o.id, source: 'mirakl',
          order_number: o.mirakl_order_id || '',
          order_date: o.created_at_mirakl || o.created_date || '',
          customer_name: ((o.customer_first_name || '') + ' ' + (o.customer_last_name || '')).trim(),
          customer_first_name: o.customer_first_name || '',
          customer_last_name: o.customer_last_name || '',
          customer_phone: o.customer_phone || '',
          shipping_city: o.shipping_city || '',
          shipping_street: o.shipping_street || '',
          shipping_address_full: o.shipping_address_full || '',
          products: lines.map(function(l) { return {name: l.product_title || l.offer_sku || '', quantity: l.quantity || 1, total: l.price || 0}; }),
          total: o.total_price || 0, shipping_method: 'superpharm',
          status: o.order_state || '', notes: o.notes || '',
          raw_id: o.id, mirakl_order_id: o.mirakl_order_id || '',
          tracking_number: o.tracking_number || '', currency: o.currency || 'ILS'
        });
      }
    } catch (e2) { errs.push({source: 'mirakl', message: e2.message}); }

    const all = woo.concat(mk);
    all.sort(function(a, b) { return new Date(a.order_date || 0) - new Date(b.order_date || 0); });

    return Response.json({
      success: true, orders: all,
      counts: {woocommerce: woo.length, mirakl: mk.length, linet: 0, total: all.length},
      errors: errs, timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({success: false, error: error.message}, {status: 500});
  }
});