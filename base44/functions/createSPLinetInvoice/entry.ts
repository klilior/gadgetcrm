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

// Search Linet for an existing document by external reference (idempotency guard)
async function findExistingLinetDoc(creds, refnumExt) {
  for (const doctype of ['9', '3']) {
    try {
      const result = await linetPost('newsearch/docs', {
        ...creds,
        query: { refnum_ext: refnumExt, doctype: [doctype] },
        limit: 5,
        offset: 0,
      });
      const docs = result?.body || (Array.isArray(result) ? result : []);
      if (Array.isArray(docs) && docs.length > 0) return docs[0];
    } catch (e) {
      console.warn('[Linet] Doc search failed for ' + refnumExt + ': ' + e.message);
    }
  }
  return null;
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
  const base44 = createClientFromRequest(req);
  let lockedOrderIdOuter = null;
  const releaseLock = async () => {
    if (!lockedOrderIdOuter) return;
    await base44.asServiceRole.entities.SuperPharmOrder.update(lockedOrderIdOuter, {
      linet_invoice_doc_id: '',
    }).catch(() => {});
    console.log('[SP Invoice] Lock released for order ' + lockedOrderIdOuter);
  };
  try {

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

    // === Optional: look up serial lines for this Mirakl order (non-blocking) ===
    // Collect ALL assigned_serials from ALL serial lines into one flat array.
    // If not found / error → continue exactly as before (allSerials stays empty).
    // Lock bookkeeping — released if the flow fails before an invoice is created
    let lockedOrderId = null;

    let allSerials = [];
    if (mirakl_order_id) {
      try {
        const [osl, ois] = await Promise.all([
          base44.asServiceRole.entities.OrderSerialLine.filter({ order_id: mirakl_order_id }).catch(() => []),
          base44.asServiceRole.entities.OrderItemSerial.filter({ order_id: mirakl_order_id }).catch(() => []),
        ]);
        for (const l of [...osl, ...ois]) {
          if (l.requires_serial && Array.isArray(l.assigned_serials) && l.assigned_serials.length > 0) {
            allSerials = allSerials.concat(l.assigned_serials);
          }
        }
        console.log('[SP Invoice] allSerials to inject:', JSON.stringify(allSerials));
      } catch (serialErr) {
        console.warn('[SP Invoice] Could not fetch serial lines (non-critical):', serialErr.message);
      }
    }

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
          if (existingOrder.linet_invoice_doc_id === 'pending') {
            return Response.json({
              success: false,
              error: 'חשבונית להזמנה זו נמצאת כרגע בהפקה — נסה שוב בעוד רגע',
              duplicate: true,
            });
          }
          return Response.json({
            success: false,
            error: `חשבונית כבר הונפקה להזמנה זו (חשבונית מס׳ ${existingOrder.linet_invoice_doc_number || existingOrder.linet_invoice_doc_id})`,
            existing_doc_id: existingOrder.linet_invoice_doc_id,
            existing_doc_number: existingOrder.linet_invoice_doc_number,
            existing_pdf_url: existingOrder.linet_invoice_pdf_url,
            duplicate: true,
          });
        }

        // Claim the lock BEFORE any Linet call, so a second parallel run is blocked
        await base44.asServiceRole.entities.SuperPharmOrder.update(existingOrder.id, {
          linet_invoice_doc_id: 'pending',
        });
        lockedOrderId = existingOrder.id;
        lockedOrderIdOuter = existingOrder.id;
        console.log('[SP Invoice] Lock claimed for order ' + existingOrder.id);

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

        if (existingOrder.order_lines_json) {
          try {
            const lines = JSON.parse(existingOrder.order_lines_json || '[]');
            if (Array.isArray(lines) && lines.length > 0) {
              resolvedProductDescription = lines.map(function(line) {
                return line.product_title || line.offer_sku || 'פריט סופר-פארם';
              }).join(', ');
              resolvedQuantity = 1;
              const productsTotal = lines.reduce(function(sum, line) { return sum + (Number(line.price) || Number(line.total_price) || 0); }, 0);
              const orderTotal = Number(existingOrder.total_price) || 0;
              if (productsTotal > 0) resolvedUnitPrice = productsTotal;
              if (orderTotal > productsTotal && productsTotal > 0) {
                resolvedShippingAmount = orderTotal - productsTotal;
              } else {
                resolvedShippingAmount = 0;
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
      await releaseLock();
      return Response.json({ error: 'חסרים שדות חובה: שם לקוח, תיאור מוצר, מחיר' }, { status: 400 });
    }

    console.log('[SP Invoice] Final customer name: "' + resolvedCustomerName + '"');

    const creds = getLinetCreds();
    if (!creds.login_id || !creds.login_hash || !creds.login_company) {
      await releaseLock();
      return Response.json({ error: 'הגדרות לינט חסרות' }, { status: 500 });
    }

    // 0. Idempotency against Linet itself — never create a second doc for the same order
    if (mirakl_order_id) {
      const existingDoc = await findExistingLinetDoc(creds, mirakl_order_id);
      if (existingDoc) {
        const foundId = String(existingDoc.id);
        const foundNumber = String(existingDoc.docnum || existingDoc.doc_number || '');
        const foundPdf = BASE_URL + '/doc/pdf?' + new URLSearchParams({
          login_id: creds.login_id,
          login_hash: creds.login_hash,
          login_company: String(creds.login_company),
          id: foundId,
        }).toString();
        if (lockedOrderId) {
          await base44.asServiceRole.entities.SuperPharmOrder.update(lockedOrderId, {
            linet_invoice_doc_id: foundId,
            linet_invoice_doc_number: foundNumber,
            linet_invoice_pdf_url: foundPdf,
          });
        }
        console.log('[SP Invoice] DUPLICATE BLOCKED - doc already exists in Linet: ' + foundNumber);
        return Response.json({
          success: false,
          error: `חשבונית כבר קיימת בלינט להזמנה זו (מס׳ ${foundNumber || foundId})`,
          existing_doc_id: foundId,
          existing_doc_number: foundNumber,
          existing_pdf_url: foundPdf,
          duplicate: true,
        });
      }
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
      ...(allSerials.length > 0 ? { serial: allSerials } : {}),
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

      // Mark serial lines as invoiced (closes the serial flow for this order)
      try {
        const [oslLines, oisLines] = await Promise.all([
          base44.asServiceRole.entities.OrderSerialLine.filter({ order_id: mirakl_order_id }).catch(() => []),
          base44.asServiceRole.entities.OrderItemSerial.filter({ order_id: mirakl_order_id }).catch(() => []),
        ]);
        const nowIso = new Date().toISOString();
        for (const l of oslLines) {
          if (!l.requires_serial || l.serial_status === 'invoiced') continue;
          await base44.asServiceRole.entities.OrderSerialLine.update(l.id, {
            serial_status: 'invoiced',
          }).catch(() => {});
        }
        for (const l of oisLines) {
          if (!l.requires_serial || l.serial_status === 'invoiced') continue;
          await base44.asServiceRole.entities.OrderItemSerial.update(l.id, {
            serial_status: 'invoiced',
            linet_invoice_id: String(docId),
            linet_document_number: String(docNumber || ''),
            invoiced_at: nowIso,
          }).catch(() => {});
        }
        console.log('[SP Invoice] Serial lines marked as invoiced');
      } catch (serialSaveErr) {
        console.warn('[SP Invoice] Failed marking serial lines invoiced (non-critical):', serialSaveErr.message);
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
    await releaseLock();
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});