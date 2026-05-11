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
  console.log('[Linet] POST ' + url);
  console.log('[Linet] Payload:', JSON.stringify(payload).substring(0, 1500));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  console.log('[Linet] Status: ' + res.status + ', Response: ' + text.substring(0, 1000));

  if (!res.ok) {
    throw new Error('Linet HTTP ' + res.status + ': ' + text);
  }

  const data = JSON.parse(text);
  if (data.errorCode && data.errorCode !== 0 && data.errorCode !== 1000) {
    throw new Error('Linet Error ' + data.errorCode + ': ' + JSON.stringify(data));
  }
  return data;
}

async function findOrCreateClient(creds, { name, phone, email }) {
  console.log('[Linet] Searching account: ' + name);
  const searchResult = await linetPost('newsearch/accounts', {
    ...creds,
    query: { name: name },
    limit: 5,
    offset: 0,
  });

  const accounts = searchResult?.body || (Array.isArray(searchResult) ? searchResult : []);
  if (Array.isArray(accounts) && accounts.length > 0) {
    console.log('[Linet] Found existing account: ' + accounts[0].id + ' - ' + accounts[0].name);
    return accounts[0].id;
  }

  console.log('[Linet] Creating new account: ' + name);
  const newAccount = await linetPost('create/accounts', {
    ...creds,
    name: name,
    phone: phone || '',
    email: email || '',
  });

  const accountBody = newAccount?.body || newAccount;
  const accountId = accountBody?.id;
  if (!accountId) {
    throw new Error('Failed to create Linet account: ' + JSON.stringify(newAccount));
  }
  console.log('[Linet] Created account ID: ' + accountId);
  return accountId;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const body = await req.json();
    const {
      customer_name,
      customer_phone,
      customer_email,
      product_description,
      quantity,
      unit_price,
      shipping_amount,
      mirakl_order_id,
      send_email,
    } = body;

    // === Always read customer name from the local SuperPharmOrder entity ===
    let resolvedCustomerName = '';
    let resolvedPhone = customer_phone || '';
    let resolvedEmail = customer_email || send_email || '';

    if (mirakl_order_id) {
      console.log('[SP Invoice] Loading order from DB for mirakl_order_id:', mirakl_order_id);
      const existingOrders = await base44.asServiceRole.entities.SuperPharmOrder.filter(
        { mirakl_order_id: mirakl_order_id }
      );
      
      if (existingOrders.length > 0) {
        const existingOrder = existingOrders[0];

        // Duplicate check
        if (existingOrder.linet_invoice_doc_id) {
          console.log('[SP Invoice] DUPLICATE BLOCKED - Invoice already exists: doc_id=' + existingOrder.linet_invoice_doc_id);
          return Response.json({
            success: false,
            error: `חשבונית כבר הונפקה להזמנה זו (חשבונית מס׳ ${existingOrder.linet_invoice_doc_number || existingOrder.linet_invoice_doc_id})`,
            existing_doc_id: existingOrder.linet_invoice_doc_id,
            existing_doc_number: existingOrder.linet_invoice_doc_number,
            existing_pdf_url: existingOrder.linet_invoice_pdf_url,
            duplicate: true,
          });
        }

        // Always take customer name from the entity (synced from Mirakl)
        resolvedCustomerName = `${existingOrder.customer_first_name || ''} ${existingOrder.customer_last_name || ''}`.trim();
        resolvedPhone = existingOrder.customer_phone || resolvedPhone;
        console.log('[SP Invoice] Customer from entity: "' + resolvedCustomerName + '", phone: ' + resolvedPhone);
      }
    }

    // Fallback to what the frontend sent only if entity had nothing
    if (!resolvedCustomerName) {
      resolvedCustomerName = (customer_name || '').trim();
    }

    if (!resolvedCustomerName || !product_description || !unit_price) {
      return Response.json({ error: 'חסרים שדות חובה: שם לקוח, תיאור מוצר, מחיר' }, { status: 400 });
    }

    console.log('[SP Invoice] Final customer name: "' + resolvedCustomerName + '"');

    const creds = getLinetCreds();
    if (!creds.login_id || !creds.login_hash || !creds.login_company) {
      return Response.json({ error: 'הגדרות לינט חסרות' }, { status: 500 });
    }

    // 1. Find or create client
    const clientId = await findOrCreateClient(creds, {
      name: resolvedCustomerName,
      phone: resolvedPhone,
      email: resolvedEmail,
    });

    // 2. Build invoice lines (docDet)
    const docDet = [];

    docDet.push({
      item_id: 1,
      name: product_description,
      description: 'הזמנת סופר-פארם ' + (mirakl_order_id || ''),
      qty: quantity || 1,
      iItem: Number(unit_price),
      iItemWithVat: 1,
      currency_id: "ILS",
      vat_cat_id: 1,
    });

    if (shipping_amount && Number(shipping_amount) > 0) {
      docDet.push({
        item_id: 1,
        name: 'דמי משלוח',
        description: 'משלוח הזמנה ' + (mirakl_order_id || ''),
        qty: 1,
        iItem: Number(shipping_amount),
        iItemWithVat: 1,
        currency_id: "ILS",
        vat_cat_id: 1,
      });
    }

    const totalSum = docDet.reduce(function(sum, l) { return sum + (l.iItem * (l.qty || 1)); }, 0);

    // 3. Create document (type 9 = חשבונית מס-קבלה)
    const emailTarget = resolvedEmail;
    const docPayload = {
      ...creds,
      company: creds.login_company,
      doctype: "9",
      status: 2,
      account_id: String(clientId),
      currency_id: "ILS",
      refnum_ext: mirakl_order_id || '',
      phone: resolvedPhone,
      email: emailTarget,
      docDet: docDet,
      docCheq: [{
        type: 50,
        currency_id: "ILS",
        sum: totalSum,
        doc_sum: totalSum,
        line: 1,
      }],
    };

    if (emailTarget) {
      docPayload.sendmail = 1;
    }

    console.log('[Linet] Creating doc type 9...');
    const docResult = await linetPost('create/doc', docPayload);

    console.log('[Linet] Full doc response:', JSON.stringify(docResult).substring(0, 2000));
    const docBody = docResult?.body || docResult;
    const docId = docBody?.id;
    const docNumber = docBody?.docnum;
    
    console.log('[Linet] Invoice created: ID=' + docId + ', Number=' + docNumber);

    const emailSent = !!emailTarget;

    // 4. Build PDF URL
    const pdfUrl = BASE_URL + '/doc/pdf?' + new URLSearchParams({
      login_id: creds.login_id,
      login_hash: creds.login_hash,
      login_company: String(creds.login_company),
      id: String(docId),
    }).toString();

    // 5. === SAVE invoice data back to SuperPharmOrder entity ===
    if (mirakl_order_id) {
      try {
        const orders = await base44.asServiceRole.entities.SuperPharmOrder.filter(
          { mirakl_order_id: mirakl_order_id }
        );
        if (orders.length > 0) {
          await base44.asServiceRole.entities.SuperPharmOrder.update(orders[0].id, {
            linet_invoice_doc_id: String(docId),
            linet_invoice_doc_number: String(docNumber || ''),
            linet_invoice_pdf_url: pdfUrl,
            linet_invoice_created_at: new Date().toISOString(),
            linet_invoice_email_sent: emailSent,
          });
          console.log('[SP Invoice] Saved invoice data to SuperPharmOrder:', orders[0].id);
        }
      } catch (saveErr) {
        console.error('[SP Invoice] Failed to save invoice to order entity:', saveErr.message);
        // Don't fail the whole request - invoice was created successfully
      }
    }

    const msg = 'חשבונית מס-קבלה ' + (docNumber || docId) + ' נוצרה בהצלחה' + (emailSent ? ' ונשלחה במייל' : '');

    return Response.json({
      success: true,
      doc_id: docId,
      doc_number: docNumber,
      client_id: clientId,
      email_sent: emailSent,
      pdf_url: pdfUrl,
      message: msg,
    });

  } catch (error) {
    console.error('[SP Linet Invoice] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});