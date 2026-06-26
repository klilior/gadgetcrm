import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = "https://app.linet.org.il/api";

/**
 * TEMPORARY ADMIN-ONLY DEBUG FUNCTION (Step 1).
 *
 * Purpose: Print the RAW Linet API response for a serial-tracked item (e.g. iPhone SKU 663973249)
 * so we can discover the EXACT field names BEFORE building any serial-handling logic.
 *
 * It probes two routes:
 *   1. POST /newsearch/item            -> item master data (inventory type field, category, item id)
 *   2. POST /mutex/item/search         -> available serials per item/warehouse
 *
 * This function does NOT change any order, invoice, shipment, SMS, WooCommerce, Super-Pharm
 * or Linet flow. It only reads and logs.
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
    throw new Error("Missing Linet credentials (LINET_LOGIN_ID / LINET_LOGIN_HASH / LINET_LOGIN_COMPANY).");
  }
  return { login_id, login_hash, login_company: Number(login_company) };
}

// Recursively collect every key name present in an object, to help map field names.
function collectKeys(obj, prefix = "", out = new Set(), depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return out;
  for (const k of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    const v = obj[k];
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object") collectKeys(v[0], `${path}[0]`, out, depth + 1);
    } else if (v && typeof v === "object") {
      collectKeys(v, path, out, depth + 1);
    }
  }
  return out;
}

async function callLinet(path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keep raw text */ }
  return { ok: res.ok, status: res.status, json, raw: text };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin-only guard
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const isAdmin = user.role === "admin" || user.app_role === "מנהל" || user?.data?.app_role === "מנהל";
    if (!isAdmin) return Response.json({ success: false, error: "Forbidden - admin only" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const sku = String(body.sku || "663973249"); // default: iPhone serial SKU example
    const warehouse_id = body.warehouse_id !== undefined ? body.warehouse_id : null;

    const creds = await getLinetCreds(base44);
    const report = { sku, warehouse_id, routes: {} };

    // ---------- Route 1: /newsearch/item ----------
    console.log("========== [DEBUG] Route 1: POST /newsearch/item ==========");
    try {
      const itemPayload = { ...creds, limit: 5, offset: 0, query: { sku } };
      const r1 = await callLinet("/newsearch/item", itemPayload);
      console.log(`[newsearch/item] HTTP ${r1.status} ok=${r1.ok}`);
      console.log("[newsearch/item] FULL RESPONSE:", JSON.stringify(r1.json ?? r1.raw, null, 2).substring(0, 6000));

      const firstItem = r1.json?.data?.body?.[0] ?? r1.json?.body?.[0] ?? null;
      console.log("[newsearch/item] data.body[0]:", JSON.stringify(firstItem, null, 2));
      console.log("[newsearch/item] ALL KEYS in body[0]:", JSON.stringify([...collectKeys(firstItem)], null, 2));

      report.routes.newsearch_item = {
        http_status: r1.status,
        first_item: firstItem,
        first_item_keys: firstItem ? [...collectKeys(firstItem)] : [],
      };
    } catch (e) {
      console.error("[newsearch/item] ERROR:", e.message);
      report.routes.newsearch_item = { error: e.message };
    }

    // ---------- Route 2: /mutex/item/search ----------
    console.log("========== [DEBUG] Route 2: POST /mutex/item/search ==========");
    try {
      // We don't know the exact param names yet, so send the most likely combination and log everything.
      const mutexPayload = { ...creds, limit: 50, offset: 0, query: { sku, ...(warehouse_id !== null ? { warehouse_id } : {}) } };
      const r2 = await callLinet("/mutex/item/search", mutexPayload);
      console.log(`[mutex/item/search] HTTP ${r2.status} ok=${r2.ok}`);
      console.log("[mutex/item/search] FULL RESPONSE:", JSON.stringify(r2.json ?? r2.raw, null, 2).substring(0, 6000));

      const firstRow = r2.json?.data?.body?.[0] ?? r2.json?.body?.[0] ?? null;
      console.log("[mutex/item/search] data.body[0]:", JSON.stringify(firstRow, null, 2));
      console.log("[mutex/item/search] ALL KEYS in body[0]:", JSON.stringify([...collectKeys(firstRow)], null, 2));

      report.routes.mutex_item_search = {
        http_status: r2.status,
        first_row: firstRow,
        first_row_keys: firstRow ? [...collectKeys(firstRow)] : [],
      };
    } catch (e) {
      console.error("[mutex/item/search] ERROR:", e.message);
      report.routes.mutex_item_search = { error: e.message };
    }

    return Response.json({ success: true, report });
  } catch (error) {
    console.error("[debugLinetSerialItem] ERROR:", error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});