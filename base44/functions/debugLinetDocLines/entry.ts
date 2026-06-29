import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * debugLinetDocLines — קריאה בלבד
 * מחפש שורות משלוח ושורות פריט רגיל בתוך docDetailes של חשבוניות doctype=9.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const login_id = Deno.env.get("LINET_LOGIN_ID");
    const login_hash = Deno.env.get("LINET_LOGIN_HASH");
    const login_company = Number(Deno.env.get("LINET_LOGIN_COMPANY"));
    const auth = { login_id, login_hash, login_company };

    async function linet(endpoint, body) {
      const res = await fetch(`https://app.linet.org.il/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch (_) { data = { _raw: text.slice(0,400) }; }
      return { http_status: res.status, data };
    }

    // ── שלב 1: שלוף רשימת מסמכים doctype=9 בגישה פשוטה ──────────────────
    // מנסה מגוון query structs שיצלחו
    const probes = [
      { doctype: 9 },
      { doctype: "9" },
    ];
    let docs = [];
    let listDebug = [];

    for (const q of probes) {
      const r = await linet("newsearch/docs", { ...auth, limit: 20, offset: 0, query: q });
      listDebug.push({ query: q, http_status: r.http_status, status: r.data?.status, body_type: typeof r.data?.body, body_len: Array.isArray(r.data?.body) ? r.data.body.length : null, sample: JSON.stringify(r.data).slice(0,200) });
      if (r.http_status === 200 && Array.isArray(r.data?.body) && r.data.body.length > 0) {
        docs = r.data.body;
        break;
      }
      if (r.http_status === 200 && Array.isArray(r.data) && r.data.length > 0) {
        docs = r.data;
        break;
      }
    }

    // ── שלב 2: אם רשימה ריקה — נסה newsearch/document (סינגולרי) ──────────
    if (docs.length === 0) {
      for (const q of [{ doctype: 9 }, { doctype: "9" }]) {
        const r = await linet("newsearch/document", { ...auth, limit: 20, offset: 0, query: q });
        listDebug.push({ endpoint: "document", query: q, http_status: r.http_status, body_type: typeof r.data?.body, body_len: Array.isArray(r.data?.body) ? r.data.body.length : null, sample: JSON.stringify(r.data).slice(0,200) });
        if (r.http_status === 200 && Array.isArray(r.data?.body) && r.data.body.length > 0) {
          docs = r.data.body;
          break;
        }
        if (r.http_status === 200 && Array.isArray(r.data) && r.data.length > 0) {
          docs = r.data;
          break;
        }
      }
    }

    // ── שלב 3: אם עדיין ריק — נסה ללא query (רשימה כללית) ────────────────
    if (docs.length === 0) {
      const r = await linet("newsearch/docs", { ...auth, limit: 20, offset: 0 });
      listDebug.push({ endpoint: "docs_no_query", http_status: r.http_status, body_type: typeof r.data?.body, body_len: Array.isArray(r.data?.body) ? r.data.body.length : null, sample: JSON.stringify(r.data).slice(0,300) });
      if (r.http_status === 200 && Array.isArray(r.data?.body)) docs = r.data.body;
      else if (r.http_status === 200 && Array.isArray(r.data)) docs = r.data;
    }

    // ── שלב 4: עבור על המסמכים, שלוף כל אחד בנפרד לפי id ────────────────
    const shippingLines: any[] = [];
    const regularLines: any[] = [];
    const serialLines: any[] = [];
    const docsScanned: any[] = [];

    for (const docStub of docs.slice(0, 20)) {
      const docId = docStub.id ?? docStub.doc_id ?? docStub._id;
      const docType = docStub.doctype ?? docStub.doc_type;
      // סנן רק doctype=9
      if (docType && Number(docType) !== 9) continue;
      if (!docId) continue;

      // שלוף מסמך מלא לפי id
      const dr = await linet("newsearch/docs", { ...auth, limit: 1, offset: 0, query: { id: docId } });
      let fullDoc = null;
      if (Array.isArray(dr.data?.body) && dr.data.body.length > 0) fullDoc = dr.data.body[0];
      else if (Array.isArray(dr.data) && dr.data.length > 0) fullDoc = dr.data[0];

      // fallback: נסה newsearch/document
      if (!fullDoc) {
        const dr2 = await linet("newsearch/document", { ...auth, limit: 1, offset: 0, query: { id: docId } });
        if (Array.isArray(dr2.data?.body) && dr2.data.body.length > 0) fullDoc = dr2.data.body[0];
        else if (Array.isArray(dr2.data) && dr2.data.length > 0) fullDoc = dr2.data[0];
      }

      if (!fullDoc) continue;

      const lines = fullDoc.docDetailes ?? fullDoc.docDetails ?? fullDoc.details ?? fullDoc.lines ?? [];
      docsScanned.push({
        doc_id: docId,
        doc_number: fullDoc.docnum ?? fullDoc.doc_number ?? fullDoc.refnum,
        doc_type: fullDoc.doctype ?? fullDoc.doc_type,
        lines_count: lines.length,
        top_keys: Object.keys(fullDoc).slice(0, 20),
      });

      for (const line of lines) {
        const name = String(line.name ?? line.description ?? line.item_name ?? "").toLowerCase();
        const isShipping = name.includes("משלוח") || name.includes("שילוח") || name.includes("delivery") || name.includes("shipping") || name.includes("הובלה") || name.includes("דמי");

        const serialVal = line.serial ?? line.idcode ?? line.serials ?? null;
        const hasSerial = serialVal && (
          (typeof serialVal === "string" && serialVal.trim() !== "") ||
          (Array.isArray(serialVal) && serialVal.length > 0)
        );

        if (isShipping && shippingLines.length < 4) {
          shippingLines.push({ _doc_id: docId, _doc_number: fullDoc.docnum, ...line });
        } else if (hasSerial && serialLines.length < 3) {
          serialLines.push({ _doc_id: docId, _doc_number: fullDoc.docnum, ...line });
        } else if (!hasSerial && !isShipping && regularLines.length < 4) {
          regularLines.push({ _doc_id: docId, _doc_number: fullDoc.docnum, ...line });
        }
      }

      if (shippingLines.length >= 4 && regularLines.length >= 4) break;
    }

    const result = {
      docs_total_found: docs.length,
      docs_scanned_count: docsScanned.length,
      docs_scanned: docsScanned,
      shipping_lines_found: shippingLines.length,
      regular_lines_found: regularLines.length,
      serial_lines_found: serialLines.length,
      shipping_lines: shippingLines,
      regular_lines: regularLines,
      serial_lines_sample: serialLines,
      list_debug: listDebug,
    };

    // שמור ב-Settings
    const existing = await base44.asServiceRole.entities.Settings.filter({ setting_name: "debug_doc_lines" }).catch(() => []);
    if (existing.length > 0) {
      await base44.asServiceRole.entities.Settings.update(existing[0].id, { setting_value: JSON.stringify(result) });
    } else {
      await base44.asServiceRole.entities.Settings.create({ setting_name: "debug_doc_lines", setting_value: JSON.stringify(result) });
    }

    return Response.json(result);

  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack?.slice(0, 400) }, { status: 500 });
  }
});