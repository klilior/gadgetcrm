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
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const targetDocNum = body.doc_number || '39708';

    const credentials = await getLinetCredentials(base44);
    
    // Search by doc ID directly using the docs endpoint
    const payload = {
      ...credentials,
      limit: 50,
      offset: 0,
      query: {
        issue_date: "2026-03-06 to 2026-03-06",
        doctype: ["9"],
        refstatus: null,
      },
    };

    console.log(`🔍 Fetching docs to find docnum: ${targetDocNum}`);

    const response = await fetch(`${BASE_URL}/newsearch/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const apiResponse = await response.json();
    const allDocs = apiResponse.body || [];
    
    // Find target doc
    const targetDoc = allDocs.find(d => String(d.docnum) === String(targetDocNum));
    
    if (!targetDoc) {
      return Response.json({
        error: `Document ${targetDocNum} not found in ${allDocs.length} docs`,
        sample_docnums: allDocs.slice(0, 20).map(d => ({ id: d.id, docnum: d.docnum, date: d.issue_date })),
      });
    }

    // Return full doc with all line details
    const lineDetails = (targetDoc.docDetailes || []).map(line => ({
      sku: line.sku,
      name: line.name,
      serial: line.serial,
      qty: line.qty,
      price: line.iItemWithVat || line.price,
      total: line.iTotalVat,
      all_fields: line,
    }));

    return Response.json({
      success: true,
      doc_id: targetDoc.id,
      docnum: targetDoc.docnum,
      doctype: targetDoc.doctype,
      issue_date: targetDoc.issue_date,
      customer: targetDoc.company || targetDoc.company_name,
      phone: targetDoc.phone,
      mobile: targetDoc.mobile,
      email: targetDoc.email,
      account_id: targetDoc.account_id,
      city: targetDoc.city,
      address: targetDoc.address,
      total: targetDoc.total,
      line_items: lineDetails,
      line_count: lineDetails.length,
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});