import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * verifySerial — READ-ONLY
 * קלט: { linet_item_id: number, serial: string }
 * פלט: { valid: bool, reason: string, ... }
 *
 * לוגיקה: קריאה אחת לפי {"idcode": serial}, סינון ידני על item_id בתוצאה.
 * item_id בquery לא מסנן בצד Linet — חייבים לבדוק בצד הלקוח.
 */

async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
    if (!login_id) login_id = getSetting("LINET_LOGIN_ID");
    if (!login_hash) login_hash = getSetting("LINET_LOGIN_HASH");
    if (!login_company) login_company = getSetting("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");
  return { login_id: String(login_id), login_hash: String(login_hash), login_company: Number(login_company) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { linet_item_id, serial } = body;

    if (!linet_item_id || !serial) {
      return Response.json({ valid: false, reason: "missing_params" }, { status: 400 });
    }

    let creds;
    try {
      creds = await getLinetCreds(base44);
    } catch (e) {
      return Response.json({ valid: false, reason: "linet_error", error: e.message });
    }

    // קריאה אחת בלבד — חיפוש ישיר לפי idcode
    let rows;
    try {
      const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...creds,
          limit: 50,
          offset: 0,
          query: JSON.stringify({ idcode: String(serial).trim() }),
        }),
      });
      if (!res.ok) throw new Error(`Linet HTTP ${res.status}`);
      const parsed = await res.json();
      const raw = parsed?.data?.body ?? parsed?.body ?? null;
      rows = Array.isArray(raw) ? raw : [];
    } catch (e) {
      return Response.json({ valid: false, reason: "linet_error", error: e.message });
    }

    // סינון ידני — אל תסמוך על Linet לסנן לפי idcode
    const serialNorm = String(serial).trim().toLowerCase();
    const matchingRows = rows.filter(
      (r) => r.idcode != null && String(r.idcode).trim().toLowerCase() === serialNorm
    );

    if (matchingRows.length === 0) {
      return Response.json({ valid: false, reason: "not_found_in_stock" });
    }

    // בדיקת item_id — הגנה קריטית מפני סריאלי של פריט שגוי
    const targetItemId = Number(linet_item_id);
    const correctItemRow = matchingRows.find((r) => Number(r.item_id) === targetItemId);

    if (correctItemRow) {
      return Response.json({
        valid: true,
        reason: "found_in_stock",
        matched_item_id: targetItemId,
      });
    }

    // הסריאלי קיים אבל שייך לפריט אחר — חסימה קריטית
    const otherRow = matchingRows[0];
    return Response.json({
      valid: false,
      reason: "belongs_to_other_item",
      found_item_id: Number(otherRow.item_id) || null,
      found_item_name: otherRow.item_name ?? null,
    });

  } catch (err) {
    console.error("verifySerial fatal:", err);
    return Response.json({ valid: false, reason: "linet_error", error: err.message });
  }
});