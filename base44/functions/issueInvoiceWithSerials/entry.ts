import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * issueInvoiceWithSerials
 * קלט: { order_id, apply (boolean, default false) }
 *
 * apply=false (ברירת מחדל) → DRY-RUN מוחלט: בונה payload ומחזיר אותו, לא שולח כלום ל-Linet.
 * apply=true → שולח POST /api/create/docs ל-Linet ושומר תוצאות.
 *
 * שלבים:
 * 1. שער checkInvoiceGate — חסימה מוחלטת אם blocked=true
 * 2. idempotency — מניעת כפילות לפי linet_invoice_id קיים
 * 3. בנה payload
 * 4. dry-run → החזר payload_preview
 * 5. apply=true → שלח, שמור, החזר
 */

// ─── helpers ───────────────────────────────────────────────────────────────

async function getLinetCreds(base44) {
  const settings = await base44.asServiceRole.entities.Settings.list();
  const get = (k) => settings.find((s) => s.setting_name === k)?.setting_value;
  const login_id = Deno.env.get("LINET_LOGIN_ID") || get("LINET_LOGIN_ID");
  const login_hash = Deno.env.get("LINET_LOGIN_HASH") || get("LINET_LOGIN_HASH");
  const login_company = Number(Deno.env.get("LINET_LOGIN_COMPANY") || get("LINET_LOGIN_COMPANY"));
  if (!login_id || !login_hash || !login_company) throw new Error("חסרים פרטי חיבור ל-Linet");
  return { login_id, login_hash, login_company };
}

async function callLinetApi(endpoint, body) {
  const res = await fetch(`https://app.linet.org.il/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await res.json();
  return { http_status: res.status, data: parsed };
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

    // ─── שלב 1: שער — inline מלוגיקת checkInvoiceGate ────────────────────
    // (base44.functions.invoke לא זמין בין Deno functions — לוגיקה מועתקת)
    const gateReasons = [];
    const gateMessages = [];

    let gateSerialLines = [];
    try {
      gateSerialLines = await base44.asServiceRole.entities.OrderItemSerial.filter({ order_id });
    } catch (_) {}
    let gateSerialLines2 = [];
    try {
      gateSerialLines2 = await base44.asServiceRole.entities.OrderSerialLine.filter({ order_id });
    } catch (_) {}
    const allGateLines = [...gateSerialLines, ...gateSerialLines2];

    let gateOrder = null;
    const gateRealId = order_id.startsWith("woo_") ? order_id.replace("woo_", "") : order_id;
    try { gateOrder = await base44.asServiceRole.entities.Order.get(gateRealId); } catch (_) {}

    const VALID_STATUSES = new Set(["selected", "verified", "invoiced"]);
    for (const line of allGateLines) {
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
    const shippingMethod = gateOrder?.shipping_method ?? null;
    if (!shippingMethod || String(shippingMethod).trim() === "") {
      gateReasons.push("missing_shipping_method");
      gateMessages.push("לא נבחרה שיטת משלוח.");
    }

    log.push({ step: "gate", blocked: gateReasons.length > 0, reasons: gateReasons });

    if (gateReasons.length > 0) {
      return Response.json({
        issued: false,
        blocked: true,
        reasons: gateReasons,
        messages_he: gateMessages,
        log,
      });
    }

    // ─── שלב 2: idempotency ────────────────────────────────────────────────
    // שורות כבר נשלפו בשלב השער — שימוש חוזר
    const serialLines = gateSerialLines;
    const serialLines2 = gateSerialLines2;
    const allLines = allGateLines;

    const alreadyInvoiced = allLines.find((l) => l.linet_invoice_id);
    if (alreadyInvoiced) {
      log.push({ step: "idempotency_block", existing_invoice_id: alreadyInvoiced.linet_invoice_id });
      return Response.json({
        issued: false,
        already_invoiced: true,
        existing_invoice_id: alreadyInvoiced.linet_invoice_id,
        log,
      });
    }

    // ─── שלב 3: שלוף נתוני הזמנה + לקוח ──────────────────────────────────
    let order = gateOrder; // כבר נשלף בשלב השער
    let client = null;

    const realOrderId = gateRealId;

    if (order?.client_id) {
      client = await base44.asServiceRole.entities.Client.get(order.client_id).catch(() => null);
    }

    log.push({
      step: "order_loaded",
      order_id_used: realOrderId,
      order_found: !!order,
      order_status: order?.status,
      shipping_method: order?.shipping_method,
      client_found: !!client,
      client_linet_account_id: client?.linet_account_id ?? null,
    });

    // ─── שלב 4: בנה docDetailes מהשורות הסריאליות ─────────────────────────
    const relevantLines = allLines.filter(
      (l) =>
        l.requires_serial &&
        l.mapped_linet_item_id &&
        Array.isArray(l.assigned_serials) &&
        l.assigned_serials.length > 0
    );

    if (relevantLines.length === 0) {
      return Response.json({
        issued: false,
        error: "אין שורות סריאליות עם מיפוי ל-Linet וסריאליים מוקצים",
        log,
      });
    }

    const docDetailes = relevantLines.map((l) => ({
      item_id: Number(l.mapped_linet_item_id),
      sku: l.mapped_linet_sku ?? l.source_sku ?? "TODO:missing_sku",
      qty: l.serials_required_count ?? l.assigned_serials.length,
      name: l.mapped_linet_item_name ?? l.source_product_name ?? "TODO:missing_name",
      serial: l.assigned_serials,
      // שדות נוספים לפי מבנה docDetailes שגילינו — ערכים שאנחנו לא יודעים:
      iItem: "TODO:unit_price_from_order",           // מחיר יחידה לפני מע"מ
      iItemWithVat: "TODO:unit_price_inc_vat",        // מחיר יחידה כולל מע"מ
      iTotal: "TODO:line_total_ex_vat",               // סה"כ שורה לפני מע"מ
      iTotalVat: "TODO:line_total_inc_vat",            // סה"כ שורה כולל מע"מ
      discount: "0.00",
      discountPer: "0.00",
      discountType: 0,
      currency_id: "ILS",
      currency_rate: "1.0000",
      unit_id: 0,
      vat_cat_id: 1,                                  // TODO: לאמת — 1 = 17% VAT?
      warehouse_id: "TODO:warehouse_id",              // מזהה מחסן ב-Linet — לא ידוע
    }));

    // ─── שלב 5: בנה payload מלא ────────────────────────────────────────────
    const creds = await getLinetCreds(base44);
    const now = new Date();
    const issueDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const payload = {
      // ─── אימות ───────────────────────────────────────────────────────────
      login_id: creds.login_id,
      login_hash: creds.login_hash,
      login_company: creds.login_company,

      // ─── סוג מסמך ────────────────────────────────────────────────────────
      // doctype: מה שאנחנו ראינו: 16 = קבלה, 9 = חשבונית מס, 3 = חשבונית זיכוי
      // לחשבונית מס רגילה — TODO: לאמת מה doctype המדויק לחשבונית מס עסקית
      doctype: "TODO:doctype_9_or_other",

      // ─── תאריכים ─────────────────────────────────────────────────────────
      issue_date: issueDateStr,
      due_date: issueDateStr,
      ref_date: issueDateStr,

      // ─── זיהוי לקוח ──────────────────────────────────────────────────────
      // אם יש account_id ב-Linet → משתמשים בו. אם לא — TODO
      account_id: client?.linet_account_id ?? "TODO:linet_account_id_required",
      company: client?.full_name ?? order?.raw_data_billing ?? "TODO:customer_name",

      // ─── ערכים כספיים ─────────────────────────────────────────────────────
      // sub_total / vat / total — חייב לחשב מ-docDetailes לאחר שיאומתו המחירים
      sub_total: "TODO:sum_of_iTotal",
      vat: "TODO:sum_of_vat_amounts",
      total: order?.total ?? "TODO:order_total",
      currency_id: "ILS",
      currency_rate: "1.0000",
      discount: "0.00",
      disType: 0,

      // ─── שדות משלוח / הפניה ───────────────────────────────────────────────
      refnum: order?.external_order_number ?? null,         // מספר הזמנה חיצוני
      refnum_ext: order?.external_order_number ?? null,
      description: `הזמנה ${order?.external_order_number ?? order_id}`,
      comments: order?.customer_note ?? "",
      shipping_method: order?.shipping_method ?? "",

      // ─── שורות פריט ───────────────────────────────────────────────────────
      docDetailes,

      // ─── שדות שלא בטוחים — מסומנים TODO ──────────────────────────────────
      language: "he_il",
      owner: "TODO:linet_owner_user_id",   // מי המנפיק — user ב-Linet, לא Base44
      signer: "TODO:linet_signer_if_needed",
      action: "TODO:create_or_approve",     // האם צריך לשלוח action=create?
      src_tax: "TODO:src_tax_value",        // ראינו שדה זה במסמך — לא יודעים ערכו
    };

    log.push({
      step: "payload_built",
      todos: [
        "doctype — יש לאמת: 9=חשבונית מס? או אחר?",
        "account_id — לקוח זה אין linet_account_id, חייב יצירה/חיפוש ב-Linet",
        "iItem/iItemWithVat/iTotal/iTotalVat — מחירי שורה חסרים, צריך לשלוף מ-OrderProduct",
        "warehouse_id — לא ידוע, חייב לבדוק בחשבונית אמיתית",
        "vat_cat_id=1 — צריך לאמת שזה אכן 17%",
        "owner — מזהה משתמש ב-Linet שמנפיק החשבונית",
        "src_tax / action / signer — שדות שראינו במסמך, לא ברורים",
        "sub_total/vat — חישוב אוטומטי מהשורות לאחר אימות המחירים",
      ],
    });

    // ─── DRY-RUN — apply=false ──────────────────────────────────────────────
    if (!apply) {
      return Response.json({
        issued: false,
        dry_run: true,
        gate_passed: true,
        order_id,
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

    // ─── APPLY=TRUE — שליחה אמיתית ─────────────────────────────────────────
    // TODO: להסיר את בלוק הבדיקה הזה לאחר אימות כל שדות TODO למעלה
    const hasTodos = JSON.stringify(payload).includes("TODO:");
    if (hasTodos) {
      return Response.json({
        issued: false,
        error: "לא ניתן לשלוח חשבונית — יש שדות TODO שטרם אומתו",
        todos_in_payload: log.find((l) => l.step === "payload_built")?.todos,
        log,
      });
    }

    // שלח ל-Linet
    const linetRes = await callLinetApi("create/docs", payload);
    log.push({ step: "linet_response", http_status: linetRes.http_status, data_keys: Object.keys(linetRes.data ?? {}) });

    const linetBody = linetRes.data;
    if (linetRes.http_status !== 200 || linetBody?.status === "error" || linetBody?.errorCode) {
      return Response.json({
        issued: false,
        linet_error: linetBody,
        log,
      });
    }

    // חלץ doc_id מהתשובה
    const createdDocId = linetBody?.body?.id ?? linetBody?.id ?? null;
    const createdDocNumber = linetBody?.body?.docnum ?? linetBody?.docnum ?? null;
    const invoicedAt = new Date().toISOString();

    // עדכן שורות ב-OrderItemSerial
    for (const line of relevantLines) {
      const entity = serialLines.find((l) => l.id === line.id)
        ? "OrderItemSerial"
        : "OrderSerialLine";
      await base44.asServiceRole.entities[entity].update(line.id, {
        linet_invoice_id: String(createdDocId),
        linet_document_number: String(createdDocNumber),
        linet_response: linetBody,
        invoiced_at: invoicedAt,
        serial_status: "invoiced",
      });
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
    return Response.json({ issued: false, error: err.message, stack: err.stack }, { status: 500 });
  }
});