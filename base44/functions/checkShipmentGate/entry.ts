import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * checkShipmentGate — READ-ONLY
 * קלט: { order_id }
 * פלט: { blocked: boolean, reasons: string[], messages_he: string[] }
 *
 * שער: אם יש שורה סריאלית ו-serial_status שלה אינו invoiced → חסום
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

    const notInvoiced = serialLinesWithRequirement.filter((l) => l.serial_status !== "invoiced");

    if (notInvoiced.length > 0) {
      const names = notInvoiced.map((l) => l.source_product_name ?? l.order_item_id ?? "?");
      return Response.json({
        blocked: true,
        reasons: ["no_invoice_yet"],
        messages_he: [`לא ניתן ליצור משלוח לפני הנפקת חשבונית עם מספר סידורי עבור: ${names.join(", ")}.`],
        _debug: { not_invoiced_count: notInvoiced.length, order_id },
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