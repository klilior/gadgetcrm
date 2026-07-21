import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * resolveSerialToItem — READ-ONLY
 * קלט: { serial: string }
 * פלט: { found: true, linet_item_id, linet_item_name, linet_sku, serial }
 *    | { found: true, ambiguous: true, candidates: [...] }
 *    | { found: false, reason: "serial_not_in_stock" }
 *
 * חשוב: ה-API של Linet (newsearch/inventory) מתעלם מפרמטרי ה-query ומחזיר תמיד
 * את השורות הראשונות של המלאי, לכן חיפוש בזמן אמת לפי idcode לא אמין.
 * לכן מזהים את הפריט מ-SerialInventory המקומי (מסונכרן ע"י syncSerialInventory),
 * בדיוק כפי ש-verifySerial עובד.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { serial } = body;

    if (!serial) return Response.json({ found: false, reason: "missing_params" }, { status: 400 });

    const serialNorm = String(serial).trim();

    let rows;
    try {
      rows = await base44.asServiceRole.entities.SerialInventory.filter({ serial: serialNorm });
    } catch (e) {
      return Response.json({ found: false, reason: "db_error", error: e.message });
    }

    const activeRows = (rows ?? []).filter((r) => r.active !== false);

    if (activeRows.length === 0) {
      return Response.json({ found: false, reason: "serial_not_in_stock" });
    }

    // כמה item_id שונים? — אמביגואיות
    const itemIds = [...new Set(activeRows.map((r) => Number(r.linet_item_id)).filter((n) => !Number.isNaN(n)))];

    if (itemIds.length > 1) {
      const candidates = itemIds.map((id) => {
        const row = activeRows.find((r) => Number(r.linet_item_id) === id);
        return {
          linet_item_id: id,
          linet_item_name: row?.item_name ?? null,
          linet_sku: row?.sku ?? null,
          stock_type: 2,
        };
      });
      return Response.json({ found: true, ambiguous: true, candidates, serial: serialNorm });
    }

    const row = activeRows[0];
    return Response.json({
      found: true,
      linet_item_id: Number(row.linet_item_id),
      linet_item_name: row.item_name ?? null,
      linet_sku: row.sku ?? null,
      stock_type: 2,
      serial: serialNorm,
    });

  } catch (err) {
    return Response.json({ found: false, reason: "db_error", error: err.message });
  }
});