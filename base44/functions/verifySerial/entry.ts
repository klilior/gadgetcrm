import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * verifySerial — READ-ONLY
 * קלט: { linet_item_id: number, serial: string }
 * פלט: { valid: bool, reason: string, ... }
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

async function searchInventory(creds, query, limit = 500) {
  const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, limit, offset: 0, query: JSON.stringify(query) }),
  });
  if (!res.ok) throw new Error(`Linet HTTP ${res.status}`);
  const parsed = await res.json();
  const raw = parsed?.data?.body ?? parsed?.body ?? null;
  return Array.isArray(raw) ? raw : [];
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

    // קריאה 1 — חיפוש הסריאלי עבור הפריט הספציפי
    let rows1;
    try {
      rows1 = await searchInventory(creds, { item_id: Number(linet_item_id) });
    } catch (e) {
      return Response.json({ valid: false, reason: "linet_error", error: e.message });
    }

    const serialLower = String(serial).trim().toLowerCase();
    const foundInItem = rows1.find((r) => r.idcode != null && String(r.idcode).toLowerCase() === serialLower);

    if (foundInItem) {
      return Response.json({
        valid: true,
        reason: "found_in_stock",
        matched_item_id: linet_item_id,
      });
    }

    // קריאה 2 — חיפוש הסריאלי בכל המלאי (בלי פילטר פריט)
    let rows2;
    try {
      rows2 = await searchInventory(creds, {}, 2000);
    } catch (e) {
      // אם הקריאה השנייה נכשלה — מחזיר not_found (לא קורס)
      return Response.json({ valid: false, reason: "not_found_in_stock" });
    }

    const foundElsewhere = rows2.find((r) => r.idcode != null && String(r.idcode).toLowerCase() === serialLower);

    if (foundElsewhere) {
      return Response.json({
        valid: false,
        reason: "belongs_to_other_item",
        found_item_id: foundElsewhere.item_id ?? foundElsewhere.item ?? null,
        found_item_name: foundElsewhere.item_name ?? foundElsewhere.itemname ?? null,
      });
    }

    return Response.json({ valid: false, reason: "not_found_in_stock" });

  } catch (err) {
    console.error("verifySerial fatal:", err);
    return Response.json({ valid: false, reason: "linet_error", error: err.message });
  }
});