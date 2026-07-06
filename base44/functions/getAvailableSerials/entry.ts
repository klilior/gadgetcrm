import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getAvailableSerials
 * שולף סריאליים זמינים לפריט נתון — מה-DB המקומי (SerialInventory), מחסן 115, מסונן.
 * READ-ONLY בלבד. לא פונה ל-Linet כלל (הוחלף מקריאה איטית שדפדפה מול newsearch/inventory).
 * קלט: { linet_item_id: number }
 * פלט: { serials: [{serial, is_fictive, qty}], count: number }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { linet_item_id } = body;

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

    const serials = (rows ?? []).map((row) => ({
      serial: row.serial,
      is_fictive: row.is_fictive ?? false,
      qty: row.qty ?? null,
    }));

    console.log(`[getAvailableSerials] item_id=${targetId}: returned ${serials.length} serials from local DB`);

    return Response.json({ serials, count: serials.length });

  } catch (err) {
    console.error("getAvailableSerials fatal:", err);
    return Response.json({ serials: [], count: 0, error: err.message });
  }
});