import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getAvailableSerials — גיבוי (.bak) של הגרסה שדפדפה מול Linet inventory.
 * שמור לצורך שחזור בלבד. לא בשימוש.
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
    const { linet_item_id } = body;

    if (linet_item_id == null || linet_item_id === "" || Number.isNaN(Number(linet_item_id))) {
      return Response.json({ serials: [], count: 0, warning: "חסר linet_item_id — לא ניתן לסנן סריאלים" });
    }

    let creds;
    try {
      creds = await getLinetCreds(base44);
    } catch (credErr) {
      return Response.json({ serials: [], count: 0, error: credErr.message });
    }

    const LIMIT = 500;
    const MAX_PAGES = 30;
    let body_rows = [];
    let pages_fetched = 0;
    try {
      for (let offset = 0; pages_fetched < MAX_PAGES; offset += LIMIT) {
        const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...creds, limit: LIMIT, offset, query: JSON.stringify({ item_id: Number(linet_item_id) }) }),
        });

        if (!res.ok) {
          return Response.json({ serials: [], count: 0, error: `Linet HTTP ${res.status}` });
        }

        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { return Response.json({ serials: [], count: 0, error: "Invalid JSON from Linet" }); }

        const raw = parsed?.data?.body ?? parsed?.body ?? null;
        pages_fetched++;

        if (!Array.isArray(raw) || raw.length === 0) break;

        body_rows = body_rows.concat(raw);

        if (raw.length < LIMIT) break;
      }
    } catch (fetchErr) {
      return Response.json({ serials: [], count: 0, error: fetchErr.message });
    }

    const targetId = Number(linet_item_id);
    const matched = body_rows.filter((row) => Number(row.item_id) === targetId);

    const serials = matched
      .filter((row) => row.idcode != null && row.idcode !== "")
      .map((row) => ({
        serial: row.idcode,
        created: row.created ?? row.create_date ?? null,
        raw_ammount: row.ammount ?? row.amount ?? null,
      }));

    return Response.json({ serials, count: serials.length });

  } catch (err) {
    console.error("getAvailableSerials fatal:", err);
    return Response.json({ serials: [], count: 0, error: err.message });
  }
});