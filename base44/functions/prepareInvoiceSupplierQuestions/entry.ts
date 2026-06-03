import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(value) {
  return String(value || '').trim() || 'לא ידוע';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'מנהל') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const limit = Math.min(Number(payload.limit || 1000), 1000);

    const [invoices, suppliers] = await Promise.all([
      base44.asServiceRole.entities.Invoices.filter({ classification_status: 'needs_review' }, '-doc_date', limit),
      base44.asServiceRole.entities.Suppliers.list('name', 500),
    ]);

    const supplierById = new Map((suppliers || []).map((supplier) => [supplier.id, supplier]));
    const groups = new Map();

    for (const invoice of invoices || []) {
      const supplierId = invoice.detected_supplier_id || invoice.supplier || 'unknown';
      const supplier = supplierById.get(supplierId);
      const supplierName = normalizeName(supplier?.name || invoice.supplier);
      const key = supplierId || supplierName;
      const existing = groups.get(key) || {
        supplier_id: supplierId,
        supplier_name: supplierName,
        count: 0,
        total_gross: 0,
        latest_invoice_date: null,
        sample_doc_numbers: [],
        current_category: supplier?.default_expense_category || null,
        current_supplier_type: supplier?.supplier_type || null,
        current_is_recurring: !!(supplier?.is_recurring_expense || supplier?.is_recurring),
        current_include_in_goods_ratio: !!supplier?.include_in_goods_ratio,
      };

      existing.count += 1;
      existing.total_gross += toNumber(invoice.total_with_vat);
      if (!existing.latest_invoice_date || (invoice.doc_date && invoice.doc_date > existing.latest_invoice_date)) {
        existing.latest_invoice_date = invoice.doc_date || existing.latest_invoice_date;
      }
      if (invoice.doc_number && existing.sample_doc_numbers.length < 3) {
        existing.sample_doc_numbers.push(invoice.doc_number);
      }
      groups.set(key, existing);
    }

    const result = Array.from(groups.values())
      .map((group) => ({ ...group, total_gross: Math.round(group.total_gross * 100) / 100 }))
      .sort((a, b) => b.count - a.count || b.total_gross - a.total_gross);

    const top = Math.min(Number(payload.top || 25), 100);
    const topGroups = result.slice(0, top);

    const suggestedQuestions = topGroups.map((group, index) => ({
      n: index + 1,
      supplier_id: group.supplier_id,
      supplier_name: group.supplier_name,
      invoices_count: group.count,
      total_gross: group.total_gross,
      samples: group.sample_doc_numbers.join(', ')
    }));

    return Response.json({
      success: true,
      scanned_invoices: invoices?.length || 0,
      total_supplier_groups: result.length,
      suggested_questions: suggestedQuestions,
      supplier_groups: payload.only_questions ? undefined : topGroups,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});