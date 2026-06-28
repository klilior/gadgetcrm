import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * PURE READ-ONLY DIAGNOSTIC — no auth guard (diagnostic tool).
 * Investigates current stock snapshot vs movement history for serial items.
 */

Deno.serve(async (req) => {
  const log = {};

  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const linet_item_id = body.linet_item_id ?? 53;
    const linet_sku = body.linet_sku ?? "190198231642";

    // ── Resolve creds ────────────────────────────────────────────────
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

    const mask = (v) => v ? `${"*".repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}` : "EMPTY ⚠️";
    log["0_CREDS"] = {
      login_id: mask(login_id),
      login_hash: mask(login_hash),
      login_company: login_company ?? "EMPTY ⚠️",
    };

    if (!login_id || !login_hash || !login_company) {
      log["FATAL"] = "Missing Linet credentials";
      return Response.json({ log }, { status: 200 });
    }

    const creds = {
      login_id: String(login_id),
      login_hash: String(login_hash),
      login_company: Number(login_company),
    };

    const BASE_URL = "https://app.linet.org.il/api";

    const newsearch = async (model, query, limit = 10) => {
      const payload = { ...creds, limit, offset: 0, query: JSON.stringify(query) };
      const res = await fetch(`${BASE_URL}/newsearch/${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      const body = Array.isArray(json?.data?.body) ? json.data.body :
                   Array.isArray(json?.body) ? json.body : null;
      return { status: res.status, raw_text: text.substring(0, 1000), json, body };
    };

    // ── אפשרות א': נסה models של מלאי נוכחי ───────────────────────
    const snapshotModels = ["stock", "currentstock", "balance", "stockbalance", "itembalance", "warehousestock", "stockitem"];
    const modelResults = {};
    for (const model of snapshotModels) {
      try {
        const r = await newsearch(model, { item_id: Number(linet_item_id) }, 5);
        modelResults[model] = {
          http_status: r.status,
          body_type: r.body === null ? "null" : `Array[${r.body.length}]`,
          sample: r.body?.[0] ?? null,
          raw_preview: r.raw_text.substring(0, 300),
        };
      } catch (e) {
        modelResults[model] = { error: e.message };
      }
    }
    log["A_SNAPSHOT_MODELS"] = modelResults;

    // ── אפשרות ב': inventory מלא — ניתוח שדות לזיהוי זמין vs יצא ──
    const invFull = await newsearch("inventory", { item_id: Number(linet_item_id) }, 500);
    log["B1_INVENTORY_STATUS"] = {
      http_status: invFull.status,
      total_rows: Array.isArray(invFull.body) ? invFull.body.length : 0,
      all_field_names: invFull.body?.[0] ? Object.keys(invFull.body[0]) : [],
    };

    if (Array.isArray(invFull.body) && invFull.body.length > 0) {
      // מצא idcode שמופיע יותר מפעם אחת (קנייה + מכירה)
      const byIdcode = {};
      for (const r of invFull.body) {
        if (!r.idcode) continue;
        if (!byIdcode[r.idcode]) byIdcode[r.idcode] = [];
        byIdcode[r.idcode].push(r);
      }
      // מצא idcode עם 2+ שורות
      const multiRows = Object.entries(byIdcode).find(([, rows]) => rows.length >= 2);
      // מצא idcode עם שורה אחת
      const singleRow = Object.entries(byIdcode).find(([, rows]) => rows.length === 1);

      log["B2_FIELD_COMPARISON"] = {
        note: "אם idcode מופיע פעם אחת — כנראה עדיין במלאי. אם פעמיים — נכנס ויצא.",
        idcode_with_multiple_rows: multiRows ? {
          idcode: multiRows[0],
          row_count: multiRows[1].length,
          rows: multiRows[1], // כל השורות המלאות לניתוח
        } : "לא נמצא idcode עם יותר משורה אחת",
        idcode_with_single_row: singleRow ? {
          idcode: singleRow[0],
          row_count: 1,
          row: singleRow[1][0], // שורה מלאה
        } : "לא נמצא",
        // הדפס ערכים ייחודיים של שדות מפתח
        unique_ammount_values: [...new Set(invFull.body.map(r => r.ammount))].slice(0, 20),
        unique_account_id_values: [...new Set(invFull.body.map(r => r.account_id))].slice(0, 20),
        rows_where_ammount_negative: invFull.body.filter(r => parseFloat(r.ammount || 0) < 0).slice(0, 3),
        rows_where_ammount_positive: invFull.body.filter(r => parseFloat(r.ammount || 0) > 0).slice(0, 3),
        // כל idcode + ammount לתמונה מלאה
        idcode_ammount_map: Object.entries(byIdcode).map(([code, rows]) => ({
          idcode: code,
          rows_count: rows.length,
          ammounts: rows.map(r => r.ammount),
          net: rows.reduce((s, r) => s + parseFloat(r.ammount || 0), 0),
          account_ids: [...new Set(rows.map(r => r.account_id))],
        })).slice(0, 30),
      };
    }

    // ── נסה לשלוף רשימת models זמינים ────────────────────────────
    // Linet לא חושף endpoint של models list, אבל נסה newsearch ריק
    const extraModels = ["item", "document", "account", "warehouse", "category"];
    const modelFieldNames = {};
    for (const model of extraModels) {
      try {
        const r = await newsearch(model, {}, 1);
        modelFieldNames[model] = {
          http_status: r.status,
          fields: r.body?.[0] ? Object.keys(r.body[0]) : [],
        };
      } catch (e) {
        modelFieldNames[model] = { error: e.message };
      }
    }
    log["C_MODEL_FIELDS"] = modelFieldNames;

  } catch (outerErr) {
    log["EXCEPTION"] = {
      name: outerErr.name,
      message: outerErr.message,
      stack: outerErr.stack ?? null,
    };
  }

  return Response.json({ log }, { status: 200 });
});