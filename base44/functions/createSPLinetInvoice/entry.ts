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
  console.log(`[Linet] POST ${url}`);
  console.log(`[Linet] Payload:`, JSON.stringify(payload).substring(0, 1500));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  console.log(`[Linet] Status: ${res.status}, Response: ${text.substring(0, 1000)}`);

  if (!res.ok) {
    throw new Error(`Linet HTTP ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  // errorCode 1000 = "No items found" — not a real error, just empty results
  if (data.errorCode && data.errorCode !== 0 && data.errorCode !== 1000) {
    throw new Error(`Linet Error ${data.errorCode}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function findOrCreateClient(creds, { name, phone, email }) {
  // Search for existing client by name in Linet "accounts" model
  console.log(`[Linet] Searching account: ${name}`);
  const searchResult = await linetPost('newsearch/accounts', {
    ...creds,
    query: { name: name },
    limit: 5,
    offset: 0,
  });

  // Response: { body: [...] } or array
  const accounts = searchResult?.body || (Array.isArray(searchResult) ? searchResult : []);
  if (Array.isArray(accounts) && accounts.length > 0) {
    console.log(`[Linet] Found existing account: ${accounts[0].id} - ${accounts[0].company_name}`);
    return accounts[0].id;
  }

  // Create new account (client)
  console.log(`[Linet] Creating new account: ${name}`);
  const newAccount = await linetPost('create/accounts', {
    ...creds,
    company_name: name,
    phone: phone || '',
    email: email || '',
    type: 1, // 1 = client/customer
  });

  const accountId = newAccount?.id || newAccount?.body?.id;
  if (!accountId) {
    throw new Error('Failed to create Linet account: ' + JSON.stringify(newAccount));
  }
  console.log(`[Linet] Created account ID: ${accountId}`);
  return accountId;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth check
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const body = await req.json();
    const {
      customer_name,
      customer_phone,
      customer_email,
      product_description,
      quantity,
      unit_price,      // price per unit inc VAT
      shipping_amount,  // shipping cost inc VAT
      mirakl_order_id,
    } = body;

    if (!customer_name || !product_description || !unit_price) {
      return Response.json({ error: 'חסרים שדות חובה: שם לקוח, תיאור מוצר, מחיר' }, { status: 400 });
    }

    const creds = getLinetCreds();
    if (!creds.login_id || !creds.login_hash || !creds.login_company) {
      return Response.json({ error: 'הגדרות לינט חסרות' }, { status: 500 });
    }

    // 1. Find or create client
    const clientId = await findOrCreateClient(creds, {
      name: customer_name,
      phone: customer_phone || '',
      email: customer_email || '',
    });

    // 2. Build invoice lines
    // Doc type 9 = חשבונית מס-קבלה
    // SKU "1" = מוצר כללי
    // Payment type 50 = סופר פארם
    const lines = [];

    // Product line
    lines.push({
      item_id: 1,  // SKU 1 = מוצר כללי
      details: product_description,
      quantity: quantity || 1,
      price_nis: Number(unit_price),
      // price is inc VAT, Linet needs the price. We send the full amount and let Linet calculate VAT.
    });

    // Shipping line (if there's shipping cost)
    if (shipping_amount && Number(shipping_amount) > 0) {
      lines.push({
        item_id: 1,  // Same general item
        details: 'דמי משלוח',
        quantity: 1,
        price_nis: Number(shipping_amount),
      });
    }

    // 3. Create the document (type 9 = חשבונית מס-קבלה)
    const totalSum = lines.reduce((sum, l) => sum + (l.price_nis * (l.quantity || 1)), 0);
    const docPayload = {
      ...creds,
      doctype: 9,
      account_id: clientId,
      description: `הזמנת סופר-פארם ${mirakl_order_id || ''}`.trim(),
      lines: lines.map(l => ({
        item_id: l.item_id,
        details: l.details,
        quantity: l.quantity || 1,
        price_nis: l.price_nis,
      })),
      payments: [{
        payment_type: 50, // סופר פארם
        payment_sum: totalSum,
      }],
    };

    console.log(`[Linet] Creating doc type 9...`);
    const docResult = await linetPost('create/docs', docPayload);

    const docId = docResult?.id || docResult?.body?.id;
    const docNumber = docResult?.doc_number || docResult?.body?.doc_number;
    
    console.log(`[Linet] ✅ Invoice created: ID=${docId}, Number=${docNumber}`);

    return Response.json({
      success: true,
      doc_id: docId,
      doc_number: docNumber,
      client_id: clientId,
      message: `חשבונית מס-קבלה ${docNumber || docId} נוצרה בהצלחה`,
    });

  } catch (error) {
    console.error('[SP Linet Invoice] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});