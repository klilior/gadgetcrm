import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * issueInvoiceWithSerials
 * קלט: { order_id, apply (boolean, default false) }
 *
 * apply=false → DRY-RUN: בונה payload מלא, לא שולח.
 * apply=true  → שולח POST /api/create/docs ל-Linet, שומר תוצאות.
 *
 * docDetailes מכיל: שורות סריאליות + פריטים רגילים + שורת משלוח.
 * VAT_RATE = 0.18 (אומת מחשבוניות אמיתיות).
 */

function getLinetCreds() {
  const login_id = Deno.env.get("LINET_LOGIN_ID");
  const login_hash = Deno.env.get("LINET_LOGIN_HASH");
  const login_company = Number(Deno.env.get("LINET_LOGIN_COMPANY"));
  if (!login_id || !login_hash || !login_company) throw new Error("חסרים פרטי חיבור ל-Linet");
  return { login_id, login_hash, login_company };
}

async function linetPost(endpoint, body) {
  const res = await fetch(`https://app.linet.org.il/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { _raw: text.slice(0, 500) }; }
  return { http_status: res.status, data };
}

/** מחפש פריט ב-Linet לפי מק"ט — משמש כשאין מיפוי שמור */
async function linetFindItemBySku(creds, sku) {
  const res = await linetPost("newsearch/item", { ...creds, limit: 5, offset: 0, query: { sku: String(sku) } });
  const rows = Array.isArray(res.data?.body) ? res.data.body : (Array.isArray(res.data) ? res.data : []);
  const exact = rows.find((r) => String(r.sku) === String(sku));
  return exact ?? null;
}

/** מחזיר { linet_item_id, linet_item_name } עבור מק"ט — משתמש במיפוי שמור, אחרת מחפש ב-Linet ושומר */
async function resolveLinetItem(base44, creds, sku, existingMap, log) {
  if (existingMap?.linet_item_id) {
    return { linet_item_id: existingMap.linet_item_id, linet_item_name: existingMap.linet_item_name };
  }
  const found = await linetFindItemBySku(creds, sku).catch(() => null);
  if (!found?.id) {
    log.push({ step: "linet_item_not_found", sku });
    return null;
  }
  log.push({ step: "linet_item_auto_mapped", sku, linet_item_id: found.id });
  const patch = {
    linet_item_id: Number(found.id),
    linet_item_name: found.name ?? "",
    linet_stock_type: found.stockType,
    requires_serial: found.stockType === 2,
    serial_source: "linet",
    last_checked: new Date().toISOString(),
  };
  try {
    if (existingMap?.id) {
      await base44.asServiceRole.entities.LinetProductMap.update(existingMap.id, patch);
    } else {
      await base44.asServiceRole.entities.LinetProductMap.create({ sku: String(sku), ...patch });
    }
  } catch (_) {}
  return { linet_item_id: Number(found.id), linet_item_name: found.name ?? "" };
}

function normalizePhoneLocal(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  if (!digits.startsWith("0")) digits = "0" + digits;
  return digits;
}

function fmt2(n) { return Number(n).toFixed(2); }
function fmt4(n) { return Number(n).toFixed(4); }
function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const VAT_RATE = 0.18;

/** בונה שורת docDet אחת — תואם ל-/api/create/doc */
function buildLine({ item_id, sku, name, qty, totalInc, serials }) {
  const iTotalVat  = totalInc;
  const iItemFinal = iTotalVat / qty;  // מחיר יחידה כולל מע"מ (iItemWithVat=1)
  return {
    item_id:      Number(item_id),
    sku:          sku ?? "",
    name:         name ?? "",
    qty:          qty,
    serial:       Array.isArray(serials) ? serials : [],
    iItem:        Number(iItemFinal.toFixed(2)),
    iItemWithVat: 1,
    currency_id:  "ILS",
    vat_cat_id:   1,
    warehouse_id: 115,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id, apply = false } = body;

    if (!order_id) {
      return Response.json({ issued: false, error: "order_id is required" }, { status: 400 });
    }

    const log = [];
    log.push({ step: "start", order_id, apply });

    const realOrderId = order_id.startsWith("woo_") ? order_id.replace("woo_", "") : order_id;

    // ─── שלב 1: שלוף כל הנתונים ────────────────────────────────────────────
    // חפש בשני פורמטים: עם ובלי "woo_" prefix
    const wooOrderId = order_id.startsWith("woo_") ? order_id : `woo_${order_id}`;
    const plainOrderId = order_id.startsWith("woo_") ? order_id.replace("woo_", "") : order_id;

    let gateSerialLines = [];
    try {
      const [r1, r2] = await Promise.all([
        base44.asServiceRole.entities.OrderItemSerial.filter({ order_id: plainOrderId }).catch(() => []),
        base44.asServiceRole.entities.OrderItemSerial.filter({ order_id: wooOrderId }).catch(() => []),
      ]);
      gateSerialLines = [...r1, ...r2];
    } catch (_) {}
    let gateSerialLines2 = [];
    try {
      const [r1, r2] = await Promise.all([
        base44.asServiceRole.entities.OrderSerialLine.filter({ order_id: plainOrderId }).catch(() => []),
        base44.asServiceRole.entities.OrderSerialLine.filter({ order_id: wooOrderId }).catch(() => []),
      ]);
      gateSerialLines2 = [...r1, ...r2];
    } catch (_) {}
    const allSerialLines = [...gateSerialLines, ...gateSerialLines2];

    let order = null;
    try { order = await base44.asServiceRole.entities.Order.get(realOrderId); } catch (_) {}

    let orderProducts = [];
    try { orderProducts = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: realOrderId }); } catch (_) {}

    // LinetProductMap — שלוף כל הרשומות הרלוונטיות לפי sku-ים
    const skusNeeded = [
      ...orderProducts.map((p) => p.sku).filter(Boolean),
      "19034", // משלוח תמיד
    ];
    let productMaps = [];
    try { productMaps = await base44.asServiceRole.entities.LinetProductMap.filter({}); } catch (_) {}
    const mapBySku = {};
    for (const m of productMaps) { if (m.sku) mapBySku[m.sku] = m; }

    log.push({
      step: "data_loaded",
      order_found: !!order,
      serial_lines_count: allSerialLines.length,
      order_products_count: orderProducts.length,
      product_maps_count: productMaps.length,
    });

    // ─── שלב 2: שער — serial lines ──────────────────────────────────────────
    const gateReasons = [];
    const gateMessages = [];
    const VALID_STATUSES = new Set(["selected", "verified", "invoiced"]);

    for (const line of allSerialLines) {
      if (!line.requires_serial) continue;
      const name = line.source_product_name ?? line.order_item_id ?? "?";
      if (!line.mapped_linet_item_id) {
        gateReasons.push("missing_linet_mapping");
        gateMessages.push(`חסר מיפוי לפריט Linet עבור "${name}".`);
        continue;
      }
      if (!VALID_STATUSES.has(line.serial_status)) {
        gateReasons.push("missing_serial");
        gateMessages.push(`חסר מספר סידורי מאומת עבור "${name}".`);
        continue;
      }
      const assigned = Array.isArray(line.assigned_serials) ? line.assigned_serials.length : 0;
      const required = line.serials_required_count ?? 1;
      if (assigned < required) {
        gateReasons.push("insufficient_serials");
        gateMessages.push(`"${name}" דורש ${required} סריאלי/ים אך יש ${assigned}.`);
      }
    }

    log.push({ step: "gate", blocked: gateReasons.length > 0, reasons: gateReasons });
    if (gateReasons.length > 0) {
      return Response.json({ issued: false, blocked: true, reasons: gateReasons, messages_he: gateMessages, log });
    }

    // ─── שלב 3: idempotency ─────────────────────────────────────────────────
    const alreadyInvoiced = allSerialLines.find((l) => l.linet_invoice_id);
    if (alreadyInvoiced) {
      log.push({ step: "idempotency_block", existing_invoice_id: alreadyInvoiced.linet_invoice_id });
      return Response.json({ issued: false, already_invoiced: true, existing_invoice_id: alreadyInvoiced.linet_invoice_id, log });
    }

    // ─── שלב 4: לקוח ────────────────────────────────────────────────────────
    const creds = getLinetCreds();

    let client = null;
    if (order?.client_id) {
      client = await base44.asServiceRole.entities.Client.get(order.client_id).catch(() => null);
    }

    let accountId = client?.linet_account_id ? String(client.linet_account_id) : null;
    let accountFound = !!accountId;
    let accountToCreate = null;

    if (!accountId) {
      let rawPhone = null;
      if (order?.raw_data_billing) {
        try { const b = JSON.parse(order.raw_data_billing); rawPhone = b.phone ?? b.billing?.phone ?? null; } catch (_) {}
      }
      if (!rawPhone) rawPhone = client?.phone ?? client?.phone_original ?? null;
      const localPhone = normalizePhoneLocal(rawPhone);

      log.push({ step: "phone_resolve", raw: rawPhone, normalized: localPhone });

      if (localPhone) {
        const r1 = await linetPost("newsearch/account", { ...creds, limit: 3, offset: 0, query: { phone: localPhone } });
        const rows1 = Array.isArray(r1.data?.body) ? r1.data.body : (Array.isArray(r1.data) ? r1.data : []);
        if (rows1.length > 0) {
          accountId = String(rows1[0].id ?? rows1[0].account_id);
          accountFound = true;
          log.push({ step: "account_found_phone", id: accountId });
        } else {
          const r2 = await linetPost("newsearch/account", { ...creds, limit: 3, offset: 0, query: { cellular: localPhone } });
          const rows2 = Array.isArray(r2.data?.body) ? r2.data.body : (Array.isArray(r2.data) ? r2.data : []);
          if (rows2.length > 0) {
            accountId = String(rows2[0].id ?? rows2[0].account_id);
            accountFound = true;
            log.push({ step: "account_found_cellular", id: accountId });
          }
        }
      }

      if (!accountId) {
        let billingName = null, billingEmail = null, billingAddress = null, billingCity = null;
        if (order?.raw_data_billing) {
          try {
            const b = JSON.parse(order.raw_data_billing);
            billingName = [b.first_name, b.last_name].filter(Boolean).join(" ") || b.company || null;
            billingEmail = b.email ?? null;
            billingAddress = [b.address_1, b.address_2].filter(Boolean).join(", ") || null;
            billingCity = b.city ?? null;
          } catch (_) {}
        }
        accountToCreate = {
          name: billingName ?? client?.full_name ?? "לקוח לא ידוע",
          type: 0, cat_id: 0,
          phone: normalizePhoneLocal(client?.phone ?? null) ?? "",
          email: billingEmail ?? client?.email ?? "",
          address: billingAddress ?? client?.full_address ?? "",
          city: billingCity ?? client?.city ?? "",
          currency_id: "ILS", country_id: "IL", language: "he_il",
        };
        log.push({ step: "account_to_create", data: accountToCreate });

        if (apply) {
          const createRes = await linetPost("create/account", { ...creds, ...accountToCreate });
          log.push({ step: "account_create_response", http_status: createRes.http_status });
          const createdId = createRes.data?.body?.id ?? createRes.data?.id ?? null;
          if (!createdId) {
            return Response.json({ issued: false, error: "יצירת לקוח ב-Linet נכשלה", linet_response: createRes.data, log });
          }
          accountId = String(createdId);
        }
      }
    }

    log.push({ step: "account_resolved", account_id: accountId, account_found: accountFound });

    // ─── שלב 5: בנה docDetailes ─────────────────────────────────────────────

    // 5א. שורות סריאליות
    const serialLines = allSerialLines.filter(
      (l) => l.requires_serial && l.mapped_linet_item_id && Array.isArray(l.assigned_serials) && l.assigned_serials.length > 0
    );

    if (serialLines.length === 0) {
      return Response.json({ issued: false, error: "אין שורות סריאליות עם מיפוי ל-Linet וסריאליים מוקצים", log });
    }

    // set of skus שכבר מטופלים כסריאליים — לא לכפול בפריטים רגילים
    const serialSkus = new Set(serialLines.map((l) => l.source_sku ?? l.mapped_linet_sku).filter(Boolean));

    const docDetailes = [];

    for (const l of serialLines) {
      const qty = l.serials_required_count ?? l.assigned_serials.length;
      const prod = orderProducts.find((p) => p.sku && (p.sku === l.source_sku || p.sku === l.mapped_linet_sku));
      const totalInc = prod?.total ? parseFloat(prod.total) : null;

      if (totalInc === null || totalInc <= 0) {
        log.push({ step: "warn_missing_price_serial", sku: l.source_sku, name: l.source_product_name });
      }

      docDetailes.push(buildLine({
        item_id: l.mapped_linet_item_id,
        sku: l.mapped_linet_sku ?? l.source_sku ?? "",
        name: l.mapped_linet_item_name ?? l.source_product_name ?? "",
        qty,
        totalInc: totalInc ?? 0,
        serials: l.assigned_serials,
      }));
    }

    // 5ב. פריטים רגילים (לא סריאליים)
    for (const prod of orderProducts) {
      if (!prod.sku || serialSkus.has(prod.sku)) continue; // כבר מטופל כסריאלי
      const resolved = await resolveLinetItem(base44, creds, prod.sku, mapBySku[prod.sku], log);
      if (!resolved) {
        // פריט לא קיים ב-Linet כלל — חסום
        return Response.json({
          issued: false,
          blocked: true,
          reason: "unmapped_regular_item",
          messages_he: [`הפריט "${prod.name}" (מק"ט ${prod.sku}) לא נמצא ב-Linet. יש למפות אותו לפני הנפקת חשבונית.`],
          log,
        });
      }
      const totalInc = prod.total ? parseFloat(prod.total) : 0;
      const qty = prod.quantity ?? 1;
      docDetailes.push(buildLine({
        item_id: resolved.linet_item_id,
        sku: prod.sku,
        name: resolved.linet_item_name || prod.name || "",
        qty,
        totalInc,
        serials: [],
      }));
    }

    // 5ג. שורת משלוח
    const shippingTotal = order?.shipping_total ? parseFloat(order.shipping_total) : 0;
    if (shippingTotal > 0) {
      const shippingResolved = await resolveLinetItem(base44, creds, "19034", mapBySku["19034"], log);
      if (!shippingResolved) {
        return Response.json({
          issued: false,
          blocked: true,
          reason: "unmapped_shipping_item",
          messages_he: ["פריט המשלוח (מק\"ט 19034) אינו ממופה ל-Linet."],
          log,
        });
      }
      docDetailes.push(buildLine({
        item_id: shippingResolved.linet_item_id,
        sku: "19034",
        name: order.shipping_method ?? "משלוח",
        qty: 1,
        totalInc: shippingTotal,
        serials: [],
      }));
    }

    log.push({ step: "docDetailes_built", count: docDetailes.length, breakdown: { serial: serialLines.length, regular: orderProducts.filter((p) => p.sku && !serialSkus.has(p.sku)).length, shipping: shippingTotal > 0 ? 1 : 0 } });

    // ─── שלב 6: סיכומים כספיים ──────────────────────────────────────────────
    let subTotal = 0, totalInc = 0;
    for (const line of docDetailes) {
      const lineInc = Number(line.iItem) * Number(line.qty || 1);
      totalInc += lineInc;
      subTotal += lineInc / (1 + VAT_RATE);
    }
    const vatAmount   = totalInc - subTotal;
    const subTotalStr = fmt2(subTotal);
    const vatStr      = fmt2(vatAmount);
    const totalStr    = fmt2(totalInc);

    // ─── שלב 7: בדיקת איזון ─────────────────────────────────────────────────
    const orderTotalNum = order?.total ? parseFloat(order.total) : null;
    if (orderTotalNum !== null) {
      const diff = Math.abs(totalInc - orderTotalNum);
      if (diff > 0.05) {
        return Response.json({
          issued: false,
          blocked: true,
          reason: "unbalanced_invoice",
          expected: fmt2(orderTotalNum),
          got_doc_total: fmt2(totalInc),
          diff: fmt2(diff),
          messages_he: [`סך החשבונית (${fmt2(totalInc)}) אינו תואם לסכום ההזמנה (${fmt2(orderTotalNum)}). לא ניתן להפיק.`],
          log,
        });
      }
      log.push({ step: "balance_check", status: "passed", order_total: fmt2(orderTotalNum), doc_total: fmt2(totalInc), diff: fmt2(diff) });
    } else {
      log.push({ step: "balance_check", status: "skipped_no_order_total" });
    }

    // ─── שלב 8: סוג תשלום ───────────────────────────────────────────────────
    const isSuperPharm = allSerialLines.some((l) => l.source === "superpharm");
    const chequeType   = isSuperPharm ? 50 : 30;
    const orderTotalStr = order?.total ? fmt2(parseFloat(order.total)) : totalStr;

    // ─── שלב 9: payload ──────────────────────────────────────────────────────
    const dateStr = nowStr();
    const payload = {
      login_id: creds.login_id,
      login_hash: creds.login_hash,
      login_company: creds.login_company,

      doctype: "9",
      status: 2,
      language: "he_il",

      account_id: String(accountId ?? ""),
      company: client?.full_name ?? "",

      currency_id: "ILS",
      currency_rate: "1.0000",

      refnum: order?.external_order_number ?? "",
      refnum_ext: order?.external_order_number ?? "",
      description: `הזמנה ${order?.external_order_number ?? order_id}`,
      comments: order?.customer_note ?? "",

      owner: 8669,

      docDet: docDetailes,

      docCheq: [{
        type: chequeType,
        sum: Number(orderTotalStr),
        doc_sum: Number(orderTotalStr),
        currency_id: "ILS",
        line: 1,
      }],
    };

    // ─── הגנת TODOs ─────────────────────────────────────────────────────────
    const payloadStr   = JSON.stringify(payload);
    const todoMatches  = [...payloadStr.matchAll(/"TODO:[^"]+"/g)].map((m) => m[0]);
    const hasTodos     = todoMatches.length > 0;

    log.push({ step: "payload_built", has_todos: hasTodos, todos_found: todoMatches, sub_total: subTotalStr, vat: vatStr, total: totalStr });

    // ─── DRY-RUN ─────────────────────────────────────────────────────────────
    if (!apply) {
      return Response.json({
        issued: false,
        dry_run: true,
        gate_passed: true,
        balance_check: orderTotalNum !== null && Math.abs(totalInc - orderTotalNum) <= 0.05 ? "passed" : "skipped",
        has_todos: hasTodos,
        todos_found: todoMatches,
        account_resolved: { id: accountId, found_existing: accountFound },
        account_to_create: accountToCreate ?? null,
        financials: { sub_total: subTotalStr, vat: vatStr, total: totalStr, order_total: orderTotalStr },
        payload_preview: payload,
        serial_lines_included: serialLines.map((l) => ({
          item_name: l.source_product_name,
          linet_item_id: l.mapped_linet_item_id,
          serials: l.assigned_serials,
          status: l.serial_status,
        })),
        log,
      });
    }

    // ─── APPLY=TRUE ──────────────────────────────────────────────────────────
    if (hasTodos) {
      return Response.json({
        issued: false,
        error: "לא ניתן לשלוח חשבונית — יש שדות TODO שטרם אומתו",
        todos_found: todoMatches,
        log,
      });
    }

    // ─── הגנת refnum: בדיקה אחרונה לפני שליחה ─────────────────────────────
    const refnumCheck = await linetPost("newsearch/docs", {
      ...creds,
      limit: 5,
      offset: 0,
      query: { refnum: order?.external_order_number ?? "" },
    });
    const existingDocs = Array.isArray(refnumCheck.data?.body) ? refnumCheck.data.body : (Array.isArray(refnumCheck.data) ? refnumCheck.data : []);
    if (existingDocs.length > 0) {
      return Response.json({
        issued: false,
        blocked: true,
        reason: "invoice_already_exists_in_linet",
        existing: existingDocs.map((d) => ({ doctype: d.doctype, docnum: d.docnum, total: d.total })),
        messages_he: ["כבר קיימת חשבונית בלינט להזמנה זו. לא הופקה חשבונית כפולה."],
        log,
      });
    }
    log.push({ step: "refnum_check_passed", docs_found: 0 });

    const linetRes = await linetPost("create/doc", payload);
    log.push({ step: "linet_response", http_status: linetRes.http_status, data_keys: Object.keys(linetRes.data ?? {}) });

    const linetBody = linetRes.data;
    // errorCode !== 0 (או קיים ולא 0) = שגיאה, גם אם HTTP 200
    const hasError = linetRes.http_status !== 200
      || linetBody?.status === "error"
      || (linetBody?.errorCode !== undefined && linetBody?.errorCode !== 0 && linetBody?.errorCode !== null);
    if (hasError) {
      return Response.json({ issued: false, linet_error: linetBody, log });
    }

    const createdDocId     = linetBody?.body?.id ?? linetBody?.id ?? null;
    const createdDocNumber = linetBody?.body?.docnum ?? linetBody?.docnum ?? null;

    // ודא שה-id שהתקבל הוא ערך אמיתי ולא null
    if (!createdDocId || createdDocId === "null") {
      return Response.json({ issued: false, error: "Linet החזיר 200 אך ללא document id — ייתכן שהמסמך לא נוצר", linet_body: linetBody, log });
    }
    const invoicedAt       = new Date().toISOString();

    for (const line of serialLines) {
      const entityName = gateSerialLines.find((l) => l.id === line.id) ? "OrderItemSerial" : "OrderSerialLine";
      await base44.asServiceRole.entities[entityName].update(line.id, {
        linet_invoice_id: String(createdDocId),
        linet_document_number: String(createdDocNumber),
        linet_response: linetBody,
        invoiced_at: invoicedAt,
        serial_status: "invoiced",
      }).catch(() => {});
    }

    log.push({ step: "entities_updated", lines_updated: serialLines.length });

    return Response.json({
      issued: true,
      linet_invoice_id: String(createdDocId),
      linet_document_number: String(createdDocNumber),
      invoiced_at: invoicedAt,
      lines_updated: serialLines.length,
      log,
    });

  } catch (err) {
    return Response.json({ issued: false, error: err.message, stack: err.stack?.slice(0, 600) }, { status: 500 });
  }
});