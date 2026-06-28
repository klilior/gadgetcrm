import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Pure diagnostic: check a Linet item's serial inventory directly.
 * Returns the raw Linet response for investigation.
 */

async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
    login_id = login_id || getSetting("LINET_LOGIN_ID");
    login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
    login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) {
    throw new Error("Missing Linet credentials");
  }
  return { login_id, login_hash, login_company: Number(login_company) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { linet_item_id, linet_sku, warehouse_id } = await req.json();

    const creds = await getLinetCreds(base44);
    const BASE_URL = "https://app.linet.org.il/api";

    // 1. Get item master
    let itemResult = [];
    if (linet_sku) {
      const params = new URLSearchParams({ ...creds, limit: "1" });
      const itemRes = await fetch(`${BASE_URL}/newsearch/item?${params}&query=${encodeURIComponent(JSON.stringify({ sku: linet_sku }))}`);
      const itemText = await itemRes.text();
      let itemJson;
      try { itemJson = JSON.parse(itemText); } catch (_) { itemJson = null; }
      itemResult = itemJson?.data?.body || itemJson?.body || [];
    }

    // 2. Get inventory (serials)
    const invQuery = { item_id: Number(linet_item_id) };
    const invRes = await fetch(`${BASE_URL}/newsearch/inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...creds, limit: 500, offset: 0, query: invQuery }),
    });
    const invText = await invRes.text();
    let invJson = null;
    try { invJson = JSON.parse(invText); } catch (_) {}
    const invBody = Array.isArray(invJson?.data?.body) ? invJson.data.body : (Array.isArray(invJson?.body) ? invJson.body : []);

    // 3. Net availability
    const byCode = {};
    for (const r of invBody) {
      if (!r.idcode) continue;
      if (warehouse_id !== null && warehouse_id !== undefined && String(r.account_id) !== String(warehouse_id)) continue;
      if (!byCode[r.idcode]) byCode[r.idcode] = { idcode: r.idcode, net: 0, warehouse_id: r.account_id };
      byCode[r.idcode].net += parseFloat(r.ammount || "0");
    }
    const netSerials = Object.values(byCode).filter((c) => c.net > 0);

    return Response.json({
      success: true,
      item_master: itemResult,
      inv_status_code: invRes.status,
      inv_row_count: invBody.length,
      sample_rows: invBody.slice(0, 10).map((r) => ({ idcode: r.idcode, ammount: r.ammount, account_id: r.account_id, item_sku: r.item_sku })),
      net_serials_count: netSerials.length,
      net_serials: netSerials,
      diagnostic: "compare inv_row_count vs net_serials_count - if inv has rows but net is 0, check en mussing and warehouse filtering",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});