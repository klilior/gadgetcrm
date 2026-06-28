import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * debugLinetPaymentAccount — READ-ONLY
 * חלק א: docCheques ממסמך 40452
 * חלק ב: מבנה account (שדות, חיפוש טלפון)
 * חלק ג: ערכי type/cat_id/currency_id מ-account אמיתי
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const id = Deno.env.get("LINET_LOGIN_ID");
    const hash = Deno.env.get("LINET_LOGIN_HASH");
    const company = Deno.env.get("LINET_LOGIN_COMPANY");
    if (!id || !hash || !company) return Response.json({ error: "missing creds" }, { status: 500 });
    const creds = { login_id: id, login_hash: hash, login_company: Number(company) };

    const post = async (model, query = {}, limit = 5) => {
      const res = await fetch(`https://app.linet.org.il/api/newsearch/${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creds, limit, offset: 0, query }),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { json = { _raw: text.slice(0, 400) }; }
      const rows = Array.isArray(json?.body) ? json.body : (Array.isArray(json) ? json : []);
      return { http_status: res.status, row_count: rows.length, rows, raw_keys: json ? Object.keys(json) : [] };
    };

    const report = {};

    // ════════════════════════════════════════════════════════════════
    // חלק א — docCheques ממסמך 40452
    // ════════════════════════════════════════════════════════════════
    const r40452 = await post("docs", { id: "28141" }, 1); // doc id=28141 הוא docnum=40452
    const doc = r40452.rows[0] ?? null;
    report.partA_http = r40452.http_status;
    report.partA_doc_found = !!doc;

    if (doc) {
      // כל המפתחות ברמת doc שהם מערכים (פרט ל-docDetailes)
      report.partA_array_fields = {};
      for (const [k, v] of Object.entries(doc)) {
        if (Array.isArray(v) && k !== "docDetailes") {
          report.partA_array_fields[k] = {
            length: v.length,
            first_item: v[0] ?? null,
            first_item_keys: v[0] ? Object.keys(v[0]) : [],
          };
        }
      }
      // ספציפית docCheques
      const cheques = doc.docCheques ?? doc.docChecks ?? doc.cheques ?? doc.payments ?? null;
      report.partA_docCheques_raw = doc.docCheques ?? "FIELD_NOT_FOUND";
      report.partA_docChecks_raw = doc.docChecks ?? "FIELD_NOT_FOUND";
      report.partA_cheques_sample = cheques;
      // מפתחות של שורת תשלום ראשונה
      if (Array.isArray(cheques) && cheques.length > 0) {
        report.partA_first_cheque_keys = Object.keys(cheques[0]);
        report.partA_first_cheque_full = cheques[0];
      }
    }

    // ════════════════════════════════════════════════════════════════
    // חלק ב — מבנה account
    // ════════════════════════════════════════════════════════════════

    // ב-1: שלוף 3 accounts — ראה אילו שדות קיימים
    const rAccounts = await post("account", {}, 3);
    report.partB_accounts_http = rAccounts.http_status;
    report.partB_accounts_row_count = rAccounts.row_count;

    if (rAccounts.rows.length > 0) {
      const acc = rAccounts.rows[0];
      report.partB_account_all_keys = Object.keys(acc);
      report.partB_account_sample = acc;

      // מצא שדות טלפון אפשריים
      const phoneKeys = Object.keys(acc).filter(k =>
        k.toLowerCase().includes("phone") ||
        k.toLowerCase().includes("cellular") ||
        k.toLowerCase().includes("dir_phone") ||
        k.toLowerCase().includes("mobile") ||
        k.toLowerCase().includes("tel")
      );
      report.partB_phone_candidate_keys = phoneKeys;
      report.partB_phone_candidate_values = phoneKeys.reduce((o, k) => { o[k] = acc[k]; return o; }, {});
    }

    // ב-2: חפש לקוח לפי טלפון מהזמנה 188514
    // שלוף הזמנה מ-WooCommerce DB
    let realPhone = null;
    try {
      const orders = await base44.asServiceRole.entities.Order.filter({ external_order_number: "188514" }).catch(() => []);
      if (orders[0]?.raw_data_billing) {
        const billing = JSON.parse(orders[0].raw_data_billing);
        realPhone = billing.phone ?? billing.billing?.phone ?? null;
      }
      // גם מנסים דרך client
      if (!realPhone && orders[0]?.client_id) {
        const clients = await base44.asServiceRole.entities.Client.filter({ id: orders[0].client_id }).catch(() => []);
        realPhone = clients[0]?.phone ?? clients[0]?.phone_original ?? null;
      }
    } catch (_) {}
    report.partB_real_phone = realPhone;

    if (realPhone) {
      // נרמל טלפון — הסר 0 בתחילה, הוסף 972
      const normalized = realPhone.replace(/\D/g, "").replace(/^0/, "972");
      const raw = realPhone.replace(/\D/g, "");
      report.partB_normalized_phone = normalized;

      // חפש לפי כל שדות הטלפון שמצאנו
      const phoneFields = report.partB_phone_candidate_keys ?? ["phone", "cellular", "dir_phone"];
      for (const pf of phoneFields) {
        const r1 = await post("account", { [pf]: raw }, 3);
        const r2 = normalized !== raw ? await post("account", { [pf]: normalized }, 3) : { http_status: 200, row_count: 0, rows: [] };
        report[`partB_search_${pf}_raw`] = {
          http_status: r1.http_status,
          row_count: r1.row_count,
          ids: r1.rows.map(r => r.id ?? r.account_id),
          first_account: r1.rows[0] ?? null,
        };
        if (normalized !== raw) {
          report[`partB_search_${pf}_normalized`] = {
            http_status: r2.http_status,
            row_count: r2.row_count,
            ids: r2.rows.map(r => r.id ?? r.account_id),
          };
        }
      }
    } else {
      report.partB_phone_search = "לא נמצא טלפון להזמנה 188514 — בדוק raw_data_billing";
    }

    // ════════════════════════════════════════════════════════════════
    // חלק ג — type, cat_id, currency_id מ-account אמיתי
    // ════════════════════════════════════════════════════════════════
    if (rAccounts.rows.length > 0) {
      const accFields = ["type", "cat_id", "category", "currency_id", "currency", "name", "vatnum", "active", "balance"];
      report.partC_account_fields = {};
      report.partC_account_missing = [];
      for (const acc of rAccounts.rows.slice(0, 3)) {
        const key = `account_${acc.id ?? acc.account_id ?? rAccounts.rows.indexOf(acc)}`;
        report.partC_account_fields[key] = {};
        for (const f of accFields) {
          if (f in acc) {
            report.partC_account_fields[key][f] = { value: acc[f], type: typeof acc[f] };
          }
        }
      }
    }

    // שמור ב-Settings
    try {
      const savePayload = JSON.stringify(report);
      const existing = await base44.asServiceRole.entities.Settings.filter({ setting_name: "debug_payment_account" }).catch(() => []);
      if (existing[0]) {
        await base44.asServiceRole.entities.Settings.update(existing[0].id, { setting_value: savePayload });
      } else {
        await base44.asServiceRole.entities.Settings.create({ setting_name: "debug_payment_account", setting_value: savePayload });
      }
    } catch (_) {}

    return Response.json(report);

  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack?.slice(0, 600) }, { status: 500 });
  }
});