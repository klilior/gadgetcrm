import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASE_URL = "https://app.linet.org.il/api";
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function getLinetCreds() {
  return {
    login_id: Deno.env.get("LINET_LOGIN_ID"),
    login_hash: Deno.env.get("LINET_LOGIN_HASH"),
    login_company: Number(Deno.env.get("LINET_LOGIN_COMPANY")),
  };
}

async function linetPost(endpoint, payload) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Linet HTTP ' + res.status + ': ' + text);
  const data = JSON.parse(text);
  if (data.errorCode && data.errorCode !== 0 && data.errorCode !== 1000) {
    throw new Error('Linet Error ' + data.errorCode);
  }
  return data;
}

async function findDocs(creds, refnumExt, doctype) {
  try {
    const result = await linetPost('newsearch/docs', {
      ...creds,
      query: { refnum_ext: refnumExt, doctype: [String(doctype)] },
      limit: 20, offset: 0,
    });
    const docs = result?.body || (Array.isArray(result) ? result : []);
    return Array.isArray(docs) ? docs : [];
  } catch { return []; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.role !== 'מנהל')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { mode = 'dry_run', order_ids } = body;
    const creds = getLinetCreds();
    if (!creds.login_id) return Response.json({ error: 'missing linet creds' }, { status: 500 });

    const sr = base44.asServiceRole.entities;

    // Get invoiced orders
    let invoicedOrders = [];
    if (order_ids?.length > 0) {
      for (const oid of order_ids) {
        const found = await sr.SuperPharmOrder.filter({ mirakl_order_id: oid }, null, 1);
        if (found.length > 0 && found[0].linet_invoice_doc_number) invoicedOrders.push(found[0]);
      }
    } else {
      let off = 0;
      while (true) {
        const batch = await sr.SuperPharmOrder.list('-created_date', 100, off);
        if (!batch?.length) break;
        invoicedOrders.push(...batch.filter(o => o.linet_invoice_doc_number));
        off += batch.length;
        if (batch.length < 100) break;
      }
    }
    console.log(`[Fix] Checking ${invoicedOrders.length} invoiced orders`);

    const fixes = [];
    const skippedOk = [];

    for (const order of invoicedOrders) {
      const refExt = order.mirakl_order_id;
      const expectedTotal = Number(order.total_price || 0);
      if (expectedTotal <= 0) continue;

      // Step 1: Find invoices (type 9 + type 3) - 2 API calls
      const inv9 = await findDocs(creds, refExt, 9);
      const inv3 = await findDocs(creds, refExt, 3);
      const allInv = [...inv9, ...inv3];
      await delay(200);

      if (allInv.length === 0) continue;

      // Quick check: if single invoice with matching amount → skip (no credit checks needed)
      if (allInv.length === 1) {
        const invTotal = Math.abs(Number(allInv[0].total || 0));
        const diff = invTotal - expectedTotal;
        if (diff <= 1) {
          skippedOk.push(refExt);
          continue; // Amount matches, no fix needed
        }

        // Amount mismatch on single invoice - need to check existing credits
        const creditRefExt = refExt + '_DIFF_CREDIT';
        const existCr = await findDocs(creds, creditRefExt, 4);
        await delay(200);
        if (existCr.length > 0) {
          console.log(`[Fix] ${refExt}: Diff credit already exists`);
          continue;
        }

        fixes.push({
          type: 'AMOUNT_MISMATCH',
          mirakl_order_id: refExt,
          customer: (order.customer_first_name || '') + ' ' + (order.customer_last_name || ''),
          expected_total: expectedTotal,
          inv_docnum: allInv[0].docnum, inv_total: invTotal, inv_id: allInv[0].id,
          credit_amount: Math.round(diff * 100) / 100,
          account_id: allInv[0].account_id,
          phone: allInv[0].phone || '', city: allInv[0].city || '',
          address: allInv[0].address || '', company: allInv[0].company || '',
        });
      } else {
        // Multiple invoices → credit duplicates
        const sorted = allInv.sort((a, b) => Number(a.id) - Number(b.id));
        const kept = sorted[0];
        const keptTotal = Math.abs(Number(kept.total || 0));

        for (let di = 1; di < sorted.length; di++) {
          const dup = sorted[di];
          const dupTotal = Math.abs(Number(dup.total || 0));
          const creditRef = refExt + '_FIX_CREDIT_' + dup.docnum;
          const existCr = await findDocs(creds, creditRef, 4);
          await delay(200);
          if (existCr.length > 0) {
            console.log(`[Fix] ${refExt}: Dup #${dup.docnum} already credited`);
            continue;
          }
          fixes.push({
            type: 'DUPLICATE_INVOICE',
            mirakl_order_id: refExt,
            customer: (order.customer_first_name || '') + ' ' + (order.customer_last_name || ''),
            expected_total: expectedTotal,
            kept_docnum: kept.docnum, kept_total: keptTotal,
            dup_docnum: dup.docnum, dup_total: dupTotal, dup_id: dup.id,
            credit_amount: dupTotal,
            account_id: dup.account_id,
            phone: dup.phone || '', city: dup.city || '',
            address: dup.address || '', company: dup.company || '',
          });
        }

        // Check kept invoice amount
        if (keptTotal - expectedTotal > 1) {
          const diffRef = refExt + '_DIFF_CREDIT';
          const existDiff = await findDocs(creds, diffRef, 4);
          await delay(200);
          if (existDiff.length === 0) {
            fixes.push({
              type: 'AMOUNT_MISMATCH',
              mirakl_order_id: refExt,
              customer: (order.customer_first_name || '') + ' ' + (order.customer_last_name || ''),
              expected_total: expectedTotal,
              inv_docnum: kept.docnum, inv_total: keptTotal, inv_id: kept.id,
              credit_amount: Math.round((keptTotal - expectedTotal) * 100) / 100,
              account_id: kept.account_id,
              phone: kept.phone || '', city: kept.city || '',
              address: kept.address || '', company: kept.company || '',
            });
          }
        }
      }
    }

    const totalCredit = fixes.reduce((s, f) => s + f.credit_amount, 0);
    console.log(`[Fix] ${fixes.length} fixes, ${skippedOk.length} OK, total credit ₪${Math.round(totalCredit * 100) / 100}`);

    if (mode === 'dry_run') {
      return Response.json({
        success: true, mode: 'dry_run',
        summary: {
          total_fixes: fixes.length,
          orders_ok: skippedOk.length,
          duplicates: fixes.filter(f => f.type === 'DUPLICATE_INVOICE').length,
          mismatches: fixes.filter(f => f.type === 'AMOUNT_MISMATCH').length,
          total_credit: Math.round(totalCredit * 100) / 100,
        },
        fixes: fixes.map(f => ({
          type: f.type, mirakl_order_id: f.mirakl_order_id, customer: f.customer,
          expected_total: f.expected_total, credit_amount: f.credit_amount,
          inv_docnum: f.inv_docnum || f.kept_docnum,
          inv_total: f.inv_total || f.kept_total,
          dup_docnum: f.dup_docnum || null, dup_total: f.dup_total || null,
        })),
      });
    }

    if (mode !== 'execute') return Response.json({ error: 'mode: dry_run or execute' }, { status: 400 });

    // === EXECUTE ===
    const results = [];
    let credited = 0, errored = 0, skipped = 0;

    for (let i = 0; i < fixes.length; i++) {
      const fix = fixes[i];
      const creditRefExt = fix.type === 'DUPLICATE_INVOICE'
        ? fix.mirakl_order_id + '_FIX_CREDIT_' + fix.dup_docnum
        : fix.mirakl_order_id + '_DIFF_CREDIT';

      // Final idempotency check
      const existing = await findDocs(creds, creditRefExt, 4);
      if (existing.length > 0) {
        results.push({ mirakl_order_id: fix.mirakl_order_id, type: fix.type, status: 'already_exists' });
        skipped++; await delay(200); continue;
      }

      const desc = fix.type === 'DUPLICATE_INVOICE'
        ? `זיכוי חשבונית כפולה #${fix.dup_docnum} (הזמנה ${fix.mirakl_order_id})`
        : `זיכוי הפרש חשבונית #${fix.inv_docnum}: חויב ₪${fix.inv_total} במקום ₪${fix.expected_total}`;

      try {
        console.log(`[Exec ${i+1}/${fixes.length}] ${fix.type} ${fix.mirakl_order_id}: Credit ₪${fix.credit_amount}`);
        const priceExVat = Math.round((fix.credit_amount / 1.18) * 100) / 100;

        const result = await linetPost('create/doc', {
          ...creds, doctype: '4', status: 2,
          account_id: String(fix.account_id), currency_id: 'ILS',
          refnum_ext: creditRefExt,
          company: fix.company || fix.customer || '',
          phone: fix.phone, city: fix.city, address: fix.address,
          docDet: [{ item_id: 1, name: desc, qty: 1, iItem: priceExVat, iItemWithVat: 1, currency_id: 'ILS', vat_cat_id: 1 }],
          docCheq: [{ type: 50, currency_id: 'ILS', sum: fix.credit_amount, doc_sum: fix.credit_amount, line: 1 }],
        });

        const rb = result?.body || result;
        results.push({
          mirakl_order_id: fix.mirakl_order_id, type: fix.type, credit_amount: fix.credit_amount,
          status: 'credited', credit_doc_number: rb?.docnum, description: desc,
        });
        credited++;
        console.log(`[Exec ${i+1}] OK: Credit #${rb?.docnum} ₪${fix.credit_amount}`);
      } catch (err) {
        results.push({ mirakl_order_id: fix.mirakl_order_id, type: fix.type, status: 'error', error: err.message });
        errored++;
        console.error(`[Exec ${i+1}] ERROR: ${err.message}`);
      }
      await delay(2000);
    }

    return Response.json({
      success: true, mode: 'execute',
      summary: { total: fixes.length, credited, skipped, errored, total_credit: Math.round(totalCredit * 100) / 100 },
      results,
    });

  } catch (error) {
    console.error('[FixSP] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});