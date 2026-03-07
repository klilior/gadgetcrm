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
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const credentials = await getLinetCredentials(base44);
    const dateFrom = format(subDays(new Date(), 3), 'yyyy-MM-dd');
    const dateTo = format(new Date(), 'yyyy-MM-dd');

    console.log(`📋 Fetching invoices from ${dateFrom} to ${dateTo}`);

    // Fetch invoices (type 9 = invoice, 3 = receipt+invoice)
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

    console.log(`📄 Total invoices fetched: ${allDocs.length}`);

    // Load category translations for context
    const transList = await base44.asServiceRole.entities.LinetCategoryTranslation.list(null, 1000);
    const categoryMap = {};
    transList.forEach(t => categoryMap[t.category_id] = t.category_name);

    // Load product cache
    const productMaps = await base44.asServiceRole.entities.LinetProductMap.list(null, 1000);
    const productCache = {};
    productMaps.forEach(m => {
      if (m.sku) productCache[m.sku] = m.linet_category_name;
    });

    // Filter: invoices with total > 1000 that likely contain device purchases
    const PHONE_KEYWORDS = ['iphone', 'samsung', 'galaxy', 'xiaomi', 'redmi', 'poco', 'pixel', 'huawei', 'oppo', 'vivo', 'oneplus', 'nothing', 'motorola', 'nokia', 'realme', 'honor', 'airpods', 'ipad', 'macbook', 'apple watch'];
    const PHONE_CATEGORIES = ['טלפונים סלולרים', 'טלפונים סלולריים', 'סלולר', 'smartphones', 'phones', 'סמארטפונים', 'מכשירים'];

    const results = [];

    for (const doc of allDocs) {
      const totalVat = parseFloat(doc.totalVat || doc.total || 0);
      if (totalVat < 1000) continue;

      const lineItems = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
      
      // Check if any line looks like a device
      const deviceLines = [];
      const allLines = [];

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
          // Show ALL fields on the line item to discover serial number field
          all_fields: Object.keys(line),
          all_values: line,
          mapped_category: category,
        };

        allLines.push(lineInfo);

        // Check if this looks like a device
        const isDeviceByName = PHONE_KEYWORDS.some(kw => name.includes(kw));
        const isDeviceByCategory = PHONE_CATEGORIES.some(cat => category.toLowerCase().includes(cat.toLowerCase()));
        const isDeviceByPrice = unitPrice >= 500; // Expensive item

        if (isDeviceByName || isDeviceByCategory) {
          deviceLines.push({
            ...lineInfo,
            match_reason: isDeviceByName ? 'name_keyword' : 'category_match',
            has_serial_field: !!(line.serial || line.serial_number || line.imei || line.sn),
            serial_value: line.serial || line.serial_number || line.imei || line.sn || null,
          });
        } else if (isDeviceByPrice && !name.includes('משלוח') && !name.includes('הובלה')) {
          deviceLines.push({
            ...lineInfo,
            match_reason: 'high_price',
            has_serial_field: !!(line.serial || line.serial_number || line.imei || line.sn),
            serial_value: line.serial || line.serial_number || line.imei || line.sn || null,
          });
        }
      }

      if (deviceLines.length > 0 || totalVat >= 2000) {
        results.push({
          doc_id: doc.id,
          doc_number: doc.docnum,
          doc_type: doc.doctype,
          issue_date: doc.issue_date,
          total: totalVat,
          customer_name: doc.company_name || doc.account_name || doc.company,
          account_id: doc.account_id,
          phone: doc.phone || doc.mobile || doc.account_phone,
          email: doc.email,
          // Show ALL top-level doc fields to discover hidden fields
          top_level_fields: Object.keys(doc).filter(k => k !== 'docDetailes'),
          device_lines: deviceLines,
          all_lines_count: allLines.length,
          all_lines: allLines,
          // Sample the raw doc for the first result to see everything
          _raw_sample: results.length < 2 ? doc : undefined,
        });
      }
    }

    // Sort by total descending
    results.sort((a, b) => b.total - a.total);

    // Also list all unique categories found
    const allCategories = new Set();
    for (const doc of allDocs) {
      const lines = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
      for (const line of lines) {
        const cat = productCache[line.sku];
        if (cat) allCategories.add(cat);
      }
    }

    console.log(`✅ Found ${results.length} potential device invoices`);

    return Response.json({
      success: true,
      date_range: `${dateFrom} to ${dateTo}`,
      total_invoices_fetched: allDocs.length,
      potential_device_invoices: results.length,
      invoices: results.slice(0, 20), // Limit output
      all_categories_found: [...allCategories].sort(),
      category_translations_count: transList.length,
      product_mappings_count: productMaps.length,
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});