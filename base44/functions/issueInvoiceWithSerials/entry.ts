import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * issueInvoiceWithSerials
 * קלט: { order_id, apply (boolean, default false) }
 *
 * apply=false → DRY-RUN: בונה payload מלא, לא שולח.
 * apply=true  → שולח POST /api/create/docs ל-Linet, שומר תוצאות.
 *
 * כל ערכי הבסיס מאומתים ממסמך doctype=9 אמיתי (#40452).
 */

// ─── helpers ───────────────────────────────────────────────────────────────

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

// נרמול טלפון לפורמט מקומי ישראלי (0XX...)
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

// ─── main ───────────────────────────────────────────────────────────────────

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

    // ─── שלב 1: שער — inline checkInvoiceGate ─────────────────────────────
    const gateReasons = [];
    const gateMessages = [];
    const realOrderId = order_id.startsWith("woo_") ? order_id.replace("woo_", "") : order_id;

    let gateSerialLines = [];
    try { gateSerialLines = await base44.asServiceRole.entities.OrderItemSerial.filter({ order_id }); } catch (_) {}
    let gateSerialLines2 = [];
    try { gateSerialLines2 = await base44.asServiceRole.entities.OrderSerialLine.filter({ order_id }); } catch (_) {}
    const allLines = [...gateSerialLines, ...gateSerialLines2];

    let order = null;
    try { order = await base44.asServiceRole.entities.Order.get(realOrderId); } catch (_) {}

    const VALID_STATUSES = new Set(["selected", "verified", "invoiced"]);
    for (const line of allLines) {
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

    // ─── שלב 2: idempotency ────────────────────────────────────────────────
    const alreadyInvoiced = allLines.find((l) => l.linet_invoice_id);
    if (alreadyInvoiced) {
      log.push({ step: "idempotency_block", existing_invoice_id: alreadyInvoiced.linet_invoice_id });
      return Response.json({ issued: false, already_invoiced: true, existing_invoice_id: alreadyInvoiced.linet_invoice_id, log });
    }

    // ─── שלב 3: נתוני הזמנה + לקוח + OrderProducts ────────────────────────
    let client = null;
    if (order?.client_id) {
      client = await base44.asServiceRole.entities.Client.get(order.client_id).catch(() => null);
    }

    // שלוף OrderProducts לקבלת מחירים
    let orderProducts = [];
    try { orderProducts = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: realOrderId }); } catch (_) {}

    log.push({
      step: "data_loaded",
      order_found: !!order,
      client_found: !!client,
      client_linet_account_id: client?.linet_account_id ?? null,
      order_products_count: orderProducts.length,
    });

    // ─── שלב 4: זיהוי/יצירת לקוח ─────────────────────────────────────────
    const creds = getLinetCreds();

    let accountId = client?.linet_account_id ?? null;
    let accountToCreate = null;
    let accountFound = !!accountId;
    let accountSearchLog = null;

    if (!accountId) {
      // נרמל טלפון
      let rawPhone = null;
      if (order?.raw_data_billing) {
        try {
          const billing = JSON.parse(order.raw_data_billing);
          rawPhone = billing.phone ?? billing.billing?.phone ?? null;
        } catch (_) {}
      }
      if (!rawPhone) rawPhone = client?.phone ?? client?.phone_original ?? null;
      const localPhone = normalizePhoneLocal(rawPhone);

      log.push({ step: "phone_resolve", raw: rawPhone, normalized: localPhone });

      if (localPhone) {
        // חפש לפי phone
        const searchRes = await linetPost("newsearch/account", { ...creds, limit: 3, offset: 0, query: { phone: localPhone } });
        const searchRows = Array.isArray(searchRes.data?.body) ? searchRes.data.body : (Array.isArray(searchRes.data) ? searchRes.data : []);
        accountSearchLog = { field: "phone", value: localPhone, http_status: searchRes.http_status, row_count: searchRows.length };

        if (searchRows.length === 0) {
          // נסה גם cellular
          const searchRes2 = await linetPost("newsearch/account", { ...creds, limit: 3, offset: 0, query: { cellular: localPhone } });
          const searchRows2 = Array.isArray(searchRes2.data?.body) ? searchRes2.data.body : (Array.isArray(searchRes2.data) ? searchRes2.data : []);
          accountSearchLog.cellular_fallback = { http_status: searchRes2.http_status, row_count: searchRows2.length };
          if (searchRows2.length > 0) {
            accountId = String(searchRows2[0].id ?? searchRows2[0].account_id);
            accountFound = true;
            accountSearchLog.found_via = "cellular";
            accountSearchLog.found_id = accountId;
          }
        } else {
          accountId = String(searchRows[0].id ?? searchRows[0].account_id);
          accountFound = true;
          accountSearchLog.found_via = "phone";
          accountSearchLog.found_id = accountId;
        }
      }

      log.push({ step: "account_search", ...accountSearchLog });

      if (!accountId) {
        // לא נמצא — הכן אובייקט ליצירה
        let billingName = null;
        let billingEmail = null;
        let billingAddress = null;
        let billingCity = null;
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
          type: 0,
          cat_id: 0,
          phone: normalizePhoneLocal(client?.phone ?? null) ?? "",
          email: billingEmail ?? client?.email ?? "",
          address: billingAddress ?? client?.full_address ?? "",
          city: billingCity ?? client?.city ?? "",
          currency_id: "ILS",
          country_id: "IL",
          language: "he_il",
        };
        log.push({ step: "account_to_create", data: accountToCreate });

        if (apply) {
          // יצירת לקוח אמיתית
          const createRes = await linetPost("create/account", { ...creds, ...accountToCreate });
          log.push({ step: "account_create_response", http_status: createRes.http_status, data: createRes.data });
          const createdId = createRes.data?.body?.id ?? createRes.data?.id ?? null;
          if (!createdId) {
            return Response.json({ issued: false, error: "יצירת לקוח ב-Linet נכשלה", linet_response: createRes.data, log });
          }
          accountId = String(createdId);
          log.push({ step: "account_created", linet_account_id: accountId });
        }
      }
    }

    log.push({ step: "account_resolved", account_id: accountId, account_found: accountFound });

    // ─── שלב 5: בנה docDetailes ────────────────────────────────────────────
    const VAT_RATE = 0.17;
    const relevantLines = allLines.filter(
      (l) => l.requires_serial && l.mapped_linet_item_id && Array.isArray(l.assigned_serials) && l.assigned_serials.length > 0
    );

    if (relevantLines.length === 0) {
      return Response.json({ issued: false, error: "אין שורות סריאליות עם מיפוי ל-Linet וסריאליים מוקצים", log });
    }

    const docDetailes = relevantLines.map((l) => {
      const qty = l.serials_required_count ?? l.assigned_serials.length;

      // מצא מחיר מ-OrderProduct לפי sku
      let lineTotalInc = null;
      const prod = orderProducts.find(
        (p) => p.sku && (p.sku === l.source_sku || p.sku === l.mapped_linet_sku)
      );
      if (prod?.total) lineTotalInc = parseFloat(prod.total);

      // חישוב: iTotalVat = סה"כ שורה כולל מע"מ, iTotal = ללא מע"מ
      // iItem = מחיר יחידה ללא מע"מ
      let iTotalVat, iTotal, iItem;
      if (lineTotalInc !== null && qty > 0) {
        iTotalVat = lineTotalInc;
        iTotal = iTotalVat / (1 + VAT_RATE);
        iItem = iTotal / qty;
      } else {
        // fallback מ-total ההזמנה חלקי מספר שורות
        iTotalVat = null;
        iTotal = null;
        iItem = null;
      }

      return {
        // ─── זיהוי פריט ─────────────────────────────────────────────────
        item_id: Number(l.mapped_linet_item_id),
        sku: l.mapped_linet_sku ?? l.source_sku ?? "",
        name: l.mapped_linet_item_name ?? l.source_product_name ?? "",
        qty: fmt4(qty),                              // string 4 ספרות
        serial: l.assigned_serials,                   // array of strings
        // ─── מחירים (string 2 ספרות) ────────────────────────────────────
        iItem:       iItem !== null ? fmt2(iItem) : "TODO:unit_price_ex_vat",
        iItemWithVat: 1,                              // number — flag, לא מחיר
        iTotal:      iTotal !== null ? fmt2(iTotal) : "TODO:line_total_ex_vat",
        iTotalVat:   iTotalVat !== null ? fmt2(iTotalVat) : "TODO:line_total_inc_vat",
        // ─── שדות קבועים ─────────────────────────────────────────────────
        discount:      "0.00",
        discountPer:   "0.00",
        discountType:  0,
        currency_id:   "ILS",
        currency_rate: "1.0000",
        unit_id:       0,
        vat_cat_id:    1,
        warehouse_id:  115,
      };
    });

    log.push({ step: "docDetailes_built", count: docDetailes.length });

    // ─── שלב 6: חישוב סיכומים כספיים ──────────────────────────────────────
    let subTotal = 0;
    let totalInc = 0;
    for (const line of docDetailes) {
      subTotal += line.iTotal !== null && !String(line.iTotal).includes("TODO") ? parseFloat(line.iTotal) : 0;
      totalInc += line.iTotalVat !== null && !String(line.iTotalVat).includes("TODO") ? parseFloat(line.iTotalVat) : 0;
    }
    const vatAmount = totalInc - subTotal;
    const subTotalStr = fmt2(subTotal);
    const vatStr = fmt2(vatAmount);
    const totalStr = fmt2(totalInc);

    // ─── שלב 7: זיהוי סוג תשלום לפי מקור ─────────────────────────────────
    // SuperPharm = 50, WooCommerce = 30
    const isSuperPharm = allLines.some((l) => l.source === "superpharm");
    const chequeType = isSuperPharm ? 50 : 30;
    const orderTotal = order?.total ? fmt2(parseFloat(order.total)) : totalStr;

    // ─── שלב 8: בנה payload מלא ────────────────────────────────────────────
    const dateStr = nowStr();
    const payload = {
      // ─── אימות ───────────────────────────────────────────────────────────
      login_id: creds.login_id,
      login_hash: creds.login_hash,
      login_company: creds.login_company,

      // ─── מסמך ────────────────────────────────────────────────────────────
      doctype: 9,
      action: 1,
      language: "he_il",
      issue_date: dateStr,
      due_date: dateStr,
      ref_date: dateStr,

      // ─── לקוח ────────────────────────────────────────────────────────────
      account_id: accountId ?? "TODO:linet_account_id_required",
      company: client?.full_name ?? "",

      // ─── כספי ────────────────────────────────────────────────────────────
      sub_total: subTotalStr,
      vat: vatStr,
      total: totalStr,
      currency_id: "ILS",
      currency_rate: "1.0000",
      src_tax: "0.00",
      discount: "0.00",
      disType: 1,

      // ─── הפניה ───────────────────────────────────────────────────────────
      refnum: order?.external_order_number ?? "",
      refnum_ext: order?.external_order_number ?? "",
      description: `הזמנה ${order?.external_order_number ?? order_id}`,
      comments: order?.customer_note ?? "",

      // ─── owner — TODO: יש לספק מזהה user ב-Linet ────────────────────────
      owner: "TODO:linet_owner_user_id",

      // ─── שורות פריט ───────────────────────────────────────────────────────
      docDetailes,

      // ─── תשלום ───────────────────────────────────────────────────────────
      docCheques: [{
        type: chequeType,
        sum: orderTotal,
        doc_sum: orderTotal,
        currency_id: "ILS",
        currency_rate: "1.0000",
        line: 1,
        bank_refnum: null,
      }],
    };

    // ─── הגנת TODOs ────────────────────────────────────────────────────────
    const payloadStr = JSON.stringify(payload);
    const todoMatches = [...payloadStr.matchAll(/"TODO:[^"]+"/g)].map((m) => m[0]);
    const hasTodos = todoMatches.length > 0;

    log.push({
      step: "payload_built",
      has_todos: hasTodos,
      todos_found: todoMatches,
      sub_total: subTotalStr,
      vat: vatStr,
      total: totalStr,
      cheque_type: chequeType,
    });

    // ─── DRY-RUN — apply=false ──────────────────────────────────────────────
    if (!apply) {
      return Response.json({
        issued: false,
        dry_run: true,
        gate_passed: true,
        has_todos: hasTodos,
        todos_found: todoMatches,
        account_resolved: { id: accountId, found_existing: accountFound },
        account_to_create: accountToCreate ?? null,
        payload_preview: payload,
        serial_lines_included: relevantLines.map((l) => ({
          line_id: l.id,
          item_name: l.source_product_name,
          linet_item_id: l.mapped_linet_item_id,
          serials: l.assigned_serials,
          status: l.serial_status,
        })),
        log,
      });
    }

    // ─── APPLY=TRUE — חסום אם יש TODOs ────────────────────────────────────
    if (hasTodos) {
      return Response.json({
        issued: false,
        error: "לא ניתן לשלוח חשבונית — יש שדות TODO שטרם אומתו",
        todos_found: todoMatches,
        log,
      });
    }

    // ─── שלח ל-Linet ───────────────────────────────────────────────────────
    const linetRes = await linetPost("create/docs", payload);
    log.push({ step: "linet_response", http_status: linetRes.http_status, data_keys: Object.keys(linetRes.data ?? {}) });

    const linetBody = linetRes.data;
    if (linetRes.http_status !== 200 || linetBody?.status === "error" || linetBody?.errorCode) {
      return Response.json({ issued: false, linet_error: linetBody, log });
    }

    const createdDocId = linetBody?.body?.id ?? linetBody?.id ?? null;
    const createdDocNumber = linetBody?.body?.docnum ?? linetBody?.docnum ?? null;
    const invoicedAt = new Date().toISOString();

    // עדכן שורות — לא מעדכן כלום אם Linet החזיר שגיאה (הגנה לעיל)
    for (const line of relevantLines) {
      const entityName = gateSerialLines.find((l) => l.id === line.id) ? "OrderItemSerial" : "OrderSerialLine";
      await base44.asServiceRole.entities[entityName].update(line.id, {
        linet_invoice_id: String(createdDocId),
        linet_document_number: String(createdDocNumber),
        linet_response: linetBody,
        invoiced_at: invoicedAt,
        serial_status: "invoiced",
      }).catch(() => {});
    }

    log.push({ step: "entities_updated", lines_updated: relevantLines.length });

    return Response.json({
      issued: true,
      linet_invoice_id: String(createdDocId),
      linet_document_number: String(createdDocNumber),
      invoiced_at: invoicedAt,
      lines_updated: relevantLines.length,
      log,
    });

  } catch (err) {
    return Response.json({ issued: false, error: err.message, stack: err.stack?.slice(0, 600) }, { status: 500 });
  }
});