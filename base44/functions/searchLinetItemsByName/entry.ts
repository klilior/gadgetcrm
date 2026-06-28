import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * searchLinetItemsByName — READ-ONLY
 * קלט: { name: string }
 * פלט: { matches: [{ linet_item_id, linet_item_name, linet_sku, stock_type }] } — עד 10 התאמות
 *
 * אסטרטגיה: newsearch/inventory מחזיר item_name/item_sku/item_id/item_stockType על כל שורה.
 * שולפים 500 שורות, מסננים בצד הקוד, ומחלצים items ייחודיים לפי item_id.
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
    const { name } = body;

    if (!name || !name.trim()) return Response.json({ matches: [] });

    let creds;
    try {
      creds = await getLinetCreds(base44);
    } catch (e) {
      return Response.json({ matches: [], error: e.message });
    }

    // שולפים inventory (יש שם item_name/item_sku על כל שורה)
    let rows;
    try {
      const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...creds,
          limit: 500,
          offset: 0,
          query: JSON.stringify({}),
        }),
      });
      if (!res.ok) throw new Error(`Linet HTTP ${res.status}`);
      const parsed = await res.json();
      const raw = parsed?.data?.body ?? parsed?.body ?? null;
      rows = Array.isArray(raw) ? raw : [];
    } catch (e) {
      return Response.json({ matches: [], error: e.message });
    }

    // סינון בצד הקוד — כל מילות החיפוש בשם הפריט
    const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const seenItemIds = new Set();
    const matches = [];

    for (const r of rows) {
      const itemName = (r.item_name ?? "").toLowerCase();
      if (!words.every((w) => itemName.includes(w))) continue;

      const itemId = Number(r.item_id);
      if (seenItemIds.has(itemId)) continue;
      seenItemIds.add(itemId);

      matches.push({
        linet_item_id: itemId,
        linet_item_name: r.item_name ?? null,
        linet_sku: r.item_sku ?? null,
        stock_type: r.item_stockType != null ? Number(r.item_stockType) : null,
      });

      if (matches.length >= 10) break;
    }

    return Response.json({ matches });

  } catch (err) {
    return Response.json({ matches: [], error: err.message });
  }
});