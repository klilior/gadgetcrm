import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * PURE READ-ONLY DIAGNOSTIC PROBE — admin only.
 * Does NOT create invoices, write to Linet, or modify any entity.
 * Returns raw Linet API responses verbatim so field names can be inspected.
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

function safeJson(text, label) {
  try {
    return { parsed: JSON.parse(text), raw: text };
  } catch (e) {
    return { parsed: null, raw: text, parse_error: String(e) };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sku = "663973249", warehouse_id } = await req.json();
    const creds = await getLinetCreds(base44);
    const BASE_URL = "https://app.linet.org.il/api";
    const result = {};

    // ============================================
    // CALL 1 — Item details (POST /newsearch/item)
    // ============================================
    try {
      const itemPayload = {
        ...creds,
        query: JSON.stringify({ sku }),
        limit: 50,
        offset: 0,
      };
      const itemRes = await fetch(`${BASE_URL}/newsearch/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemPayload),
      });
      const itemText = await itemRes.text();
      const itemJson = safeJson(itemText, "item");
      const body = itemJson.parsed?.body;

      result.item = {
        http_status: itemRes.status,
        raw_item_full: itemJson.parsed || itemText,
      };

      if (Array.isArray(body) && body.length > 0) {
        result.item.raw_item_body0 = body[0];
        result.item.item_field_names = Object.keys(body[0]);
      } else {
        result.item.raw_item_body0 = body;
        result.item.item_field_names = typeof body === "object" && body !== null ? Object.keys(body) : null;
      }
    } catch (e) {
      result.item = { http_status: -1, error: String(e) };
    }

    // ============================================
    // CALL 2 — Available serials (POST /mutex/item/search)
    // ============================================
    try {
      const mutexPayload = { ...creds, sku };
      if (warehouse_id) mutexPayload.warehouse_id = warehouse_id;
      const mutexRes = await fetch(`${BASE_URL}/mutex/item/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutexPayload),
      });
      const mutexText = await mutexRes.text();
      const mutexJson = safeJson(mutexText, "mutex");
      const body = mutexJson.parsed?.body;

      result.mutex = {
        http_status: mutexRes.status,
        raw_mutex_full: mutexJson.parsed || mutexText,
      };

      // Linet sometimes returns string instead of array when empty — guard before accessing
      const firstElement = Array.isArray(body) ? body[0] : body;
      result.mutex.mutex_field_names =
        typeof firstElement === "object" && firstElement !== null
          ? Object.keys(firstElement)
          : (() => {
              console.log("mutex body is not an object:", JSON.stringify(firstElement));
              return null;
            })();
    } catch (e) {
      result.mutex = { http_status: -1, error: String(e) };
    }

    // ============================================
    // LOG everything to server logs in same structure
    // ============================================
    console.log("=== debugLinetSerial PROBE ===");
    console.log("Input:", JSON.stringify({ sku, warehouse_id }));
    console.log("Result:", JSON.stringify(result, null, 2));

    return Response.json(result);
  } catch (error) {
    console.error("debugLinetSerial fatal:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});