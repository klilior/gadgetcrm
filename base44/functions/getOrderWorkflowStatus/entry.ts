import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * getOrderWorkflowStatus — READ-ONLY
 * מחזיר מצב תהליך מלא להזמנה אחת: באיזה שלב היא, מה חוסם ומה הפעולה הבאה.
 * קלט: { order_id?: string, external_order_number?: string }
 * פלט: { order, stages: [{ key, title, status, blockers, detail }], current_stage }
 *
 * לא מבצע שום כתיבה ולא משנה לוגיקה קיימת — מרכז את אותם שערים
 * (ליקוט / סריאלים / חשבונית / משלוח) לתמונה אחת לנציג.
 */

const SHIPPING_UPSELL_SKU = '180948';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id, external_order_number } = await req.json();

    let order = null;
    if (order_id) {
      try { order = await base44.asServiceRole.entities.Order.get(String(order_id)); } catch (_) {}
    }
    if (!order && external_order_number) {
      const found = await base44.asServiceRole.entities.Order.filter({ external_order_number: String(external_order_number) });
      order = found?.[0] ?? null;
    }
    if (!order) {
      return Response.json({ error: "order_not_found", message_he: "ההזמנה לא נמצאה במערכת." }, { status: 404 });
    }

    const oid = String(order.id);

    const [productsRaw, picks, serialLines, shipments] = await Promise.all([
      base44.asServiceRole.entities.OrderProduct.filter({ order_id: oid }).catch(() => []),
      base44.asServiceRole.entities.PickingState.filter({ order_id: oid }).catch(() => []),
      base44.asServiceRole.entities.OrderSerialLine.filter({ order_id: oid }).catch(() => []),
      base44.asServiceRole.entities.Shipment.filter({ order_id: oid }).catch(() => []),
    ]);

    const products = (productsRaw || []).filter(
      (p) => String(p.sku || '') !== SHIPPING_UPSELL_SKU && String(p.product_id ?? '') !== SHIPPING_UPSELL_SKU
    );

    const stages = [];

    // 1. ליקוט
    const totalPicks = picks.length;
    const pickedCount = picks.filter((p) => p.picked).length;
    const pickingDone = products.length === 0 || (totalPicks > 0 && pickedCount === totalPicks && totalPicks >= products.length);
    stages.push({
      key: "picking",
      title: "ליקוט",
      status: pickingDone ? "done" : pickedCount > 0 ? "in_progress" : "todo",
      detail: products.length === 0 ? "אין פריטים פיזיים" : `${pickedCount} מתוך ${Math.max(totalPicks, products.length)} פריטים נאספו`,
      blockers: pickingDone ? [] : ["יש להשלים סימון של כל הפריטים ברשימת הליקוט."],
      next_action: pickingDone ? null : "פתח את רשימת הליקוט וסמן את הפריטים",
    });

    // 2. סריאלים
    const serialRequired = serialLines.filter((l) => l.requires_serial);
    const READY = new Set(["selected", "verified", "invoiced"]);
    const serialBlockers = [];
    for (const l of serialRequired) {
      const name = l.source_product_name ?? l.order_item_id ?? "?";
      const assigned = Array.isArray(l.assigned_serials) ? l.assigned_serials.length : 0;
      const required = l.serials_required_count ?? 1;
      if (!l.mapped_linet_item_id) serialBlockers.push(`חסר מיפוי לפריט לינט עבור "${name}".`);
      else if (!READY.has(l.serial_status)) serialBlockers.push(`חסר מספר סידורי מאומת עבור "${name}".`);
      else if (assigned < required) serialBlockers.push(`"${name}" דורש ${required} סריאלים, נבחרו ${assigned}.`);
    }
    stages.push({
      key: "serials",
      title: "מספרים סידוריים",
      status: serialRequired.length === 0 ? "not_required" : serialBlockers.length === 0 ? "done" : "todo",
      detail: serialRequired.length === 0
        ? "אין פריטים סריאליים בהזמנה"
        : `${serialRequired.filter((l) => READY.has(l.serial_status)).length} מתוך ${serialRequired.length} שורות מוכנות`,
      blockers: serialBlockers,
      next_action: serialBlockers.length ? "בחר או סרוק סריאלי לכל פריט (אפשר לרענן מלאי חי מלינט)" : null,
    });

    // 3. חשבונית
    const invoicedLines = serialRequired.filter((l) => l.serial_status === "invoiced");
    const invoiceIssued = !!order.invoice_issued_at || (serialRequired.length > 0 && invoicedLines.length === serialRequired.length);
    const invoiceBlockers = [];
    if (!invoiceIssued) {
      if (serialBlockers.length) invoiceBlockers.push("לא ניתן להנפיק חשבונית לפני השלמת הסריאלים.");
      if (!order.shipping_method || String(order.shipping_method).trim() === "") invoiceBlockers.push("לא נבחרה שיטת משלוח.");
    }
    stages.push({
      key: "invoice",
      title: "חשבונית לינט",
      status: invoiceIssued ? "done" : serialRequired.length === 0 ? "not_required" : invoiceBlockers.length ? "blocked" : "ready",
      detail: invoiceIssued
        ? `הונפקה${order.invoice_issued_at ? ` ב-${new Date(order.invoice_issued_at).toLocaleString("he-IL")}` : ""}`
        : serialRequired.length === 0 ? "לא נדרשת חשבונית סריאלית" : "טרם הונפקה",
      blockers: invoiceBlockers,
      next_action: invoiceIssued || serialRequired.length === 0 ? null : invoiceBlockers.length ? null : "הנפק חשבונית עם סריאלים",
    });

    // 4. משלוח
    const activeShipment = (shipments || []).find((s) => s.status !== "cancelled" && s.status !== "failed") ?? null;
    const hasShipment = !!order.tracking_number || !!activeShipment;
    const shipmentBlockers = [];
    if (!hasShipment) {
      if (!pickingDone) shipmentBlockers.push("לא ניתן ליצור משלוח לפני השלמת ליקוט.");
      if (serialBlockers.length) shipmentBlockers.push("לא ניתן ליצור משלוח לפני השלמת הסריאלים.");
      if (serialRequired.length > 0 && !invoiceIssued) shipmentBlockers.push("יש להנפיק חשבונית עם סריאלים לפני יצירת משלוח.");
    }
    stages.push({
      key: "shipment",
      title: "משלוח",
      status: hasShipment ? "done" : shipmentBlockers.length ? "blocked" : "ready",
      detail: hasShipment
        ? `${order.tracking_carrier ?? activeShipment?.carrier ?? "שליח"} · מעקב ${order.tracking_number ?? activeShipment?.tracking_number ?? "—"}${activeShipment?.cargo_status_text ? ` · ${activeShipment.cargo_status_text}` : ""}`
        : "טרם נוצר משלוח",
      blockers: shipmentBlockers,
      next_action: hasShipment ? null : shipmentBlockers.length ? null : "צור משלוח",
    });

    // 5. סגירת הזמנה
    const completed = String(order.status) === "completed";
    stages.push({
      key: "closing",
      title: "סגירת הזמנה",
      status: completed ? "done" : hasShipment ? "ready" : "todo",
      detail: completed ? "ההזמנה הושלמה ועודכנה באתר" : `סטטוס נוכחי: ${order.status ?? "—"}`,
      blockers: completed || hasShipment ? [] : ["ההזמנה תיסגר אוטומטית לאחר יצירת משלוח."],
      next_action: completed ? null : hasShipment ? "עדכן סטטוס להושלם" : null,
    });

    const current = stages.find((s) => s.status !== "done" && s.status !== "not_required") ?? stages[stages.length - 1];

    return Response.json({
      order: {
        id: order.id,
        external_order_number: order.external_order_number,
        status: order.status,
        order_date: order.order_date,
        total: order.total,
        shipping_method: order.shipping_method,
        tracking_number: order.tracking_number ?? null,
        tracking_carrier: order.tracking_carrier ?? null,
        tracking_url: order.tracking_url ?? null,
        order_locked: !!order.order_locked,
        customer_note: order.customer_note ?? null,
        raw_data_billing: order.raw_data_billing ?? null,
      },
      products: products.map((p) => ({ name: p.product_name ?? p.name ?? "", sku: p.sku ?? null, quantity: p.quantity ?? 1 })),
      serial_lines: serialRequired.map((l) => ({
        id: l.id,
        name: l.source_product_name,
        mapped_linet_item_id: l.mapped_linet_item_id ?? null,
        assigned_serials: l.assigned_serials ?? [],
        required: l.serials_required_count ?? 1,
        serial_status: l.serial_status,
      })),
      stages,
      current_stage: current.key,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});