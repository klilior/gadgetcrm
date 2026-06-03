import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function categoryFromSupplierType(type) {
  const map = {
    goods: 'goods', shipping: 'shipping', rent: 'rent', communication: 'communication', advertising: 'advertising',
    software: 'software', payment_processing: 'payment_fee', professional_services: 'service', utilities: 'service', other: 'other'
  };
  return map[type] || 'other';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function gross(line) {
  const withVat = Number(line.line_total_with_vat ?? line.line_total ?? 0);
  if (withVat) return Math.abs(withVat);
  const before = Number(line.line_total_before_vat || 0);
  return before ? Math.abs(Math.round(before * 1.18 * 100) / 100) : 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit || 300), 1000);
    const invoices = await base44.asServiceRole.entities.Invoices.filter({}, '-doc_date', limit);
    const suppliers = await base44.asServiceRole.entities.Suppliers.filter({}, undefined, 1000);
    const suppliersMap = {};
    for (const s of suppliers || []) suppliersMap[s.id] = s;

    let updated = 0;
    let needsReview = 0;

    for (const inv of invoices || []) {
      if (inv.classification_status === 'auto_approved' || inv.classification_status === 'manually_corrected') continue;
      const supplier = suppliersMap[inv.supplier] || suppliersMap[inv.detected_supplier_id];
      if (!supplier) {
        await base44.asServiceRole.entities.Invoices.update(inv.id, { classification_status: 'needs_review', duplicate_check_status: inv.duplicate_check_status || 'not_checked' });
        needsReview++;
        continue;
      }

      const lines = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: inv.id }, undefined, 500);
      const isGoodsSupplier = !!supplier.include_in_goods_ratio || supplier.supplier_type === 'goods';
      const defaultLineCategory = isGoodsSupplier ? 'goods' : categoryFromSupplierType(supplier.supplier_type);
      let goodsGross = 0;
      let nonGoodsGross = 0;

      for (const line of lines || []) {
        const amount = gross(line);
        if (isGoodsSupplier) goodsGross += amount;
        else nonGoodsGross += amount;
        await base44.asServiceRole.entities.InvoiceLine.update(line.id, {
          line_category: line.line_category || defaultLineCategory,
          goods_type: line.goods_type || 'other',
          include_in_goods_ratio: line.include_in_goods_ratio ?? isGoodsSupplier,
          unit_cost: line.unit_cost ?? line.unit_price_before_vat ?? null,
          line_total: line.line_total ?? line.line_total_with_vat ?? line.line_total_before_vat ?? null,
          classification_confidence: line.classification_confidence || (isGoodsSupplier ? 70 : 65),
          supplier_id: inv.supplier || inv.detected_supplier_id || null,
          price_alert_enabled: line.price_alert_enabled !== false
        });
      }

      if (!lines?.length) {
        const total = Math.abs(Number(inv.total_with_vat || 0));
        if (isGoodsSupplier) goodsGross = total;
        else nonGoodsGross = total;
      }

      const isCredit = inv.doc_type === 'חשבונית זיכוי';
      await base44.asServiceRole.entities.Invoices.update(inv.id, {
        detected_supplier_id: inv.detected_supplier_id || inv.supplier,
        expense_category: inv.expense_category || supplier.default_expense_category || categoryFromSupplierType(supplier.supplier_type),
        is_goods_invoice: isGoodsSupplier,
        is_recurring_expense: !!(supplier.is_recurring_expense || supplier.is_recurring),
        recurring_match_status: (supplier.is_recurring_expense || supplier.is_recurring) ? 'matched' : 'not_recurring',
        classification_confidence: inv.classification_confidence || (isGoodsSupplier ? 70 : 65),
        classification_status: 'needs_review',
        goods_amount_gross: Math.round(goodsGross * 100) / 100,
        non_goods_amount_gross: Math.round(nonGoodsGross * 100) / 100,
        credit_amount_gross: isCredit ? Math.abs(Number(inv.total_with_vat || goodsGross || 0)) : 0,
        duplicate_check_status: inv.duplicate_check_status || 'legacy_not_checked'
      });
      updated++;
      needsReview++;
      await sleep(150);
    }

    return Response.json({ success: true, scanned: invoices?.length || 0, updated, needs_review: needsReview });
  } catch (error) {
    console.error('backfillInvoiceClassification error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});