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

async function findOrCreateClient(creds, { name, phone, email, city, address }) {
  let accountId = null;

  // 1. Search by phone first (more reliable than name for Hebrew)
  if (phone) {
    console.log('[Linet] Searching account by phone: ' + phone);
    const byPhone = await linetPost('newsearch/accounts', {
      ...creds,
      query: { phone: phone },
      limit: 5,
      offset: 0,
    });
    const phoneAccounts = byPhone?.body || (Array.isArray(byPhone) ? byPhone : []);
    if (Array.isArray(phoneAccounts) && phoneAccounts.length > 0) {
      console.log('[Linet] Found existing account by phone: ' + phoneAccounts[0].id + ' - ' + phoneAccounts[0].name);
      accountId = phoneAccounts[0].id;
    }
  }

  // 2. Search by name
  if (!accountId) {
    console.log('[Linet] Searching account by name: ' + name);
    const searchResult = await linetPost('newsearch/accounts', {
      ...creds,
      query: { name: name },
      limit: 5,
      offset: 0,
    });
    const accounts = searchResult?.body || (Array.isArray(searchResult) ? searchResult : []);
    if (Array.isArray(accounts) && accounts.length > 0) {
      console.log('[Linet] Found existing account: ' + accounts[0].id + ' - ' + accounts[0].name);
      accountId = accounts[0].id;
    }
  }

  // 3. Create new account with full details
  if (!accountId) {
    console.log('[Linet] Creating new account: ' + name);
    const newAccount = await linetPost('create/accounts', {
      ...creds,
      name: name,
      phone: phone || '',
      email: email || '',
      city: city || '',
      address: address || '',
    });
    const accountBody = newAccount?.body || newAccount;
    accountId = accountBody?.id;
    if (!accountId) {
      throw new Error('Failed to create Linet account: ' + JSON.stringify(newAccount));
    }
    console.log('[Linet] Created account ID: ' + accountId);
  }

  // 4. Update account with latest details (ensures name, email, address are current)
  try {
    const updateData = { ...creds, id: accountId };
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (city) updateData.city = city;
    if (address) updateData.address = address;
    console.log('[Linet] Updating account ' + accountId + ' with: name=' + name + ', email=' + email + ', city=' + city);
    await linetPost('update/accounts', updateData);
  } catch (updateErr) {
    console.warn('[Linet] Failed to update account (non-critical): ' + updateErr.message);
  }

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

    // === Always read customer data from the local SuperPharmOrder entity ===
    let resolvedCustomerName = '';
    let resolvedPhone = customer_phone || '';
    let resolvedEmail = customer_email || send_email || '';
    let resolvedCity = '';
    let resolvedAddress = '';
    let resolvedProductDescription = product_description || '';
    let resolvedQuantity = quantity || 1;
    let resolvedUnitPrice = Number(unit_price) || 0;
    let resolvedShippingAmount = Number(shipping_amount) || 0;

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
        resolvedCity = existingOrder.shipping_city || '';
        resolvedAddress = existingOrder.shipping_street || existingOrder.shipping_address_full || '';

        // Extract customer email from raw Mirakl JSON if not provided
        if (!resolvedEmail && existingOrder.raw_mirakl_json) {
          try {
            const rawMirakl = JSON.parse(existingOrder.raw_mirakl_json);
            resolvedEmail = rawMirakl?.customer?.customer_id || '';
            console.log('[SP Invoice] Email from Mirakl raw JSON: "' + resolvedEmail + '"');
          } catch (_) {}
        }

        if ((!resolvedProductDescription || !resolvedUnitPrice) && existingOrder.order_lines_json) {
          try {
            const lines = JSON.parse(existingOrder.order_lines_json || '[]');
            if (Array.isArray(lines) && lines.length > 0) {
              resolvedProductDescription = resolvedProductDescription || lines.map(function(line) {
                return line.product_title || line.offer_sku || 'פריט סופר-פארם';
              }).join(', ');
              resolvedQuantity = 1;
              const productsTotal = lines.reduce(function(sum, line) { return sum + (Number(line.total_price) || Number(line.price) || 0); }, 0);
              if (!resolvedUnitPrice && productsTotal > 0) resolvedUnitPrice = productsTotal;
              if (!resolvedShippingAmount && existingOrder.total_price > productsTotal && productsTotal > 0) {
                resolvedShippingAmount = Number(existingOrder.total_price) - productsTotal;
              }
            }
          } catch (linesErr) {
            console.warn('[SP Invoice] Failed parsing order lines: ' + linesErr.message);
          }
        }

        if (!resolvedUnitPrice && existingOrder.total_price) resolvedUnitPrice = Number(existingOrder.total_price);
        if (!resolvedProductDescription) resolvedProductDescription = 'הזמנת סופר-פארם ' + existingOrder.mirakl_order_id;

        console.log('[SP Invoice] Customer from entity: "' + resolvedCustomerName + '", phone: ' + resolvedPhone + ', city: ' + resolvedCity + ', email: ' + resolvedEmail);
      }
    }

    // Fallback to what the frontend sent only if entity had nothing
    if (!resolvedCustomerName) {
      resolvedCustomerName = (customer_name || '').trim();
    }

    if (!resolvedCustomerName || !resolvedProductDescription || !resolvedUnitPrice) {
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
      city: resolvedCity,
      address: resolvedAddress,
    });

    // 2. Build invoice lines (docDet)
    const docDet = [];

    docDet.push({
      item_id: 1,
      name: resolvedProductDescription,
      description: 'הזמנת סופר-פארם ' + (mirakl_order_id || ''),
      qty: resolvedQuantity || 1,
      iItem: Number(resolvedUnitPrice),
      iItemWithVat: 1,
      currency_id: "ILS",
      vat_cat_id: 1,
    });

    if (resolvedShippingAmount && Number(resolvedShippingAmount) > 0) {
      docDet.push({
        item_id: 1,
        name: 'דמי משלוח',
        description: 'משלוח הזמנה ' + (mirakl_order_id || ''),
        qty: 1,
        iItem: Number(resolvedShippingAmount),
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
      company: resolvedCustomerName,
      phone: resolvedPhone,
      email: emailTarget,
      city: resolvedCity,
      address: resolvedAddress,
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