import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * checkInvoiceGate — READ-ONLY
 * קלט: { order_id }
 * פלט: { blocked: boolean, reasons: string[], messages_he: string[] }
 *
 * שערים:
 * 1. שורה סריאלית בלי serial_status ∈ {selected, verified, invoiced} → missing_serial
 * 2. שורה סריאלית בלי mapped_linet_item_id → missing_linet_mapping
 * 3. assigned_serials.length < serials_required_count → insufficient_serials
 * 4. שיטת משלוח ריקה → missing_shipping_method
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ blocked: true, reasons: ["missing_order_id"], messages_he: ["לא סופק מזהה הזמנה."] }, { status: 400 });
    }

    // --- שלוף OrderSerialLine ---
    let serialLines = [];
    try {
      serialLines = await base44.asServiceRole.entities.OrderSerialLine.filter({ order_id });
    } catch (e) {
      // אם שליפה נכשלת — חסום כדי לא לאפשר הנפקה שגויה
      return Response.json({
        blocked: true,
        reasons: ["fetch_error"],
        messages_he: [`לא ניתן להנפיק חשבונית: שגיאה בשליפת נתוני סריאלי (${e.message}).`],
      });
    }

    // --- שלוף נתוני הזמנה ---
    let order = null;
    try {
      order = await base44.asServiceRole.entities.Order.get(order_id);
    } catch (_) {
      // לא קורסים אם ההזמנה לא נמצאה — נבדוק shipping_method בנפרד
    }

    // לוג שדות הזמנה לאימות
    const orderFields = order ? Object.keys(order) : [];

    const reasons = [];
    const messages_he = [];

    // === שער 1+3: בדיקות שורות סריאליות ===
    const VALID_STATUSES = new Set(["selected", "verified", "invoiced"]);

    for (const line of serialLines) {
      if (!line.requires_serial) continue;

      const name = line.source_product_name ?? line.order_item_id ?? "?";

      // שער 2: חסר מיפוי Linet
      if (!line.mapped_linet_item_id) {
        reasons.push("missing_linet_mapping");
        messages_he.push(`לא ניתן להנפיק חשבונית: חסר מיפוי לפריט Linet עבור "${name}".`);
        continue; // אין טעם לבדוק סריאליים בלי מיפוי
      }

      // שער 1: status לא תקין
      if (!VALID_STATUSES.has(line.serial_status)) {
        reasons.push("missing_serial");
        messages_he.push(`לא ניתן להנפיק חשבונית: חסר מספר סידורי מאומת עבור "${name}".`);
        continue;
      }

      // שער 3: מספר סריאליים לא מספיק
      const assigned = Array.isArray(line.assigned_serials) ? line.assigned_serials.length : 0;
      const required = line.serials_required_count ?? 1;
      if (assigned < required) {
        reasons.push("insufficient_serials");
        messages_he.push(`לא ניתן להנפיק חשבונית: "${name}" דורש ${required} סריאלי/ים אך הוגדרו רק ${assigned}.`);
      }
    }

    // === שער 4: שיטת משלוח ===
    // שדה shipping_method קיים ב-Order entity (גם shipping_total וגם shipping_method)
    const shippingMethod = order?.shipping_method ?? null;
    if (!shippingMethod || String(shippingMethod).trim() === "") {
      reasons.push("missing_shipping_method");
      messages_he.push("לא ניתן להנפיק חשבונית: לא נבחרה שיטת משלוח.");
    }

    return Response.json({
      blocked: reasons.length > 0,
      reasons,
      messages_he,
      // מידע אבחון — שם השדה שמצאנו
      _debug: {
        order_fields_found: orderFields,
        shipping_method_field: "shipping_method",
        shipping_method_value: shippingMethod,
        serial_lines_count: serialLines.length,
        order_id,
      },
    });

  } catch (err) {
    return Response.json({
      blocked: true,
      reasons: ["unexpected_error"],
      messages_he: [`שגיאה לא צפויה בבדיקת שער החשבונית: ${err.message}`],
    }, { status: 500 });
  }
});