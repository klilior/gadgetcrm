import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = 'https://app.linet.org.il/api';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnRateLimit(fn, retries = 8) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error?.message || String(error);
      if ((msg.includes('429') || msg.includes('Rate limit')) && i < retries - 1) {
        await delay(Math.min((i + 1) * 3000, 20000));
      } else {
        throw error;
      }
    }
  }
}

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
    const settings = await retryOnRateLimit(() => base44.asServiceRole.entities.Settings.list(null, 1000));
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

    if (!response.ok) throw new Error(`Linet API error ${response.status}: ${await response.text()}`);
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
    const batch = await retryOnRateLimit(() => base44.asServiceRole.entities.SalesTransaction.filter(
      { issue_date: { $gte: fromDate, $lte: toDate } },
      'issue_date',
      limit,
      skip,
    ));
    allRecords.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return allRecords;
}

function summarizeLinetDoc(doc) {
  const doctype = Number(doc.doctype);
  const isCredit = doctype === 4;
  const lines = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
  let total = 0;

  for (const line of lines) {
    let amount = parseNum(line.iTotalVat);
    if (isCredit) amount = Math.abs(amount) * -1;
    total += amount;
  }

  return Math.round(total * 100) / 100;
}

function groupLocalByDoc(records) {
  const byDoc = new Map();
  for (const record of records) {
    const key = String(record.linet_doc_id || '');
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key).push(record);
  }
  return byDoc;
}

function sumLocal(records) {
  return Math.round(records.reduce((sum, row) => sum + (row.total_row_amount || 0), 0) * 100) / 100;
}

async function loadMaps(base44) {
  const [usersList, employeesList, productMaps] = await Promise.all([
    retryOnRateLimit(() => base44.asServiceRole.entities.LinetUsersMap.list(null, 1000)),
    retryOnRateLimit(() => base44.asServiceRole.entities.Employee.list(null, 1000)),
    retryOnRateLimit(() => base44.asServiceRole.entities.LinetProductMap.list(null, 1000)),
  ]);

  const usersMap = {};
  usersList.forEach((u) => { usersMap[String(u.user_id)] = u.user_name; });

  const employeeByCode = {};
  const employeeNameByCode = {};
  employeesList.forEach((emp) => {
    const code = String(emp.linet_employee_code || '').trim();
    if (!code) return;
    employeeByCode[code] = emp.id;
    employeeNameByCode[code] = emp.employee_name;
  });

  const categoryBySku = {};
  productMaps.forEach((item) => {
    if (item.sku) categoryBySku[item.sku] = item.linet_category_name || 'Uncategorized';
  });

  return { usersMap, employeeByCode, employeeNameByCode, categoryBySku };
}

function buildRowsFromDoc(doc, maps, oldRows) {
  const rawDoctype = Number(doc.doctype);
  const isCredit = rawDoctype === 4;
  const linetDocId = String(doc.id);
  const ownerCode = String(doc.owner || '').trim();
  const oldCategoryBySku = {};
  oldRows.forEach((row) => {
    if (row.sku && row.category) oldCategoryBySku[row.sku] = row.category;
  });

  return (Array.isArray(doc.docDetailes) ? doc.docDetailes : []).map((line, lineIndex) => {
    const sku = line.sku || '';
    let quantity = parseNum(line.qty);
    let totalRowAmount = parseNum(line.iTotalVat);
    let priceExVat = parseNum(line.iTotal);
    let unitPrice = line.price ? parseNum(line.price) : quantity !== 0 ? totalRowAmount / quantity : 0;

    if (isCredit) {
      quantity = Math.abs(quantity) * -1;
      totalRowAmount = Math.abs(totalRowAmount) * -1;
      priceExVat = Math.abs(priceExVat) * -1;
    }

    return {
      linet_doc_id: linetDocId,
      line_key: `${linetDocId}:${lineIndex}`,
      line_index: lineIndex,
      doc_number: String(doc.docnum),
      doc_type: isCredit ? 'חשבונית זיכוי' : 'חשבונית מס קבלה',
      issue_date: doc.issue_date ? String(doc.issue_date).split(' ')[0] : null,
      sales_rep: maps.employeeNameByCode[ownerCode] || maps.usersMap[ownerCode] || ownerCode,
      employee_id: maps.employeeByCode[ownerCode] || null,
      customer_name: doc.company_name || doc.account_name || doc.company || 'General Customer',
      linet_account_id: doc.account_id ? Number(doc.account_id) : null,
      sku,
      product_name: line.name || '',
      quantity,
      unit_price: Math.round(unitPrice * 100) / 100,
      total_row_amount: Math.round(totalRowAmount * 100) / 100,
      price_ex_vat: Math.round(priceExVat * 100) / 100,
      category: oldCategoryBySku[sku] || maps.categoryBySku[sku] || 'Uncategorized',
      sync_timestamp: new Date().toISOString(),
    };
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const fromDate = body.from_date;
    const toDate = body.to_date;
    const dryRun = body.dry_run === true;
    if (!fromDate || !toDate) return Response.json({ error: 'from_date and to_date required' }, { status: 400 });

    const credentials = await getCredentials(base44);
    const [linetDocs, localRecords, maps] = await Promise.all([
      fetchLinetDocuments(credentials, fromDate, toDate),
      fetchLocalSales(base44, fromDate, toDate),
      loadMaps(base44),
    ]);

    const localByDoc = groupLocalByDoc(localRecords);
    const targets = [];

    for (const doc of linetDocs) {
      const docId = String(doc.id);
      const linetTotal = summarizeLinetDoc(doc);
      const localRows = localByDoc.get(docId) || [];
      const localTotal = sumLocal(localRows);
      const linetLineCount = Array.isArray(doc.docDetailes) ? doc.docDetailes.length : 0;
      const diff = Math.round((linetTotal - localTotal) * 100) / 100;

      if (localRows.length === 0 || localRows.length !== linetLineCount || Math.abs(diff) >= 0.01) {
        targets.push({ doc, docId, doc_number: String(doc.docnum), linetTotal, localTotal, diff, oldRows: localRows });
      }
    }

    const repaired = [];
    let deletedRows = 0;
    let createdRows = 0;

    if (!dryRun) {
      for (const target of targets) {
        for (const row of target.oldRows) {
          await retryOnRateLimit(() => base44.asServiceRole.entities.SalesTransaction.delete(row.id));
          deletedRows++;
          await delay(100);
        }

        const rowsToCreate = buildRowsFromDoc(target.doc, maps, target.oldRows);
        for (const row of rowsToCreate) {
          await retryOnRateLimit(() => base44.asServiceRole.entities.SalesTransaction.create(row));
          createdRows++;
          await delay(100);
        }

        repaired.push({
          doc_id: target.docId,
          doc_number: target.doc_number,
          before: target.localTotal,
          after: target.linetTotal,
          old_rows: target.oldRows.length,
          new_rows: rowsToCreate.length,
        });
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      targets_count: targets.length,
      deleted_rows: deletedRows,
      created_rows: createdRows,
      repaired: dryRun ? targets.slice(0, 50).map((t) => ({ doc_id: t.docId, doc_number: t.doc_number, before: t.localTotal, after: t.linetTotal, diff: t.diff, old_rows: t.oldRows.length, new_rows: Array.isArray(t.doc.docDetailes) ? t.doc.docDetailes.length : 0 })) : repaired,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});