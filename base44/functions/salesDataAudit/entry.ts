import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { from_date, to_date } = body;

    if (!from_date || !to_date) {
      return Response.json({ error: 'from_date and to_date required' }, { status: 400 });
    }

    // Fetch ALL SalesTransaction records for the period (paginate)
    let allRecords = [];
    let skip = 0;
    const limit = 50;
    while (true) {
      const batch = await base44.asServiceRole.entities.SalesTransaction.filter(
        { issue_date: { $gte: from_date, $lte: to_date } },
        'issue_date',
        limit,
        skip
      );
      allRecords = allRecords.concat(batch);
      if (batch.length < limit) break;
      skip += limit;
    }

    // Aggregate by sales_rep
    const repStats = {};
    const docNumbers = new Set();
    const categories = {};
    const docTypes = {};

    for (const rec of allRecords) {
      const rep = rec.sales_rep || 'לא ידוע';
      const cat = rec.category || 'Uncategorized';
      const docType = rec.doc_type || 'לא ידוע';
      const qty = rec.quantity || 0;
      const totalRow = rec.total_row_amount || 0;
      const priceExVat = rec.price_ex_vat || 0;

      // Per rep
      if (!repStats[rep]) {
        repStats[rep] = {
          total_rows: 0,
          total_quantity: 0,
          total_inc_vat: 0,
          total_ex_vat: 0,
          invoices: new Set(),
          credit_notes: new Set(),
          categories: {},
          doc_types: {}
        };
      }
      repStats[rep].total_rows++;
      repStats[rep].total_quantity += qty;
      repStats[rep].total_inc_vat += totalRow;
      repStats[rep].total_ex_vat += priceExVat;
      repStats[rep].invoices.add(rec.doc_number);

      if (qty < 0 || docType === 'חשבונית זיכוי') {
        repStats[rep].credit_notes.add(rec.doc_number);
      }

      // Category per rep
      if (!repStats[rep].categories[cat]) repStats[rep].categories[cat] = { rows: 0, qty: 0, total: 0 };
      repStats[rep].categories[cat].rows++;
      repStats[rep].categories[cat].qty += qty;
      repStats[rep].categories[cat].total += totalRow;

      // Doc type per rep
      if (!repStats[rep].doc_types[docType]) repStats[rep].doc_types[docType] = 0;
      repStats[rep].doc_types[docType]++;

      // Global
      docNumbers.add(rec.doc_number);
      if (!categories[cat]) categories[cat] = { rows: 0, qty: 0, total: 0 };
      categories[cat].rows++;
      categories[cat].qty += qty;
      categories[cat].total += totalRow;

      if (!docTypes[docType]) docTypes[docType] = 0;
      docTypes[docType]++;
    }

    // Serialize sets for JSON
    const repSummary = {};
    for (const [rep, stats] of Object.entries(repStats)) {
      repSummary[rep] = {
        total_rows: stats.total_rows,
        total_quantity: Math.round(stats.total_quantity * 100) / 100,
        total_inc_vat: Math.round(stats.total_inc_vat * 100) / 100,
        total_ex_vat: Math.round(stats.total_ex_vat * 100) / 100,
        unique_invoices: stats.invoices.size,
        credit_notes_count: stats.credit_notes.size,
        categories: stats.categories,
        doc_types: stats.doc_types
      };
    }

    return Response.json({
      period: { from: from_date, to: to_date },
      total_rows: allRecords.length,
      unique_documents: docNumbers.size,
      by_rep: repSummary,
      by_category: categories,
      by_doc_type: docTypes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});