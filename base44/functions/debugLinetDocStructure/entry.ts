import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * debugLinetDocStructure — READ-ONLY, no writes to Linet or entities
 * מטרה: לגלות את מבנה מסמך/חשבונית קיים ב-Linet + מיקום ה-idcode בשורות
 */

async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (n) => settingsList.find((s) => s.setting_name === n)?.setting_value;
    if (!login_id) login_id = getSetting("LINET_LOGIN_ID");
    if (!login_hash) login_hash = getSetting("LINET_LOGIN_HASH");
    if (!login_company) login_company = getSetting("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");
  return { login_id: String(login_id), login_hash: String(login_hash), login_company: Number(login_company) };
}

async function linetPost(endpoint, creds, query = {}, limit = 20, offset = 0) {
  const res = await fetch(`https://app.linet.org.il/api/newsearch/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, limit, offset, query: JSON.stringify(query) }),
  });
  const http_status = res.status;
  let body = null;
  try { body = await res.json(); } catch (_) {}
  const raw = body?.data?.body ?? body?.body ?? null;
  return { http_status, rows: Array.isArray(raw) ? raw : [], raw_body_keys: body ? Object.keys(body) : [] };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { doc_id } = body; // optional: fetch a specific doc

    let creds;
    try { creds = await getLinetCreds(base44); } catch (e) {
      return Response.json({ error: e.message });
    }

    const result = {};

    // ── STEP 1: probe both model names ──────────────────────────────────────
    const [docsProbe, documentProbe] = await Promise.all([
      linetPost("docs", creds, {}, 20),
      linetPost("document", creds, {}, 20),
    ]);

    result.step1_model_probe = {
      docs: { http_status: docsProbe.http_status, row_count: docsProbe.rows.length, raw_body_keys: docsProbe.raw_body_keys },
      document: { http_status: documentProbe.http_status, row_count: documentProbe.rows.length, raw_body_keys: documentProbe.raw_body_keys },
    };

    // pick working model
    const workingModel = docsProbe.rows.length > 0 ? "docs" : documentProbe.rows.length > 0 ? "document" : null;
    const workingRows = docsProbe.rows.length > 0 ? docsProbe.rows : documentProbe.rows;

    result.step1_working_model = workingModel;

    if (!workingModel) {
      result.note = "Neither docs nor document returned rows. Cannot continue.";
      return Response.json(result);
    }

    // ── STEP 2: top-level doc structure ─────────────────────────────────────
    const firstDoc = workingRows[0];
    result.step2_doc_top_level_keys = Object.keys(firstDoc);
    result.step2_doc_sample = firstDoc; // full first doc

    // look for array fields (potential line-item containers)
    const arrayFields = Object.entries(firstDoc)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => ({ field: k, length: v.length, first_item_keys: v.length > 0 ? Object.keys(v[0]) : [] }));
    result.step2_array_fields_in_doc = arrayFields;

    // ── STEP 3: find a doc that contains a serial item (stockType=2 or known item_id) ──
    // SERIAL_ITEM_IDS known from previous tests: 273 (AirPods), 53 (iPhone)
    const SERIAL_IDS = new Set([273, 53]);
    let serialDoc = null;
    let serialLineKey = null;
    let serialLineData = null;

    for (const doc of workingRows) {
      // look in every array field for a row mentioning a known serial item
      for (const [fieldName, fieldVal] of Object.entries(doc)) {
        if (!Array.isArray(fieldVal)) continue;
        for (const lineItem of fieldVal) {
          const itemId = lineItem.item_id ?? lineItem.itemId ?? lineItem.item ?? null;
          const stockType = lineItem.item_stockType ?? lineItem.stockType ?? null;
          if (SERIAL_IDS.has(Number(itemId)) || Number(stockType) === 2) {
            serialDoc = doc;
            serialLineKey = fieldName;
            serialLineData = lineItem;
            break;
          }
        }
        if (serialDoc) break;
      }
      if (serialDoc) break;
    }

    result.step3_serial_doc_found = !!serialDoc;
    if (serialDoc) {
      result.step3_serial_doc_id = serialDoc.id ?? serialDoc.doc_id ?? null;
      result.step3_serial_line_field = serialLineKey;
      result.step3_serial_line_keys = serialLineData ? Object.keys(serialLineData) : [];
      result.step3_serial_line_full = serialLineData; // full line — look for idcode here
    }

    // ── STEP 4: fetch a specific doc by id if provided or first doc ──────────
    const targetDocId = doc_id ?? firstDoc.id ?? firstDoc.doc_id ?? null;
    if (targetDocId) {
      const singleProbe = await linetPost(workingModel, creds, { id: targetDocId }, 1);
      result.step4_single_doc_probe = {
        http_status: singleProbe.http_status,
        row_count: singleProbe.rows.length,
        full_doc: singleProbe.rows[0] ?? null,
      };

      // deep-search for anything that looks like a serial (long alphanumeric or 15-digit IMEI)
      const SERIAL_PATTERN = /^[A-Z0-9]{8,}$/i;
      const IMEI_PATTERN = /^\d{15}$/;
      const serialCandidates = [];
      function deepSearch(obj, path) {
        if (!obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj)) {
          const fullPath = path ? `${path}.${k}` : k;
          if (typeof v === "string" && (SERIAL_PATTERN.test(v) || IMEI_PATTERN.test(v))) {
            serialCandidates.push({ path: fullPath, value: v });
          } else if (typeof v === "object") {
            deepSearch(v, fullPath);
          }
        }
      }
      if (singleProbe.rows[0]) deepSearch(singleProbe.rows[0], "");
      result.step4_serial_candidates_in_doc = serialCandidates;
    }

    return Response.json(result);

  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack });
  }
});