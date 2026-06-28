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

    // CALL 1 — iPhone item details via newsearch/item with sku filter
    const data1 = await newsearch({ creds, model: "item", query: { sku: "190198231642" }, limit: 5 });
    // CALL 2 — ALL 27 keys of inventory model (no duplicate call2)
    const data3 = await newsearch({ creds, model: "inventory", query: {}, limit: 3 });
    let data3AllKeys = null;
    if (data3.raw?.body?.[0] && typeof data3.raw.body[0] === "object") data3AllKeys = Object.keys(data3.raw.body[0]);
    // CALL 3 — inventory for item 53, detailed (use this to render full keys in JSON)
    const data4 = await newsearch({ creds, model: "inventory", query: { item: 53 }, limit: 50 });
    let data4AllKeys = null;
    if (data4.raw?.body?.[0] && typeof data4.raw.body[0] === "object") data4AllKeys = Object.keys(data4.raw.body[0]);
    // CALL 4 — first raw sample of inventory for item 53 (show one record fully)
    const sampleRec = data4.raw?.body?.[0];

    // * If counter field is not called "ammount" in inventory,
    // note the serial-field-gap for the user to investigate manually.
    const serialFieldHint = "ammount" !== "serial" ? "⚠ ammount is the quantity; no 'serial' key found in inventory model keys (call3). Serial might exist in a different model (e.g. /newsearch/mutexrequest, /newsearch/transport)." : "";

    const result = {
      notes: [
        "PURE READ-ONLY — no invoices created, no Linet data modified.",
        "PLEASE NOTE: The Linet API does NOT have /view/, /search/, or /list/ paths as documented — all four return 404.",
        "The active endpoints are POST /api/newsearch/{model} with JSON + creds + stringified query + limit/offset.",
        "Calls 1-4 use these real endpoints for the iPhone (item 53, SKU 190198231642, stockType 2).",
      ],
      call1_newsearch_item_brief: { status: data1.status, count: data1.count, keys19: data1.keys?.slice(0, 19), keys_total: data1.keys?.length },
      call2_inventory_model_27_keys: { status: data3.status, keys: data3AllKeys },
      call3_inventory_item53_keys_27: { status: data4.status, count: data4.count, keys: data4AllKeys },
      call4_serial_values_item53: (() => {
        if (!sampleRec) return null;
        // Show serial-related fields only
        const serialKeys = data4AllKeys.filter(k => k.includes("serial") || k.includes("imei") || k.includes("eav") || k === "ammount" || k === "acccell_id" || k === "acccell_name" || k === "item_id" || k === "item_sku" || k === "idcode" || k === "instance_id");
        return Object.fromEntries(serialKeys.map(k => [k, sampleRec[k]]));
      })(),
    };

    return Response.json(result);
  } catch (error) {
    console.error("debugLinetSerial fatal:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});