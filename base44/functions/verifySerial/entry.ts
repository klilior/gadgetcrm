import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * verifySerial — READ-ONLY
 * קלט: { linet_item_id: number, serial: string }
 * פלט: { valid: bool, reason: string, ... }
 *
 * לוגיקה: אימות מול ה-DB המקומי (SerialInventory) — לא מול Linet בזמן אמת.
 * חשוב: ה-API של Linet (newsearch/inventory) מתעלם מפרמטרי ה-query ומחזיר
 * תמיד את 50 השורות הראשונות של המלאי, לכן חיפוש בזמן אמת לפי idcode לא מוצא
 * את הסריאלי. ה-SerialInventory המקומי מסונכרן נכון (syncSerialInventory) ומכיל
 * את הסריאלי תחת ה-item_id הנכון.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { linet_item_id, serial } = body;

    if (!linet_item_id || !serial) {
      return Response.json({ valid: false, reason: "missing_params" }, { status: 400 });
    }

    const serialNorm = String(serial).trim();
    const targetItemId = Number(linet_item_id);

    // חיפוש הסריאלי ב-DB המקומי (מחפשים לפי serial בלבד, מסננים item_id בצד הלקוח)
    let rows;
    try {
      rows = await base44.asServiceRole.entities.SerialInventory.filter({ serial: serialNorm });
    } catch (e) {
      return Response.json({ valid: false, reason: "db_error", error: e.message });
    }

    const activeRows = (rows ?? []).filter((r) => r.active !== false);

    if (activeRows.length === 0) {
      return Response.json({ valid: false, reason: "not_found_in_stock" });
    }

    // בדיקת item_id — הגנה קריטית מפני סריאלי של פריט שגוי
    const correctItemRow = activeRows.find((r) => Number(r.linet_item_id) === targetItemId);

    if (correctItemRow) {
      // בדיקה שהסריאלי לא משויך כבר להזמנה פתוחה אחרת
      const { exclude_line_id } = body;
      try {
        const activeStatuses = ["selected", "verified", "invoiced"];
        const [osl, ois] = await Promise.all([
          base44.asServiceRole.entities.OrderSerialLine.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
          base44.asServiceRole.entities.OrderItemSerial.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
        ]);
        const conflict = [...osl, ...ois].find((l) =>
          l.id !== exclude_line_id && (l.assigned_serials || []).map(String).includes(serialNorm)
        );
        if (conflict) {
          return Response.json({
            valid: false,
            reason: "assigned_to_other_order",
            conflicting_order_id: conflict.order_id || null,
          });
        }
      } catch (_) {
        // non-blocking — item validity already confirmed
      }

      return Response.json({
        valid: true,
        reason: "found_in_stock",
        matched_item_id: targetItemId,
      });
    }

    // הסריאלי קיים אבל שייך לפריט אחר — חסימה קריטית
    const otherRow = activeRows[0];
    return Response.json({
      valid: false,
      reason: "belongs_to_other_item",
      found_item_id: Number(otherRow.linet_item_id) || null,
      found_item_name: otherRow.item_name ?? null,
    });

  } catch (err) {
    console.error("verifySerial fatal:", err);
    return Response.json({ valid: false, reason: "db_error", error: err.message });
  }
});