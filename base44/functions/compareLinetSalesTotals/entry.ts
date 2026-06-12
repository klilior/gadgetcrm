import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = 'https://app.linet.org.il/api';

function parseNum(value) {
  if (value === null || value === undefined) return 0;
  const parsed = parseFloat(String(value).replace(/,/g, ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getCredentials(base44) {
  let login_id = Deno.env.get('LINET_LOGIN_ID');
  let login_hash = Deno.env.get('LINET_LOGIN_HASH');
  let login_company = Deno.env.get('LINET_LOGIN_COMPANY');

  if (!login_id || !login_hash || !login_company) {
    const settings = await base44.asServiceRole.entities.Settings.list(null, 1000);
    const getSetting = (name) => settings.find((s) => s.setting_name === name)?.setting_value;
    login_id = login_id || getSetting('LINET_LOGIN_ID');
    login_hash = login_hash || getSetting('LINET_LOGIN_HASH');
    login_company = login_company || getSetting('LINET_LOGIN_COMPANY');
  }

  if (!login_id || !login_hash || !login_company) throw new Error('Missing Linet credentials');
  return { login_id, login_hash, login_company: Number(login_company) };
}

async function fetchLinetDocuments(credentials, fromDate, toDate) {
  const allDocs = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(`${BASE_URL}/newsearch/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credentials,
        limit,
        offset,
        query: {
          issue_date: `${fromDate} to ${toDate}`,
          doctype: ['9', '3', '4'],
          refstatus: null,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linet API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data.errorCode && data.errorCode !== 0 && data.errorCode !== 1000) {
      throw new Error(`Linet error ${data.errorCode}: ${data.text || 'Unknown error'}`);
    }

    const docs = data.body || [];
    allDocs.push(...docs);
    if (docs.length < limit) break;
    offset += limit;
  }

  return allDocs;
}

async function fetchLocalSales(base44, fromDate, toDate) {
  const allRecords = [];
  let skip = 0;
  const limit = 1000;

  while (true) {
    const batch = await base44.asServiceRole.entities.SalesTransaction.filter(
      { issue_date: { $gte: fromDate, $lte: toDate } },
      'issue_date',
      limit,
      skip,
    );
    allRecords.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return allRecords;
}

function summarizeLinetDocs(docs) {
  let totalIncVat = 0;
  let positiveIncVat = 0;
  let negativeIncVat = 0;
  const docSummaries = [];

  for (const doc of docs) {
    const doctype = Number(doc.doctype);
    const isCredit = doctype === 4;
    let docTotal = 0;
    const lines = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];

    for (const line of lines) {
      let amount = parseNum(line.iTotalVat);
      if (isCredit) amount = Math.abs(amount) * -1;
      docTotal += amount;
    }

    totalIncVat += docTotal;
    if (docTotal >= 0) positiveIncVat += docTotal;
    else negativeIncVat += docTotal;

    docSummaries.push({
      linet_doc_id: String(doc.id),
      doc_number: String(doc.docnum),
      doctype,
      issue_date: doc.issue_date ? String(doc.issue_date).split(' ')[0] : null,
      owner: doc.owner ? String(doc.owner) : '',
      customer_name: doc.company_name || doc.account_name || doc.company || '',
      rows: lines.length,
      total_inc_vat: Math.round(docTotal * 100) / 100,
    });
  }

  return {
    total_inc_vat: Math.round(totalIncVat * 100) / 100,
    positive_inc_vat: Math.round(positiveIncVat * 100) / 100,
    negative_inc_vat: Math.round(negativeIncVat * 100) / 100,
    docs: docSummaries,
  };
}

function summarizeLocalSales(records) {
  const byDoc = {};
  let totalIncVat = 0;
  let positiveIncVat = 0;
  let negativeIncVat = 0;

  for (const rec of records) {
    const amount = rec.total_row_amount || 0;
    totalIncVat += amount;
    if (amount >= 0) positiveIncVat += amount;
    else negativeIncVat += amount;

    const key = String(rec.linet_doc_id || rec.doc_number || rec.id);
    if (!byDoc[key]) {
      byDoc[key] = {
        linet_doc_id: String(rec.linet_doc_id || ''),
        doc_number: String(rec.doc_number || ''),
        rows: 0,
        total_inc_vat: 0,
      };
    }
    byDoc[key].rows++;
    byDoc[key].total_inc_vat += amount;
  }

  return {
    total_inc_vat: Math.round(totalIncVat * 100) / 100,
    positive_inc_vat: Math.round(positiveIncVat * 100) / 100,
    negative_inc_vat: Math.round(negativeIncVat * 100) / 100,
    docs: Object.values(byDoc).map((doc) => ({ ...doc, total_inc_vat: Math.round(doc.total_inc_vat * 100) / 100 })),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const fromDate = body.from_date;
    const toDate = body.to_date;
    if (!fromDate || !toDate) return Response.json({ error: 'from_date and to_date required' }, { status: 400 });

    const credentials = await getCredentials(base44);
    const [linetDocs, localRecords] = await Promise.all([
      fetchLinetDocuments(credentials, fromDate, toDate),
      fetchLocalSales(base44, fromDate, toDate),
    ]);

    const linet = summarizeLinetDocs(linetDocs);
    const local = summarizeLocalSales(localRecords);
    const localById = new Map(local.docs.map((doc) => [doc.linet_doc_id, doc]));
    const linetById = new Map(linet.docs.map((doc) => [doc.linet_doc_id, doc]));

    const missingInLocal = linet.docs.filter((doc) => !localById.has(doc.linet_doc_id));
    const extraInLocal = local.docs.filter((doc) => !linetById.has(doc.linet_doc_id));
    const amountMismatches = linet.docs
      .map((doc) => {
        const localDoc = localById.get(doc.linet_doc_id);
        if (!localDoc) return null;
        const diff = Math.round((doc.total_inc_vat - localDoc.total_inc_vat) * 100) / 100;
        if (Math.abs(diff) < 0.01) return null;
        return { ...doc, local_total_inc_vat: localDoc.total_inc_vat, diff };
      })
      .filter(Boolean);

    return Response.json({
      period: { from: fromDate, to: toDate },
      linet: {
        documents: linet.docs.length,
        total_inc_vat: linet.total_inc_vat,
        positive_inc_vat: linet.positive_inc_vat,
        negative_inc_vat: linet.negative_inc_vat,
      },
      local: {
        documents: local.docs.length,
        rows: localRecords.length,
        total_inc_vat: local.total_inc_vat,
        positive_inc_vat: local.positive_inc_vat,
        negative_inc_vat: local.negative_inc_vat,
      },
      difference_linet_minus_local: Math.round((linet.total_inc_vat - local.total_inc_vat) * 100) / 100,
      missing_in_local: {
        count: missingInLocal.length,
        total_inc_vat: Math.round(missingInLocal.reduce((sum, doc) => sum + doc.total_inc_vat, 0) * 100) / 100,
        sample: missingInLocal.slice(0, 30),
      },
      extra_in_local: {
        count: extraInLocal.length,
        total_inc_vat: Math.round(extraInLocal.reduce((sum, doc) => sum + doc.total_inc_vat, 0) * 100) / 100,
        sample: extraInLocal.slice(0, 30),
      },
      amount_mismatches: {
        count: amountMismatches.length,
        total_diff: Math.round(amountMismatches.reduce((sum, doc) => sum + doc.diff, 0) * 100) / 100,
        sample: amountMismatches.slice(0, 30),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});