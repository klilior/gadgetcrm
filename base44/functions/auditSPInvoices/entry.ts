import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASE_URL = "https://app.linet.org.il/api";

function getLinetCreds() {
  return {
    login_id: Deno.env.get("LINET_LOGIN_ID"),
    login_hash: Deno.env.get("LINET_LOGIN_HASH"),
    login_company: Number(Deno.env.get("LINET_LOGIN_COMPANY")),
  };
}

async function fetchAllSPDocs(creds, dateFrom, dateTo) {
  // Fetch all invoices (type 9) in date range with refnum_ext containing -M (Mirakl marker)
  const allDocs = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(`${BASE_URL}/newsearch/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...creds,
        limit: 50,
        offset,
        query: { issue_date: `${dateFrom} to ${dateTo}`, doctype: ["9"], refstatus: null },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    const docs = data?.body || [];
    if (!docs.length) { hasMore = false; break; }
    // Filter to only SP invoices (refnum_ext contains Mirakl order pattern)
    for (const d of docs) {
      if (d.refnum_ext && /\d+-.*-?[A-Z]?/.test(d.refnum_ext) && d.api === 1) {
        allDocs.push(d);
      }
    }
    if (docs.length < 50) hasMore = false;
    else offset += 50;
  }
  return allDocs;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.role !== 'מנהל')) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const sr = base44.asServiceRole.entities;
    const creds = getLinetCreds();

    // Fetch all SuperPharm orders that have a Linet invoice
    const allOrders = await sr.SuperPharmOrder.list('-created_date', 500);
    const invoicedOrders = allOrders.filter(o => o.linet_invoice_doc_id);
    console.log(`Found ${invoicedOrders.length} invoiced orders`);

    // Build a map: mirakl_order_id -> order
    const orderMap = {};
    for (const o of invoicedOrders) {
      orderMap[o.mirakl_order_id] = o;
    }

    // Fetch Linet docs from the last 60 days
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const dateFrom = from.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);
    
    const linetDocs = await fetchAllSPDocs(creds, dateFrom, dateTo);
    console.log(`Fetched ${linetDocs.length} API-created invoices from Linet`);

    // Map by refnum_ext
    const docByRef = {};
    for (const d of linetDocs) {
      docByRef[d.refnum_ext] = d;
    }

    const results = [];
    for (const order of invoicedOrders) {
      const miraklTotal = order.total_price || 0;
      let lines = [];
      try { lines = JSON.parse(order.order_lines_json || '[]'); } catch (_) {}

      const linetDoc = docByRef[order.mirakl_order_id];
      const linetTotal = linetDoc ? Number(linetDoc.total) : null;
      const diff = linetTotal != null ? Math.round((linetTotal - miraklTotal) * 100) / 100 : null;
      const hasMismatch = diff != null && Math.abs(diff) > 0.5;

      results.push({
        mirakl_order_id: order.mirakl_order_id,
        customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
        mirakl_total: miraklTotal,
        linet_total: linetTotal,
        difference: diff,
        linet_doc_number: linetDoc?.docnum || order.linet_invoice_doc_number || '',
        status: linetTotal === null ? 'NOT_FOUND_IN_LINET' : hasMismatch ? 'MISMATCH' : 'OK',
        num_lines: lines.length,
        lines_qty_sum: lines.reduce((s, l) => s + (l.quantity || 1), 0),
        order_date: order.created_at_mirakl || order.created_date,
      });
    }

    const mismatches = results.filter(r => r.status === 'MISMATCH');
    const ok = results.filter(r => r.status === 'OK');
    const notFound = results.filter(r => r.status === 'NOT_FOUND_IN_LINET');

    return Response.json({
      success: true,
      summary: { total: results.length, ok: ok.length, mismatches: mismatches.length, not_found: notFound.length },
      mismatches,
      all_results: results,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});