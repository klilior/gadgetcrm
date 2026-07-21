import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * checkShipmentGate — READ-ONLY
 * קלט: { order_id }
 * פלט: { blocked: boolean, reasons: string[], messages_he: string[] }
 *
 * שער לפי מקור:
 * - Woo: סריאל חייב להיות נבחר; אם נבחר אך לא הופקה חשבונית → no_invoice_yet
 *   (הפרונט מציע להנפיק ולהמשיך). חשבונית מופקת לפני המשלוח.
 * - Super-Pharm: החשבונית מופקת *אחרי* המשלוח (במסך ההצלחה) — לכן דורשים רק
 *   שהסריאל נבחר/אומת בכמות מספקת, לא "invoiced".
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ blocked: true, reasons: ["missing_order_id"], messages_he: ["לא סופק מזהה הזמנה."] }, { status: 400 });
    }

    let serialLines = [];
    try {
      serialLines = await base44.asServiceRole.entities.OrderSerialLine.filter({ order_id });
    } catch (e) {
      return Response.json({
        blocked: true,
        reasons: ["fetch_error"],
        messages_he: [`לא ניתן ליצור משלוח: שגיאה בשליפת נתוני סריאלי (${e.message}).`],
      });
    }

    const serialLinesWithRequirement = serialLines.filter((l) => l.requires_serial);

    if (serialLinesWithRequirement.length === 0) {
      // אין שורות סריאליות — המשלוח מותר
      return Response.json({ blocked: false, reasons: [], messages_he: [] });
    }

    // זיהוי הזמנת SP: source=superpharm בשורה, או פורמט מזהה Mirakl (למשל 029958952-A)
    const isSPOrder = /^\d+-[A-Z]$/.test(String(order_id));
    const SERIAL_READY_STATUSES = new Set(["selected", "verified", "invoiced"]);

    const reasons = [];
    const messages_he = [];

    for (const line of serialLinesWithRequirement) {
      const name = line.source_product_name ?? line.order_item_id ?? "?";
      const isSP = isSPOrder || line.source === "superpharm";
      const assigned = Array.isArray(line.assigned_serials) ? line.assigned_serials.length : 0;
      const required = line.serials_required_count ?? 1;
      const serialChosen = SERIAL_READY_STATUSES.has(line.serial_status) && assigned >= required;

      if (!serialChosen) {
        // בשני המקורות: חייבים סריאל נבחר לפני משלוח
        reasons.push("missing_serial");
        messages_he.push(`יש לבחור ולאמת מספר סידורי עבור "${name}" ברשימת הליקוט לפני יצירת משלוח.`);
        continue;
      }

      if (isSP) {
        // SP: החשבונית מופקת אחרי המשלוח — סריאל נבחר מספיק
        continue;
      }

      // Woo: סריאל נבחר אך טרם הופקה חשבונית
      if (line.serial_status !== "invoiced") {
        reasons.push("no_invoice_yet");
        messages_he.push(`לא ניתן ליצור משלוח לפני הנפקת חשבונית עם מספר סידורי עבור: ${name}.`);
      }
    }

    if (reasons.length > 0) {
      return Response.json({
        blocked: true,
        reasons,
        messages_he,
        _debug: { order_id, is_sp: isSPOrder, lines_checked: serialLinesWithRequirement.length },
      });
    }

    return Response.json({ blocked: false, reasons: [], messages_he: [] });

  } catch (err) {
    return Response.json({
      blocked: true,
      reasons: ["unexpected_error"],
      messages_he: [`שגיאה לא צפויה בבדיקת שער המשלוח: ${err.message}`],
    }, { status: 500 });
  }
});