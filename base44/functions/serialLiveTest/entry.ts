import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * PURE READ-ONLY DIAGNOSTIC — admin only.
 * Tests the exact same Linet serial fetch path used in debugLinetSerialItem,
 * but with full verbose logging for production environment diagnosis.
 * Does NOT create invoices, write to Linet, or modify any entity.
 */

Deno.serve(async (req) => {
  const log = {};

  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const linet_item_id = body.linet_item_id ?? 53;
    const linet_sku = body.linet_sku ?? "190198231642";

    // ── 1. ENVIRONMENT ──────────────────────────────────────────────
    log["1_ENVIRONMENT"] = {
      deno_version: Deno.version,
      hostname: (() => { try { return Deno.hostname?.() ?? "N/A"; } catch { return "N/A"; } })(),
      env_keys_present: ["LINET_LOGIN_ID", "LINET_LOGIN_HASH", "LINET_LOGIN_COMPANY"].map(k => ({
        key: k,
        present: !!Deno.env.get(k),
        length: Deno.env.get(k)?.length ?? 0,
      })),
      note: "If env_keys_present shows present=false, secrets are missing in production.",
    };

    // ── 2. AUTH CHECK — resolve creds same way as debugLinetSerialItem ──
    let login_id = Deno.env.get("LINET_LOGIN_ID");
    let login_hash = Deno.env.get("LINET_LOGIN_HASH");
    let login_company = Deno.env.get("LINET_LOGIN_COMPANY");

    const credSource = {
      login_id: login_id ? "env" : null,
      login_hash: login_hash ? "env" : null,
      login_company: login_company ? "env" : null,
    };

    if (!login_id || !login_hash || !login_company) {
      const settingsList = await base44.asServiceRole.entities.Settings.list();
      const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
      if (!login_id) { login_id = getSetting("LINET_LOGIN_ID"); credSource.login_id = login_id ? "db_settings" : null; }
      if (!login_hash) { login_hash = getSetting("LINET_LOGIN_HASH"); credSource.login_hash = login_hash ? "db_settings" : null; }
      if (!login_company) { login_company = getSetting("LINET_LOGIN_COMPANY"); credSource.login_company = login_company ? "db_settings" : null; }
    }

    const mask = (v) => v ? `${"*".repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}` : "EMPTY";

    log["2_AUTH_CHECK"] = {
      login_id: mask(login_id),
      login_id_source: credSource.login_id ?? "NOT FOUND",
      login_id_empty: !login_id,
      login_hash: mask(login_hash),
      login_hash_source: credSource.login_hash ?? "NOT FOUND",
      login_hash_empty: !login_hash,
      login_company: login_company ?? "EMPTY",
      login_company_source: credSource.login_company ?? "NOT FOUND",
      login_company_empty: !login_company,
    };

    if (!login_id || !login_hash || !login_company) {
      log["FATAL"] = "Missing Linet credentials — cannot proceed.";
      return Response.json({ log }, { status: 200 });
    }

    const creds = {
      login_id: String(login_id),
      login_hash: String(login_hash),
      login_company: Number(login_company),
    };

    // ── 3. ENDPOINT ─────────────────────────────────────────────────
    const BASE_URL = "https://app.linet.org.il/api";
    const invEndpoint = `${BASE_URL}/newsearch/inventory`;
    const invQuery = { item_id: Number(linet_item_id) };
    const invPayload = { ...creds, limit: 500, offset: 0, query: invQuery };

    log["3_ENDPOINT"] = {
      url: invEndpoint,
      method: "POST",
      query_sent: invQuery,
      limit: 500,
      offset: 0,
      note: "Identical to debugLinetSerialItem step 2",
    };

    // ── 4 & 5. HTTP_STATUS + RAW_BODY ───────────────────────────────
    let invRes;
    let invText = "";
    let invJson = null;
    let fetchError = null;

    try {
      invRes = await fetch(invEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invPayload),
      });
      invText = await invRes.text();
    } catch (netErr) {
      fetchError = {
        name: netErr.name,
        message: netErr.message,
        stack: netErr.stack ?? null,
      };
    }

    log["4_HTTP_STATUS"] = invRes ? invRes.status : "NO_RESPONSE (fetch threw exception)";

    if (fetchError) {
      log["7_EXCEPTION"] = fetchError;
    }

    // Parse
    try { invJson = JSON.parse(invText); } catch (_) { invJson = null; }

    // Resolve body — same dual-path as debugLinetSerialItem
    const invBody =
      Array.isArray(invJson?.data?.body) ? invJson.data.body :
      Array.isArray(invJson?.body) ? invJson.body :
      null;

    log["5_RAW_BODY"] = {
      raw_text_length: invText.length,
      raw_text_preview: invText.substring(0, 800),
      parse_success: invJson !== null,
      top_level_keys: invJson && typeof invJson === "object" ? Object.keys(invJson) : null,
      body_path_data_body: Array.isArray(invJson?.data?.body) ? `Array[${invJson.data.body.length}]` : typeof invJson?.data?.body,
      body_path_body: Array.isArray(invJson?.body) ? `Array[${invJson.body.length}]` : typeof invJson?.body,
      resolved_body_type: invBody === null ? "NULL (neither invJson.data.body nor invJson.body is array)" : `Array[${invBody.length}]`,
      sample_row_0: invBody?.[0] ?? null,
    };

    // ── 6. SERIALS_FOUND ────────────────────────────────────────────
    let netSerials = [];
    let serialCalcError = null;

    if (Array.isArray(invBody)) {
      try {
        const byCode = {};
        for (const r of invBody) {
          if (!r.idcode) continue;
          if (!byCode[r.idcode]) byCode[r.idcode] = { idcode: r.idcode, net: 0, account_id: r.account_id };
          byCode[r.idcode].net += parseFloat(r.ammount || "0");
        }
        netSerials = Object.values(byCode).filter((c) => c.net > 0);
      } catch (calcErr) {
        serialCalcError = calcErr.message;
      }
    }

    log["6_SERIALS_FOUND"] = {
      inv_row_count: Array.isArray(invBody) ? invBody.length : 0,
      rows_with_idcode: Array.isArray(invBody) ? invBody.filter(r => !!r.idcode).length : 0,
      rows_with_positive_ammount: Array.isArray(invBody) ? invBody.filter(r => parseFloat(r.ammount || "0") > 0).length : 0,
      net_serials_count: netSerials.length,
      net_serials_sample: netSerials.slice(0, 5),
      calc_error: serialCalcError ?? null,
    };

    // ── Also run the item lookup (same as step 1 in debugLinetSerialItem) ──
    let itemResult = [];
    let itemError = null;
    try {
      const itemEndpoint = `${BASE_URL}/newsearch/item`;
      const itemPayload = { ...creds, limit: 1, offset: 0, query: { sku: String(linet_sku) } };
      const itemRes = await fetch(itemEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemPayload),
      });
      const itemText = await itemRes.text();
      let itemJson = null;
      try { itemJson = JSON.parse(itemText); } catch (_) {}
      itemResult = itemJson?.data?.body ?? itemJson?.body ?? [];
    } catch (e) {
      itemError = e.message;
    }

    log["0_ITEM_LOOKUP"] = {
      sku_queried: linet_sku,
      item_master_count: Array.isArray(itemResult) ? itemResult.length : 0,
      item_master_sample: Array.isArray(itemResult) ? itemResult[0] ?? null : itemResult,
      item_lookup_error: itemError ?? null,
    };

  } catch (outerErr) {
    log["7_EXCEPTION"] = {
      name: outerErr.name,
      message: outerErr.message,
      stack: outerErr.stack ?? null,
    };
  }

  return Response.json({ log }, { status: 200 });
});