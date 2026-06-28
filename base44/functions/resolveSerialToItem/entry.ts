import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * resolveSerialToItem — READ-ONLY
 * קלט: { serial: string }
 * פלט: { found: true, linet_item_id, linet_item_name, linet_sku, serial }
 *    | { found: true, ambiguous: true, candidates: [...] }
 *    | { found: false, reason: "serial_not_in_stock" }
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
    const { serial } = body;

    if (!serial) return Response.json({ found: false, reason: "missing_params" }, { status: 400 });

    let creds;
    try {
      creds = await getLinetCreds(base44);
    } catch (e) {
      return Response.json({ found: false, reason: "linet_error", error: e.message });
    }

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
      return Response.json({ found: false, reason: "linet_error", error: e.message });
    }

    // סינון ידני — בדיוק idcode התואם
    const serialNorm = String(serial).trim().toLowerCase();
    const matching = rows.filter(
      (r) => r.idcode != null && String(r.idcode).trim().toLowerCase() === serialNorm
    );

    if (matching.length === 0) {
      return Response.json({ found: false, reason: "serial_not_in_stock" });
    }

    // בדיקת אמביגואיות — כמה item_id שונים?
    const itemIds = [...new Set(matching.map((r) => Number(r.item_id)))];

    if (itemIds.length > 1) {
      const candidates = itemIds.map((id) => {
        const row = matching.find((r) => Number(r.item_id) === id);
        return {
          linet_item_id: id,
          linet_item_name: row?.item_name ?? null,
          linet_sku: row?.item_sku ?? null,
          stock_type: row?.item_stockType != null ? Number(row.item_stockType) : null,
        };
      });
      return Response.json({ found: true, ambiguous: true, candidates, serial });
    }

    // מקרה רגיל — item_id אחד ברור
    const row = matching[0];
    return Response.json({
      found: true,
      linet_item_id: Number(row.item_id),
      linet_item_name: row.item_name ?? null,
      linet_sku: row.item_sku ?? null,
      stock_type: row.item_stockType != null ? Number(row.item_stockType) : null,
      serial,
    });

  } catch (err) {
    return Response.json({ found: false, reason: "linet_error", error: err.message });
  }
});