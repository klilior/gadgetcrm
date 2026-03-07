import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const BASE_URL = "https://app.linet.org.il/api";

async function getLinetCredentials(base44) {
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

  return { login_id, login_hash, login_company: Number(login_company) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const docNumber = body.doc_number;

    if (!docNumber) {
      return Response.json({ error: 'doc_number is required' }, { status: 400 });
    }

    const credentials = await getLinetCredentials(base44);

    // Search by date of the invoice and filter by docnum
    const payload = {
      ...credentials,
      limit: 200,
      offset: 0,
      query: {
        doctype: ["9", "3", "4"],
        issue_date: "2026-03-01 to 2026-03-07",
      },
    };

    console.log('🔍 Fetching recent docs to find docnum:', docNumber);

    const response = await fetch(`${BASE_URL}/newsearch/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({ error: `Linet API Error ${response.status}: ${errorText}` }, { status: 500 });
    }

    const apiResponse = await response.json();
    const documents = apiResponse.body || [];

    if (documents.length === 0) {
      // Strategy 2: Try recent docs and filter by docnum
      console.log('🔍 Strategy 1 failed, trying date range search...');
      const payload2 = {
        ...credentials,
        limit: 200,
        offset: 0,
        query: {
          doctype: ["9", "3", "4"],
          issue_date: "2025-01-01 to 2026-03-07",
        },
      };
      const response2 = await fetch(`${BASE_URL}/newsearch/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });
      const apiResponse2 = await response2.json();
      const allDocs = apiResponse2.body || [];
      console.log(`Found ${allDocs.length} docs, searching for docnum ${docNumber}...`);
      
      const matched = allDocs.find(d => String(d.docnum) === String(docNumber) || String(d.id) === String(docNumber));
      if (!matched) {
        // Return a sample doc so we can see fields
        const sample = allDocs.length > 0 ? allDocs[0] : null;
        return Response.json({ 
          error: `Document ${docNumber} not found in ${allDocs.length} docs`, 
          sample_docnums: allDocs.slice(0, 10).map(d => ({ id: d.id, docnum: d.docnum, company: d.company_name })),
          sample_doc_fields: sample ? Object.keys(sample) : [],
          sample_line_fields: sample?.docDetailes?.[0] ? Object.keys(sample.docDetailes[0]) : []
        });
      }
      documents.push(matched);
    }

    // Return the FULL raw document with all fields
    const doc = documents[0];
    
    // Extract line item fields for easy viewing
    const lineItemFields = {};
    if (Array.isArray(doc.docDetailes) && doc.docDetailes.length > 0) {
      lineItemFields.all_fields_in_first_line = Object.keys(doc.docDetailes[0]);
      lineItemFields.line_items = doc.docDetailes.map((line, idx) => ({
        index: idx,
        ...line
      }));
    }

    // Extract top-level fields
    const topLevelFields = Object.keys(doc).filter(k => k !== 'docDetailes');

    return Response.json({
      success: true,
      top_level_fields: topLevelFields,
      document_header: Object.fromEntries(topLevelFields.map(k => [k, doc[k]])),
      line_item_analysis: lineItemFields,
      raw_full_document: doc
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});