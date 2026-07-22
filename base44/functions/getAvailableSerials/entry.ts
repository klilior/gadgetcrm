import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getAvailableSerials
 * שולף סריאליים זמינים לפריט נתון — מה-DB המקומי (SerialInventory), מחסן 115, מסונן.
 * READ-ONLY בלבד. לא פונה ל-Linet כלל.
 * מסנן החוצה סריאליים שכבר הוקצו להזמנות פתוחות אחרות (מניעת הקצאה כפולה).
 * קלט: { linet_item_id: number, exclude_line_id?: string }  — exclude_line_id: השורה הנוכחית,
 *       כדי שהסריאליים שכבר נבחרו בה יישארו מוצגים.
 * פלט: { serials: [{serial, is_fictive, qty}], count: number }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { linet_item_id, exclude_line_id } = body;

    // הגנה: בלי linet_item_id תקין אי אפשר לסנן
    if (linet_item_id == null || linet_item_id === "" || Number.isNaN(Number(linet_item_id))) {
      return Response.json({ serials: [], count: 0, warning: "חסר linet_item_id — לא ניתן לסנן סריאלים" });
    }

    const targetId = Number(linet_item_id);

    // קריאה מקומית מיידית מ-DB
    const rows = await base44.asServiceRole.entities.SerialInventory.filter({
      linet_item_id: targetId,
      active: true,
    });

    // סריאליים שכבר משויכים להזמנות אחרות (selected/verified/invoiced) — לא זמינים
    const takenSerials = new Set<string>();
    try {
      const activeStatuses = ["selected", "verified", "invoiced"];
      const [osl, ois] = await Promise.all([
        base44.asServiceRole.entities.OrderSerialLine.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
        base44.asServiceRole.entities.OrderItemSerial.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
      ]);
      for (const l of [...osl, ...ois]) {
        if (exclude_line_id && l.id === exclude_line_id) continue;
        for (const s of (l.assigned_serials || [])) takenSerials.add(String(s));
      }
    } catch (takenErr) {
      console.warn("[getAvailableSerials] failed loading assigned serials (non-critical):", takenErr.message);
    }

    const serials = (rows ?? [])
      .filter((row) => !takenSerials.has(String(row.serial)))
      .map((row) => ({
        serial: row.serial,
        is_fictive: row.is_fictive ?? false,
        qty: row.qty ?? null,
      }));

    console.log(`[getAvailableSerials] item_id=${targetId}: ${serials.length} available (${takenSerials.size} taken by other orders)`);

    return Response.json({ serials, count: serials.length });

  } catch (err) {
    console.error("getAvailableSerials fatal:", err);
    return Response.json({ serials: [], count: 0, error: err.message });
  }
});