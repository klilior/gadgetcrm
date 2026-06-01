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
    throw new Error('Linet Error ' + data.errorCode + ': ' + JSON.stringify(data));
  }
  return data;
}

// Search Linet for docs by external reference
async function findDocsByRef(creds, refnumExt, doctype) {
  try {
    const result = await linetPost('newsearch/docs', {
      ...creds,
      query: { refnum_ext: refnumExt, doctype: [String(doctype)] },
      limit: 5, offset: 0,
    });
    const docs = result?.body || (Array.isArray(result) ? result : []);
    return Array.isArray(docs) ? docs : [];
  } catch (_) { return []; }
}

// Find or create Linet account
async function findOrCreateAccount(creds, { name, phone, city, address }) {
  let id = null;
  if (phone) {
    const r = await linetPost('newsearch/accounts', { ...creds, query: { phone }, limit: 3, offset: 0 });
    const a = r?.body || (Array.isArray(r) ? r : []);
    if (a.length > 0) id = a[0].id;
  }
  if (!id && name) {
    const r = await linetPost('newsearch/accounts', { ...creds, query: { name }, limit: 3, offset: 0 });
    const a = r?.body || (Array.isArray(r) ? r : []);
    if (a.length > 0) id = a[0].id;
  }
  if (!id) {
    const r = await linetPost('create/accounts', { ...creds, name: name || 'לקוח סופר-פארם', phone: phone || '', city: city || '', address: address || '' });
    id = (r?.body || r)?.id;
    if (!id) throw new Error('Failed to create account');
  }
  return id;
}

// ========== SAFETY LOCK ==========
// יצירת חשבוניות חדשות חסומה. הפונקציה רק תקשר חשבוניות קיימות.
// כדי לאפשר יצירה מחדש, שנה את הערך ל-true.
const ALLOW_INVOICE_CREATION = false;
// ==================================

Deno.serve(async (req) => {
  const startTime = new Date();
  const base44 = createClientFromRequest(req);
  const sr = base44.asServiceRole.entities;

  try {
    // Allow scheduled (no auth) or admin
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const creds = getLinetCreds();
    if (!creds.login_id) return Response.json({ error: 'Missing Linet creds' }, { status: 500 });

    // Eligible states: orders that were shipped/received/closed should have an invoice
    const eligibleStates = ['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED'];
    
    let allOrders = [];
    for (const state of eligibleStates) {
      const orders = await sr.SuperPharmOrder.filter({ order_state: state }, '-created_at_mirakl', 200);
      allOrders.push(...orders);
    }

    // Filter: only orders WITHOUT an invoice recorded locally
    const missingInvoice = allOrders.filter(o => !o.linet_invoice_doc_id);
    console.log(`[Reconcile] ${allOrders.length} eligible orders, ${missingInvoice.length} missing invoice`);

    if (missingInvoice.length === 0) {
      // Log success
      await sr.SyncLog.create({
        sync_key: 'sp_invoice_reconcile',
        run_started_at: startTime.toISOString(),
        run_finished_at: new Date().toISOString(),
        status: 'SUCCESS',
        records_fetched: allOrders.length,
        records_skipped: allOrders.length,
        trigger_type: user ? 'MANUAL' : 'NIGHTLY',
        details_json: { message: 'All orders have invoices' },
      });
      return Response.json({ success: true, message: 'כל ההזמנות כבר מחושבנות', total: allOrders.length, missing: 0 });
    }

    let created = 0, alreadyExist = 0, errors = 0, duplicateBlocked = 0;
    const results = [];

    for (let i = 0; i < missingInvoice.length; i++) {
      const order = missingInvoice[i];
      const miraklId = order.mirakl_order_id;
      const r = { mirakl_order_id: miraklId, status: 'pending', error: null };

      try {
        // Step 1: Check Linet for existing invoice (type 9 or 3)
        const existing9 = await findDocsByRef(creds, miraklId, 9);
        const existing3 = await findDocsByRef(creds, miraklId, 3);
        const existingInvoices = [...existing9, ...existing3];

        // DUPLICATE GUARD: if ANY invoice exists for this order number, link it and skip
        if (existingInvoices.length > 0) {
          const doc = existingInvoices[0];
          const docId = String(doc.id);
          const docNum = String(doc.docnum || doc.doc_number || '');

          // Check if there are MULTIPLE invoices (not credit notes) = real duplicate
          const invoiceCount = existingInvoices.filter(d => 
            String(d.doctype) === '9' || String(d.doctype) === '3'
          ).length;

          if (invoiceCount > 1) {
            console.warn(`[Reconcile] ⚠️ DUPLICATE: ${miraklId} has ${invoiceCount} invoices in Linet!`);
            r.status = 'duplicate_detected';
            r.error = `${invoiceCount} חשבוניות קיימות בלינט - יש לבדוק כפילויות`;
            duplicateBlocked++;
          } else {
            r.status = 'linked_existing';
          }

          // Link first invoice to Base44
          const pdfUrl = `${BASE_URL}/doc/pdf?` + new URLSearchParams({
            login_id: creds.login_id, login_hash: creds.login_hash,
            login_company: String(creds.login_company), id: docId,
          }).toString();

          await sr.SuperPharmOrder.update(order.id, {
            linet_invoice_doc_id: docId,
            linet_invoice_doc_number: docNum,
            linet_invoice_pdf_url: pdfUrl,
            linet_invoice_created_at: new Date().toISOString(),
          });
          alreadyExist++;
          console.log(`[Reconcile] ${miraklId}: Linked existing #${docNum}`);
          results.push(r);
          await delay(500);
          continue;
        }

        // Step 2: No invoice found
        if (!ALLOW_INVOICE_CREATION) {
          r.status = 'blocked';
          r.error = 'יצירת חשבוניות חסומה (ALLOW_INVOICE_CREATION=false)';
          console.log(`[Reconcile] ${miraklId}: BLOCKED - invoice creation disabled`);
          results.push(r);
          continue;
        }

        // Create invoice
        const customerName = `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'לקוח סופר-פארם';
        const accountId = await findOrCreateAccount(creds, {
          name: customerName,
          phone: order.customer_phone || '',
          city: order.shipping_city || '',
          address: order.shipping_street || order.shipping_address_full || '',
        });

        // Parse order lines
        let lines = [];
        try { lines = JSON.parse(order.order_lines_json || '[]'); } catch (_) {}

        const docDet = [];
        let productTotal = 0;
        let shippingTotal = 0;

        for (const line of lines) {
          const unitPrice = Number(line.price || line.total_price || 0);
          const qty = Number(line.quantity || 1);
          const shipping = Number(line.shipping_price || 0);
          
          docDet.push({
            item_id: 1,
            name: line.product_title || line.offer_sku || 'מוצר סופר-פארם',
            description: `הזמנה ${miraklId}` + (line.offer_sku ? ` | SKU: ${line.offer_sku}` : ''),
            qty,
            iItem: unitPrice / qty, // unit price
            iItemWithVat: 1,
            currency_id: "ILS",
            vat_cat_id: 1,
          });
          productTotal += unitPrice;
          shippingTotal += shipping;
        }

        // If no lines parsed, use total_price
        if (docDet.length === 0) {
          const totalPrice = Number(order.total_price || 0);
          docDet.push({
            item_id: 1,
            name: 'מוצר סופר-פארם',
            description: `הזמנה ${miraklId}`,
            qty: 1,
            iItem: totalPrice,
            iItemWithVat: 1,
            currency_id: "ILS",
            vat_cat_id: 1,
          });
          productTotal = totalPrice;
        }

        // Add shipping as separate line
        if (shippingTotal > 0) {
          docDet.push({
            item_id: 1,
            name: 'דמי משלוח',
            description: `משלוח הזמנה ${miraklId}`,
            qty: 1,
            iItem: shippingTotal,
            iItemWithVat: 1,
            currency_id: "ILS",
            vat_cat_id: 1,
          });
        }

        const totalSum = productTotal + shippingTotal;
        if (totalSum <= 0) {
          r.status = 'skipped_zero';
          r.error = 'סכום 0';
          results.push(r);
          continue;
        }

        console.log(`[Reconcile] ${miraklId}: Creating invoice ₪${totalSum}...`);
        const docResult = await linetPost('create/doc', {
          ...creds,
          company: creds.login_company,
          doctype: "9",
          status: 2,
          account_id: String(accountId),
          currency_id: "ILS",
          refnum_ext: miraklId,
          company: customerName,
          phone: order.customer_phone || '',
          city: order.shipping_city || '',
          address: order.shipping_street || '',
          docDet,
          docCheq: [{ type: 50, currency_id: "ILS", sum: totalSum, doc_sum: totalSum, line: 1 }],
        });

        const docBody = docResult?.body || docResult;
        const docId = String(docBody?.id || '');
        const docNum = String(docBody?.docnum || '');

        const pdfUrl = `${BASE_URL}/doc/pdf?` + new URLSearchParams({
          login_id: creds.login_id, login_hash: creds.login_hash,
          login_company: String(creds.login_company), id: docId,
        }).toString();

        await sr.SuperPharmOrder.update(order.id, {
          linet_invoice_doc_id: docId,
          linet_invoice_doc_number: docNum,
          linet_invoice_pdf_url: pdfUrl,
          linet_invoice_created_at: new Date().toISOString(),
        });

        r.status = 'created';
        r.doc_number = docNum;
        created++;
        console.log(`[Reconcile] ${miraklId}: Invoice #${docNum} created`);

      } catch (err) {
        r.status = 'error';
        r.error = err.message;
        errors++;
        console.error(`[Reconcile] ${miraklId}: ERROR - ${err.message}`);
      }

      results.push(r);
      await delay(1500);
    }

    // Log to SyncLog
    await sr.SyncLog.create({
      sync_key: 'sp_invoice_reconcile',
      run_started_at: startTime.toISOString(),
      run_finished_at: new Date().toISOString(),
      status: errors > 0 ? 'PARTIAL' : 'SUCCESS',
      records_fetched: missingInvoice.length,
      records_created: created,
      records_updated: alreadyExist,
      records_skipped: duplicateBlocked,
      trigger_type: user ? 'MANUAL' : 'NIGHTLY',
      details_json: {
        total_eligible: allOrders.length,
        missing: missingInvoice.length,
        created, already_exist: alreadyExist,
        duplicate_blocked: duplicateBlocked, errors,
        results: results.slice(0, 50),
      },
    });

    const msg = `ביקורת חשבוניות: ${created} נוצרו, ${alreadyExist} קושרו מקיימות, ${duplicateBlocked} כפילויות נחסמו, ${errors} שגיאות`;
    console.log(`[Reconcile] ✅ ${msg}`);
    return Response.json({ success: true, message: msg, created, already_exist: alreadyExist, duplicate_blocked: duplicateBlocked, errors, results });

  } catch (error) {
    console.error('[Reconcile] Fatal:', error.message);
    try {
      await sr.SyncLog.create({
        sync_key: 'sp_invoice_reconcile',
        run_started_at: startTime.toISOString(),
        run_finished_at: new Date().toISOString(),
        status: 'FAILED',
        error_message: error.message,
        trigger_type: 'NIGHTLY',
      });
    } catch (_) {}
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});