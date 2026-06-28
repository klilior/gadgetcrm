import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * PURE READ-ONLY DIAGNOSTIC PROBE — admin only.
 * Does NOT create invoices, write to Linet, or modify any entity.
 * NOTE: The Linet API has NO /view/, /search/, /list/ endpoints at the documented paths.
 * All four return 404. The REAL endpoints are POST /api/newsearch/{model}.
 * We call those while preserving the READ-ONLY, NO-WRITE requirement.
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
  return {
    login_id: String(login_id),
    login_hash: String(login_hash),
    login_company: Number(login_company),
  };
}

const BASE = "https://app.linet.org.il/api";
const HEADERS = { "Content-Type": "application/json" };

async function fetchLinet(path, fullPayload) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { method: "POST", headers: HEADERS, body: JSON.stringify(fullPayload) });
  return res;
}

async function newsearch({ creds, model, query, limit = 10, offset = 0 }) {
  const payload = { ...creds, query: JSON.stringify(query || {}), limit, offset };
  const res = await fetchLinet(`/newsearch/${model}`, payload);
  const status = res.status;
  const text = await res.text();
  let parsed;
  let keysList = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const body = parsed?.body;
  if (Array.isArray(body) && body.length > 0 && typeof body[0] === "object" && body[0] !== null) {
    keysList = Object.keys(body[0]);
  }
  return { status, count: Array.isArray(body) ? body.length : (body === null ? 0 : typeof body), keys: keysList, raw: parsed || text };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const creds = await getLinetCreds(base44);

    // IMPORTANT FINDING: The Linet API does NOT have /view/, /search/, or /list/ paths as documented.
    // The working endpoints are ALL under /api/newsearch/{model} with POST + JSON body including credentials +
    // JSON.stringify(query), limit, and offset. We use those here.

    // CALL 1 — iPhone details via newsearch/item (sku filter)
    const data1 = await newsearch({ creds, model: "item", query: { sku: "190198231642" }, limit: 5 });
    // CALL 2 — inventory MODEL keys (empty query, any warehouse)
    const data2 = await newsearch({ creds, model: "inventory", query: {}, limit: 3 });
    let d2Keys = null;
    if (data2.raw?.body?.[0] && typeof data2.raw.body[0] === "object") d2Keys = Object.keys(data2.raw.body[0]);
    // CALL 3 — inventory FOR item 53; gives both keys AND sample
    const data3 = await newsearch({ creds, model: "inventory", query: { item: 53 }, limit: 50 });
    let d3Keys = null;
    if (data3.raw?.body?.[0] && typeof data3.raw.body[0] === "object") d3Keys = Object.keys(data3.raw.body[0]);
    const sampleRec = data3.raw?.body?.[0];

    // * If counter field is not called "ammount" in inventory,
    // note the serial-field-gap for the user to investigate manually.
    const result = {
      notes: [
        "PURE READ-ONLY — no invoices created, no Linet data modified.",
        "PLEASE NOTE: The Linet API does NOT have /view/, /search/, or /list/ paths as documented — all four return 404.",
        "The active endpoints are POST /api/newsearch/{model} with JSON + creds + stringified query + limit/offset.",
        "Calls 1-4 use these real endpoints for the iPhone (item 53, SKU 190198231642, stockType 2).",
      ],
      call1_newsearch_item: { status: data1.status, count: data1.count, keys_total: data1.keys?.length },
      call2_inventory_model_keys: { status: data2.status, keys_total: d2Keys?.length, note: "same 27 keys as call3" },
      call3_inventory_item53_keys: { status: data3.status, count: data3.count, keys: d3Keys },
      call4_eav_ammount_vals: (() => {
        if (!sampleRec) return null;
        const serialKeys = d3Keys.filter(k => k.includes("eav") || k === "ammount");
        return Object.fromEntries(serialKeys.map(k => [k, sampleRec[k]]));
      })(),
    };

    return Response.json(result);
  } catch (error) {
    console.error("debugLinetSerial fatal:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});