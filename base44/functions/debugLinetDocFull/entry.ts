import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * debugLinetDocFull — READ-ONLY
 * שולף מסמך קיים ומדפיס את כל השדות ברמת המסמך וברמת שורת docDetailes
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const getCreds = async () => {
      const id = Deno.env.get("LINET_LOGIN_ID");
      const hash = Deno.env.get("LINET_LOGIN_HASH");
      const company = Deno.env.get("LINET_LOGIN_COMPANY");
      if (id && hash && company) return { login_id: id, login_hash: hash, login_company: Number(company) };
      throw new Error("Linet credentials not found in env");
    };

    const creds = await getCreds();

    // קריאה ל-newsearch/docs — המבנה שעובד: query wrapper + response.body
    const postDocs = async (query, limit = 10) => {
      const payload = { ...creds, limit, offset: 0, query };
      const res = await fetch("https://app.linet.org.il/api/newsearch/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { json = { _raw: text.slice(0, 300) }; }
      // response מגיע ב-.body
      const rows = Array.isArray(json?.body) ? json.body : (Array.isArray(json) ? json : []);
      return { http_status: res.status, raw_keys: json ? Object.keys(json) : [], rows };
    };

    const report = {};

    // ─── שלב 1: שלוף doctype=9 מהשבועות האחרונים ─────────────────────
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 90); // 90 ימים אחורה
    const fmt = (d) => d.toISOString().slice(0, 10);
    const dateRange = `${fmt(from)} to ${fmt(today)}`;

    const r9 = await postDocs({ issue_date: dateRange, doctype: ["9"] }, 20);
    report.step1_doctype9 = { http_status: r9.http_status, row_count: r9.rows.length, raw_response_keys: r9.raw_keys };

    let targetDoc = null;

    // העדף מסמך עם docDetailes
    for (const doc of r9.rows) {
      if (Array.isArray(doc.docDetailes) && doc.docDetailes.length > 0) {
        targetDoc = doc;
        report.step1_selected_from = "doctype9_with_docDetailes";
        break;
      }
    }
    if (!targetDoc && r9.rows.length > 0) {
      targetDoc = r9.rows[0];
      report.step1_selected_from = "doctype9_first";
    }

    // ─── שלב 2: fallback — כל doctype אם 9 ריק ────────────────────────
    if (!targetDoc) {
      const rAll = await postDocs({ issue_date: dateRange }, 20);
      report.step2_all_docs = { http_status: rAll.http_status, row_count: rAll.rows.length };
      for (const doc of rAll.rows) {
        if (Array.isArray(doc.docDetailes) && doc.docDetailes.length > 0) {
          targetDoc = doc;
          report.step2_selected_from = `any_doc_with_lines_doctype_${doc.doctype}`;
          break;
        }
      }
      if (!targetDoc && rAll.rows.length > 0) { targetDoc = rAll.rows[0]; report.step2_selected_from = "any_first"; }
    }

    // ─── שלב 3: fallback — חפש לפי refnum של הזמנה ידועה ────────────
    if (!targetDoc) {
      const rRef = await postDocs({ refnum: "188514" }, 5);
      report.step3_refnum_probe = { http_status: rRef.http_status, row_count: rRef.rows.length };
      if (rRef.rows.length > 0) { targetDoc = rRef.rows[0]; report.step3_selected_from = "refnum_188514"; }
    }

    if (!targetDoc) {
      report.conclusion = "לא נמצא מסמך — ייתכן שאין מסמכי doctype=9 ב-90 הימים האחרונים";
      return Response.json(report);
    }

    // ─── ניתוח המסמך ───────────────────────────────────────────────────
    report.doc_top_level_keys = Object.keys(targetDoc);
    report.doc_doctype = targetDoc.doctype;

    // כל שדות המסמך עם ערכים
    report.doc_full = targetDoc;

    // שדות ספציפיים שמעניינים
    const docFields = [
      "id", "docnum", "doctype", "issue_date", "due_date", "ref_date",
      "account_id", "owner", "signer", "action",
      "sub_total", "vat", "total", "currency_id", "currency_rate",
      "vat_cat_id", "src_tax", "disType", "discount", "refnum", "refnum_ext",
      "description", "comments", "company", "company_name", "language",
      "warehouse_id", "refstatus",
    ];
    report.doc_fields_found = {};
    report.doc_fields_missing = [];
    for (const f of docFields) {
      if (f in targetDoc) {
        report.doc_fields_found[f] = { value: targetDoc[f], type: typeof targetDoc[f] };
      } else {
        report.doc_fields_missing.push(f);
      }
    }

    // ─── ניתוח שורות פריט ──────────────────────────────────────────────
    const lines = Array.isArray(targetDoc.docDetailes) ? targetDoc.docDetailes : [];
    report.docDetailes_count = lines.length;

    if (lines.length > 0) {
      const line = lines[0];
      report.docDetailes_first_line_all_keys = Object.keys(line);
      report.docDetailes_first_line_full = line;

      const lineFields = [
        "item_id", "sku", "name", "qty",
        "iItem", "iItemWithVat", "iTotal", "iTotalVat",
        "discount", "discountPer", "discountType",
        "vat_cat_id", "warehouse_id", "currency_id", "currency_rate",
        "unit_id", "serial", "idcode", "price",
      ];
      report.docDetailes_first_line_fields_found = {};
      report.docDetailes_first_line_fields_missing = [];
      for (const f of lineFields) {
        if (f in line) {
          report.docDetailes_first_line_fields_found[f] = { value: line[f], type: typeof line[f] };
        } else {
          report.docDetailes_first_line_fields_missing.push(f);
        }
      }
    }

    // ─── סיכום TODO ────────────────────────────────────────────────────
    report.todo_resolution = {
      doctype: targetDoc.doctype ?? "MISSING",
      account_id: targetDoc.account_id ?? "MISSING",
      owner: targetDoc.owner ?? "MISSING",
      sub_total_sample: targetDoc.sub_total ?? "MISSING",
      vat_sample: targetDoc.vat ?? "MISSING",
      total_sample: targetDoc.total ?? "MISSING",
      warehouse_id_doc_level: targetDoc.warehouse_id ?? "MISSING",
      warehouse_id_line_level: lines[0]?.warehouse_id ?? "MISSING",
      iItem_sample: lines[0]?.iItem ?? "MISSING",
      iItemWithVat_sample: lines[0]?.iItemWithVat ?? "MISSING",
      iTotal_sample: lines[0]?.iTotal ?? "MISSING",
      iTotalVat_sample: lines[0]?.iTotalVat ?? "MISSING",
    };

    report.conclusion = "הצלחה";

    // שמור תוצאה ב-Settings כדי לאפשר אחזור מלא
    try {
      const savePayload = JSON.stringify({
        todo_resolution: report.todo_resolution,
        doc_fields_found: report.doc_fields_found,
        doc_fields_missing: report.doc_fields_missing,
        docDetailes_first_line_fields_found: report.docDetailes_first_line_fields_found,
        docDetailes_first_line_fields_missing: report.docDetailes_first_line_fields_missing,
        doc_top_level_keys: report.doc_top_level_keys,
        docDetailes_first_line_all_keys: report.docDetailes_first_line_all_keys,
        doc_full: report.doc_full,
        docDetailes_first_line_full: report.docDetailes_first_line_full,
      });
      const existing = await base44.asServiceRole.entities.Settings.filter({ setting_name: "debug_doc_full_result" }).catch(() => []);
      if (existing[0]) {
        await base44.asServiceRole.entities.Settings.update(existing[0].id, { setting_value: savePayload });
      } else {
        await base44.asServiceRole.entities.Settings.create({ setting_name: "debug_doc_full_result", setting_value: savePayload });
      }
    } catch (_) {}

    return Response.json(report);

  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack?.slice(0, 500) }, { status: 500 });
  }
});