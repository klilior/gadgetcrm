import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { format, subDays } from 'npm:date-fns@2.30.0';

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

    const credentials = await getLinetCredentials(base44);
    const dateFrom = format(subDays(new Date(), 3), 'yyyy-MM-dd');
    const dateTo = format(new Date(), 'yyyy-MM-dd');

    console.log(`Fetching invoices from ${dateFrom} to ${dateTo}`);

    const payload = {
      ...credentials,
      limit: 200,
      offset: 0,
      query: {
        issue_date: `${dateFrom} to ${dateTo}`,
        doctype: ["9", "3"],
        refstatus: null,
      },
    };

    const response = await fetch(`${BASE_URL}/newsearch/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const apiResponse = await response.json();
    const allDocs = apiResponse.body || [];
    console.log(`Total invoices: ${allDocs.length}`);

    // Load product category cache
    const productMaps = await base44.asServiceRole.entities.LinetProductMap.list(null, 1000);
    const productCache = {};
    productMaps.forEach(m => { if (m.sku) productCache[m.sku] = m.linet_category_name; });

    const PHONE_KEYWORDS = ['iphone', 'samsung', 'galaxy', 'xiaomi', 'redmi', 'poco', 'pixel', 'huawei', 'oppo', 'ipad', 'macbook', 'apple watch', 'airpods'];
    const PHONE_CATEGORIES = ['טלפונים סלולרים', 'טלפונים סלולריים', 'סלולר', 'סמארטפונים', 'מכשירים'];

    const results = [];

    for (const doc of allDocs) {
      const totalVat = parseFloat(doc.totalVat || doc.total || 0);
      if (totalVat < 1000) continue;

      const lineItems = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
      const deviceLines = [];

      for (const line of lineItems) {
        const name = (line.name || '').toLowerCase();
        const sku = line.sku || '';
        const category = productCache[sku] || '';
        const unitPrice = parseFloat(line.price || 0);

        const lineInfo = {
          sku: line.sku,
          name: line.name,
          qty: line.qty,
          price: line.price,
          iTotal: line.iTotal,
          iTotalVat: line.iTotalVat,
          all_line_fields: Object.keys(line),
          raw_line: line,
          mapped_category: category,
        };

        const isDeviceByName = PHONE_KEYWORDS.some(kw => name.includes(kw));
        const isDeviceByCategory = PHONE_CATEGORIES.some(cat => category.toLowerCase().includes(cat.toLowerCase()));

        if (isDeviceByName || isDeviceByCategory || unitPrice >= 800) {
          deviceLines.push({
            ...lineInfo,
            match_reason: isDeviceByName ? 'name_keyword' : isDeviceByCategory ? 'category_match' : 'high_price',
            serial_fields_check: {
              serial: line.serial || null,
              serial_number: line.serial_number || null,
              imei: line.imei || null,
              sn: line.sn || null,
              serialnum: line.serialnum || null,
              barcode: line.barcode || null,
            },
          });
        }
      }

      if (deviceLines.length > 0) {
        results.push({
          doc_id: doc.id,
          doc_number: doc.docnum,
          issue_date: doc.issue_date,
          total: totalVat,
          customer: doc.company_name || doc.account_name,
          phone: doc.phone || doc.mobile || doc.account_phone,
          account_id: doc.account_id,
          top_level_doc_fields: Object.keys(doc).filter(k => k !== 'docDetailes'),
          device_lines: deviceLines,
          all_lines_count: lineItems.length,
        });
      }
    }

    results.sort((a, b) => b.total - a.total);

    // Get all categories found
    const allCats = new Set();
    for (const doc of allDocs) {
      for (const line of (doc.docDetailes || [])) {
        const cat = productCache[line.sku];
        if (cat) allCats.add(cat);
      }
    }

    return Response.json({
      success: true,
      date_range: `${dateFrom} to ${dateTo}`,
      total_invoices: allDocs.length,
      device_invoices_found: results.length,
      invoices: results.slice(0, 15),
      all_categories_in_period: [...allCats].sort(),
      // Include 1 raw full doc for reference
      sample_raw_doc: allDocs.length > 0 ? allDocs[0] : null,
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});