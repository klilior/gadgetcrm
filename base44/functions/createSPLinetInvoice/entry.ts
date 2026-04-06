import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

    if (!customer_name || !product_description || !unit_price) {
      return Response.json({ error: 'חסרים שדות חובה: שם לקוח, תיאור מוצר, מחיר' }, { status: 400 });
    }

    const creds = getLinetCreds();
    if (!creds.login_id || !creds.login_hash || !creds.login_company) {
      return Response.json({ error: 'הגדרות לינט חסרות' }, { status: 500 });
    }

    // 1. Find or create client (with name, phone, email)
    const clientId = await findOrCreateClient(creds, {
      name: customer_name,
      phone: customer_phone || '',
      email: customer_email || send_email || '',
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
    const emailTarget = send_email || customer_email || '';
    const docPayload = {
      ...creds,
      company: creds.login_company,
      doctype: "9",
      status: 2,
      account_id: String(clientId),
      currency_id: "ILS",
      refnum_ext: mirakl_order_id || '',
      phone: customer_phone || '',
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

    // If email provided, tell Linet to send the doc by email automatically
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

    // 4. Email was sent by Linet if sendmail=1 was set
    const emailSent = !!emailTarget;
    if (emailSent) {
      console.log('[Linet] Document created with sendmail=1, email will be sent to: ' + emailTarget);
    }

    // 5. Build PDF URL for manual access
    const pdfUrl = BASE_URL + '/doc/pdf?' + new URLSearchParams({
      login_id: creds.login_id,
      login_hash: creds.login_hash,
      login_company: String(creds.login_company),
      id: String(docId),
    }).toString();

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