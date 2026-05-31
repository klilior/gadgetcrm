import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASE_URL = "https://app.linet.org.il/api";

function getLinetCreds() {
  return {
    login_id: Deno.env.get("LINET_LOGIN_ID"),
    login_hash: Deno.env.get("LINET_LOGIN_HASH"),
    login_company: Number(Deno.env.get("LINET_LOGIN_COMPANY")),
  };
}

async function linetPost(endpoint, payload) {
  const url = `${BASE_URL}/${endpoint}`;
  const res = await fetch(url, {
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

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Search Linet for existing document by external reference
async function findExistingDoc(creds, refnumExt, doctype) {
  try {
    const result = await linetPost('newsearch/docs', {
      ...creds,
      query: { refnum_ext: refnumExt, doctype: [String(doctype)] },
      limit: 5,
      offset: 0,
    });
    const docs = result?.body || (Array.isArray(result) ? result : []);
    return Array.isArray(docs) ? docs : [];
  } catch (e) {
    console.warn('[Batch] Search error for ' + refnumExt + ':', e.message);
    return [];
  }
}

// Find or create Linet account
async function findOrCreateAccount(creds, { name, phone, email, city, address }) {
  let accountId = null;

  if (phone) {
    const byPhone = await linetPost('newsearch/accounts', {
      ...creds, query: { phone }, limit: 5, offset: 0,
    });
    const accounts = byPhone?.body || (Array.isArray(byPhone) ? byPhone : []);
    if (Array.isArray(accounts) && accounts.length > 0) {
      accountId = accounts[0].id;
    }
  }

  if (!accountId && name) {
    const byName = await linetPost('newsearch/accounts', {
      ...creds, query: { name }, limit: 5, offset: 0,
    });
    const accounts = byName?.body || (Array.isArray(byName) ? byName : []);
    if (Array.isArray(accounts) && accounts.length > 0) {
      accountId = accounts[0].id;
    }
  }

  if (!accountId) {
    const newAcc = await linetPost('create/accounts', {
      ...creds, name: name || 'לקוח סופר-פארם', phone: phone || '', email: email || '', city: city || '', address: address || '',
    });
    const body = newAcc?.body || newAcc;
    accountId = body?.id;
    if (!accountId) throw new Error('Failed to create account: ' + JSON.stringify(newAcc));
  }

  return accountId;
}

// Create invoice (type 9) or credit note (type 3)
async function createDoc(creds, { doctype, accountId, refnumExt, customerName, phone, email, city, address, lines, totalSum }) {
  const docPayload = {
    ...creds,
    company: creds.login_company,
    doctype: String(doctype),
    status: 2,
    account_id: String(accountId),
    currency_id: "ILS",
    refnum_ext: refnumExt,
    company: customerName,
    phone: phone || '',
    email: email || '',
    city: city || '',
    address: address || '',
    docDet: lines,
    docCheq: [{
      type: 50,
      currency_id: "ILS",
      sum: totalSum,
      doc_sum: totalSum,
      line: 1,
    }],
  };

  if (email) docPayload.sendmail = 1;

  const result = await linetPost('create/doc', docPayload);
  const body = result?.body || result;
  return {
    doc_id: body?.id,
    doc_number: body?.docnum,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.role !== 'מנהל')) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const sr = base44.asServiceRole.entities;
    const body = await req.json();
    const { action } = body;

    const creds = getLinetCreds();
    if (!creds.login_id || !creds.login_hash || !creds.login_company) {
      return Response.json({ error: 'הגדרות לינט חסרות' }, { status: 500 });
    }

    // === ACTION: process_batch ===
    if (action === 'process_batch') {
      const { orders } = body; // Array of order objects from Excel
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return Response.json({ error: 'לא סופקו הזמנות' }, { status: 400 });
      }

      const results = [];

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const miraklId = order.mirakl_order_id;
        const expectedInvoice = Number(order.expected_invoice) || 0;
        const expectedCredit = Number(order.expected_credit) || 0;

        const result = {
          mirakl_order_id: miraklId,
          customer_name: order.customer_name || '',
          expected_invoice: expectedInvoice,
          expected_credit: expectedCredit,
          invoice_status: 'pending',
          credit_status: expectedCredit > 0 ? 'pending' : 'not_needed',
          invoice_doc_id: null,
          invoice_doc_number: null,
          credit_doc_id: null,
          credit_doc_number: null,
          error: null,
          found_in_base44: false,
          base44_status: null,
        };

        try {
          // Step 0: Check if order exists in Base44
          const spOrders = await sr.SuperPharmOrder.filter({ mirakl_order_id: miraklId }, null, 1);
          if (spOrders.length > 0) {
            result.found_in_base44 = true;
            result.base44_status = spOrders[0].order_state;

            // Check if invoice already recorded in Base44
            if (spOrders[0].linet_invoice_doc_id) {
              result.invoice_status = 'already_exists_base44';
              result.invoice_doc_id = spOrders[0].linet_invoice_doc_id;
              result.invoice_doc_number = spOrders[0].linet_invoice_doc_number;
              results.push(result);
              console.log(`[${i+1}/${orders.length}] ${miraklId}: Already has invoice in Base44 (${result.invoice_doc_number})`);
              await delay(300);
              continue;
            }
          }

          // Step 1: Idempotency — search Linet for existing invoice (type 9)
          console.log(`[${i+1}/${orders.length}] ${miraklId}: Checking Linet for existing docs...`);
          const existingInvoices = await findExistingDoc(creds, miraklId, 9);
          
          if (existingInvoices.length > 0) {
            const existingDoc = existingInvoices[0];
            const existingTotal = Number(existingDoc.total || existingDoc.total_with_vat || 0);
            
            // Check amount match (allow 1 ILS tolerance for rounding)
            if (Math.abs(existingTotal - expectedInvoice) <= 1) {
              result.invoice_status = 'already_exists_linet';
              result.invoice_doc_id = String(existingDoc.id);
              result.invoice_doc_number = String(existingDoc.docnum || existingDoc.doc_number || '');
              console.log(`[${i+1}] ${miraklId}: Found existing invoice #${result.invoice_doc_number} (${existingTotal} ≈ ${expectedInvoice})`);

              // Update Base44 entity if found
              if (spOrders.length > 0) {
                await sr.SuperPharmOrder.update(spOrders[0].id, {
                  linet_invoice_doc_id: result.invoice_doc_id,
                  linet_invoice_doc_number: result.invoice_doc_number,
                  linet_invoice_created_at: new Date().toISOString(),
                });
              }
            } else {
              result.invoice_status = 'amount_mismatch';
              result.error = `סכום בלינט: ${existingTotal}, צפוי: ${expectedInvoice}`;
              console.warn(`[${i+1}] ${miraklId}: Amount mismatch! Linet=${existingTotal}, Expected=${expectedInvoice}`);
            }
            results.push(result);
            await delay(500);
            continue;
          }

          // Also search for type 3 (tax invoice without receipt) as fallback
          const existingType3 = await findExistingDoc(creds, miraklId, 3);
          if (existingType3.length > 0) {
            const doc3 = existingType3[0];
            const total3 = Number(doc3.total || doc3.total_with_vat || 0);
            if (Math.abs(total3 - expectedInvoice) <= 1) {
              result.invoice_status = 'already_exists_linet';
              result.invoice_doc_id = String(doc3.id);
              result.invoice_doc_number = String(doc3.docnum || '');
              console.log(`[${i+1}] ${miraklId}: Found existing type-3 invoice #${result.invoice_doc_number}`);
              if (spOrders.length > 0) {
                await sr.SuperPharmOrder.update(spOrders[0].id, {
                  linet_invoice_doc_id: result.invoice_doc_id,
                  linet_invoice_doc_number: result.invoice_doc_number,
                  linet_invoice_created_at: new Date().toISOString(),
                });
              }
              results.push(result);
              await delay(500);
              continue;
            }
          }

          // Step 2: No existing doc — create new invoice
          if (expectedInvoice <= 0) {
            result.invoice_status = 'skipped_zero';
            results.push(result);
            continue;
          }

          // Find or create Linet account
          const accountId = await findOrCreateAccount(creds, {
            name: order.customer_name || 'לקוח סופר-פארם',
            phone: order.phone || '',
            email: '',
            city: order.city || '',
            address: order.address || '',
          });

          // Build invoice lines from products
          const productLines = [];
          if (order.products && Array.isArray(order.products)) {
            for (const p of order.products) {
              productLines.push({
                item_id: 1,
                name: p.name || 'מוצר סופר-פארם',
                description: `הזמנה ${miraklId}` + (p.sku ? ` | SKU: ${p.sku}` : ''),
                qty: p.quantity || 1,
                iItem: Number(p.unit_price) || 0,
                iItemWithVat: 1,
                currency_id: "ILS",
                vat_cat_id: 1,
              });
            }
          }

          // If no parsed products, use single line
          if (productLines.length === 0) {
            productLines.push({
              item_id: 1,
              name: order.products_text || 'מוצר סופר-פארם',
              description: `הזמנה ${miraklId}`,
              qty: 1,
              iItem: expectedInvoice - (Number(order.shipping_amount) || 0),
              iItemWithVat: 1,
              currency_id: "ILS",
              vat_cat_id: 1,
            });
          }

          // Add shipping line if needed
          const shippingAmount = Number(order.shipping_amount) || 0;
          if (shippingAmount > 0) {
            productLines.push({
              item_id: 1,
              name: 'דמי משלוח',
              description: `משלוח הזמנה ${miraklId}`,
              qty: 1,
              iItem: shippingAmount,
              iItemWithVat: 1,
              currency_id: "ILS",
              vat_cat_id: 1,
            });
          }

          // Verify total matches
          const lineTotal = productLines.reduce((s, l) => s + (l.iItem * (l.qty || 1)), 0);
          if (Math.abs(lineTotal - expectedInvoice) > 1) {
            // Adjust last line to match expected total
            const diff = expectedInvoice - lineTotal;
            if (productLines.length > 0) {
              productLines[productLines.length - 1].iItem += diff / (productLines[productLines.length - 1].qty || 1);
            }
          }

          console.log(`[${i+1}] ${miraklId}: Creating invoice for ${expectedInvoice} ILS...`);
          const invoiceResult = await createDoc(creds, {
            doctype: 9,
            accountId,
            refnumExt: miraklId,
            customerName: order.customer_name || '',
            phone: order.phone || '',
            email: '',
            city: order.city || '',
            address: order.address || '',
            lines: productLines,
            totalSum: expectedInvoice,
          });

          result.invoice_status = 'created';
          result.invoice_doc_id = String(invoiceResult.doc_id);
          result.invoice_doc_number = String(invoiceResult.doc_number || '');
          console.log(`[${i+1}] ${miraklId}: Invoice created #${result.invoice_doc_number}`);

          // Update Base44 SuperPharmOrder
          if (spOrders.length > 0) {
            const pdfUrl = `${BASE_URL}/doc/pdf?` + new URLSearchParams({
              login_id: creds.login_id, login_hash: creds.login_hash,
              login_company: String(creds.login_company), id: String(invoiceResult.doc_id),
            }).toString();
            await sr.SuperPharmOrder.update(spOrders[0].id, {
              linet_invoice_doc_id: String(invoiceResult.doc_id),
              linet_invoice_doc_number: String(invoiceResult.doc_number || ''),
              linet_invoice_pdf_url: pdfUrl,
              linet_invoice_created_at: new Date().toISOString(),
            });
          }

          // Step 3: Create credit note if needed
          if (expectedCredit > 0) {
            console.log(`[${i+1}] ${miraklId}: Creating credit note for ${expectedCredit} ILS...`);
            await delay(1000);

            const creditLines = [{
              item_id: 1,
              name: 'זיכוי הזמנה ' + miraklId,
              description: 'זיכוי חלקי/מלא',
              qty: 1,
              iItem: expectedCredit,
              iItemWithVat: 1,
              currency_id: "ILS",
              vat_cat_id: 1,
            }];

            const creditResult = await createDoc(creds, {
              doctype: 4, // חשבונית זיכוי
              accountId,
              refnumExt: miraklId,
              customerName: order.customer_name || '',
              phone: order.phone || '',
              email: '',
              city: order.city || '',
              address: order.address || '',
              lines: creditLines,
              totalSum: expectedCredit,
            });

            result.credit_status = 'created';
            result.credit_doc_id = String(creditResult.doc_id);
            result.credit_doc_number = String(creditResult.doc_number || '');
            console.log(`[${i+1}] ${miraklId}: Credit note created #${result.credit_doc_number}`);
          }

        } catch (err) {
          result.invoice_status = 'error';
          result.error = err.message;
          console.error(`[${i+1}] ${miraklId}: ERROR - ${err.message}`);
        }

        results.push(result);
        // Throttle to avoid Linet rate limits
        await delay(1500);
      }

      // Summary
      const summary = {
        total: results.length,
        created: results.filter(r => r.invoice_status === 'created').length,
        already_exists: results.filter(r => r.invoice_status === 'already_exists_linet' || r.invoice_status === 'already_exists_base44').length,
        amount_mismatch: results.filter(r => r.invoice_status === 'amount_mismatch').length,
        errors: results.filter(r => r.invoice_status === 'error').length,
        credits_created: results.filter(r => r.credit_status === 'created').length,
      };

      console.log('[Batch] Summary:', JSON.stringify(summary));
      return Response.json({ success: true, summary, results });
    }

    // === ACTION: check_single ===
    if (action === 'check_single') {
      const { mirakl_order_id } = body;
      if (!mirakl_order_id) return Response.json({ error: 'חסר מזהה הזמנה' }, { status: 400 });

      // Check Base44
      const spOrders = await sr.SuperPharmOrder.filter({ mirakl_order_id }, null, 1);
      const inBase44 = spOrders.length > 0;
      const base44Data = inBase44 ? {
        order_state: spOrders[0].order_state,
        linet_invoice_doc_id: spOrders[0].linet_invoice_doc_id,
        linet_invoice_doc_number: spOrders[0].linet_invoice_doc_number,
        tracking_number: spOrders[0].tracking_number,
      } : null;

      // Check Linet
      const existingType9 = await findExistingDoc(creds, mirakl_order_id, 9);
      const existingType3 = await findExistingDoc(creds, mirakl_order_id, 3);
      const existingType4 = await findExistingDoc(creds, mirakl_order_id, 4);

      return Response.json({
        success: true,
        mirakl_order_id,
        in_base44: inBase44,
        base44_data: base44Data,
        linet_invoices_type9: existingType9,
        linet_invoices_type3: existingType3,
        linet_credits_type4: existingType4,
      });
    }

    return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });

  } catch (error) {
    console.error('[BatchSPInvoices] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});