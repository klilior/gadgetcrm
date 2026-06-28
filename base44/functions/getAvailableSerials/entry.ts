import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getAvailableSerials
 * שולף סריאליים זמינים ממלאי Linet לפריט נתון.
 * READ-ONLY בלבד. לא כותב לשום ישות.
 * קלט: { linet_item_id: number }
 * פלט: { serials: [{serial, created, raw_ammount}], count: number }
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

    const isAuth = await base44.auth.isAuthenticated();
    if (!isAuth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { linet_item_id } = body;

    if (!linet_item_id) {
      return Response.json({ error: "linet_item_id נדרש" }, { status: 400 });
    }

    let creds;
    try {
      creds = await getLinetCreds(base44);
    } catch (credErr) {
      return Response.json({ serials: [], count: 0, error: credErr.message });
    }

    const payload = {
      ...creds,
      limit: 500,
      offset: 0,
      query: JSON.stringify({ item_id: Number(linet_item_id) }),
    };

    let body_rows = [];
    try {
      const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return Response.json({ serials: [], count: 0, error: `Linet HTTP ${res.status}` });
      }

      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { return Response.json({ serials: [], count: 0, error: "Invalid JSON from Linet" }); }

      // גישה ל-body — תומך בשתי מבנים אפשריים
      const raw = parsed?.data?.body ?? parsed?.body ?? null;

      if (!Array.isArray(raw)) {
        // body הוא string או null — מחזיר ריק בלי לקרוס
        return Response.json({ serials: [], count: 0, note: "body is not array", body_type: typeof raw });
      }

      body_rows = raw;
    } catch (fetchErr) {
      return Response.json({ serials: [], count: 0, error: fetchErr.message });
    }

    // מסנן רק שורות עם idcode לא-null
    const serials = body_rows
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