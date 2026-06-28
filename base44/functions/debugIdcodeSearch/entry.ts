import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * debugIdcodeSearch — READ-ONLY diagnostic
 * בודק אם Linet תומך בחיפוש ישיר לפי idcode ב-newsearch/inventory
 * קלט: { serial: string, item_id: number }
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

async function probe(creds, query) {
  const payload = { ...creds, limit: 10, offset: 0, query: JSON.stringify(query) };
  let httpStatus, rowCount, firstIdcode, isArray, rawSample;
  try {
    const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    httpStatus = res.status;
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const body = parsed?.data?.body ?? parsed?.body ?? null;
    isArray = Array.isArray(body);
    rowCount = isArray ? body.length : null;
    firstIdcode = isArray && body.length > 0 ? (body[0]?.idcode ?? null) : null;
    rawSample = isArray && body.length > 0 ? body[0] : (parsed ?? text?.slice(0, 200));
  } catch (e) {
    httpStatus = null;
    isArray = false;
    rowCount = null;
    firstIdcode = null;
    rawSample = { fetch_error: e.message };
  }
  return { query_sent: query, http_status: httpStatus, is_array: isArray, row_count: rowCount, first_idcode: firstIdcode, raw_sample: rawSample };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const serial = body.serial ?? "190199098572";
    const item_id = Number(body.item_id ?? 53);

    const creds = await getLinetCreds(base44);

    const [r1, r2, r3] = await Promise.all([
      probe(creds, { idcode: serial }),
      probe(creds, { idcode: serial, item_id }),
      probe(creds, { serial }),
    ]);

    return Response.json({
      tested_serial: serial,
      tested_item_id: item_id,
      probe_1_idcode_only: r1,
      probe_2_idcode_and_item: r2,
      probe_3_serial_field: r3,
      conclusion: (() => {
        const hits = [];
        if (r1.row_count === 1 && String(r1.first_idcode) === String(serial)) hits.push("probe_1 → direct match ✓");
        if (r2.row_count === 1 && String(r2.first_idcode) === String(serial)) hits.push("probe_2 → direct match ✓");
        if (r3.row_count === 1 && String(r3.first_idcode) === String(serial)) hits.push("probe_3 → direct match ✓");
        if (hits.length > 0) return `חיפוש ישיר עובד! ${hits.join(", ")}`;
        const nulls = [r1, r2, r3].filter(r => r.row_count === 0 || r.row_count === null);
        if (nulls.length === 3) return "כל הקריאות חזרו ריקות — Linet לא תומך בחיפוש ישיר לפי idcode";
        return `תוצאות חלקיות: probe1=${r1.row_count} rows, probe2=${r2.row_count} rows, probe3=${r3.row_count} rows — יש לבדוק first_idcode`;
      })(),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});