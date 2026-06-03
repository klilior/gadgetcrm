export function getInvoiceText(invoice) {
  const parts = [
    invoice?.notes,
    invoice?.doc_number,
    invoice?.supplier,
  ];

  try {
    const extraction = invoice?.ai_debug_last_extraction_json
      ? JSON.parse(invoice.ai_debug_last_extraction_json)
      : null;

    parts.push(
      extraction?.supplier_name,
      extraction?.display_summary_he,
      extraction?.skip_reason_he,
      ...(extraction?.line_items || []).flatMap((item) => [
        item?.product_name,
        item?.description,
        item?.sku,
        item?.line_category,
        item?.goods_type,
      ])
    );
  } catch (_) {}

  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function getInvoiceClassification(invoice, suppliersMap = {}) {
  const supplier = suppliersMap[invoice?.supplier] || suppliersMap[invoice?.detected_supplier_id] || {};
  const text = getInvoiceText(invoice);

  const communicationKeywords = [
    'שירותי תקשורת', 'תקשורת', 'חיוב חודשי', 'דמי מנוי', 'מנוי', 'חבילה', 'חבילת',
    'קו ', 'קווים', 'שיחות', 'גלישה', 'סים', 'sim', 'תוכנית', 'חשבונית תקופתית', 'שירות'
  ];

  const goodsKeywords = [
    'טלפון', 'טלפונים', 'סלולרי', 'סלולריים', 'מכשיר', 'מכשירים', 'סמארטפון',
    'iphone', 'galaxy', 'samsung', 'apple', 'xiaomi', 'אביזר', 'אביזרים', 'מטען',
    'כבל', 'מגן', 'כיסוי', 'אוזניות', 'מסך', 'מק״ט', 'מקט', 'sku'
  ];

  const hasCommunicationText = communicationKeywords.some((word) => text.includes(word));
  const hasGoodsText = goodsKeywords.some((word) => text.includes(word));
  const manualCategory = String(invoice?.expense_category || '').toLowerCase();

  const explicitManualOverride = String(invoice?.notes || '').includes('[manual_classification_override]');

  if (explicitManualOverride) {
    if (invoice?.is_goods_invoice === true || manualCategory.includes('סחורה')) {
      return { type: 'goods', label: 'סחורה', category: invoice?.expense_category || 'סחורה' };
    }
    if (invoice?.is_recurring_expense === true || manualCategory.includes('תקשורת') || manualCategory.includes('סליקה') || manualCategory.includes('קבוע')) {
      return { type: 'recurring', label: 'הוצאה קבועה', category: invoice?.expense_category || 'הוצאה קבועה' };
    }
    return { type: 'other', label: 'הוצאה אחרת', category: invoice?.expense_category || 'אחר' };
  }

  if (hasCommunicationText && !hasGoodsText) {
    return {
      type: 'recurring',
      label: 'הוצאה קבועה',
      category: invoice?.expense_category || supplier.default_expense_category || 'שירותי תקשורת',
    };
  }

  if (invoice?.is_goods_invoice === true || supplier.supplier_type === 'goods' || supplier.include_in_goods_ratio === true || hasGoodsText) {
    return {
      type: 'goods',
      label: 'סחורה',
      category: invoice?.expense_category || supplier.default_expense_category || 'סחורה',
    };
  }

  if (invoice?.is_recurring_expense === true || supplier.is_recurring_expense === true || supplier.is_recurring === true || hasCommunicationText) {
    return {
      type: 'recurring',
      label: 'הוצאה קבועה',
      category: invoice?.expense_category || supplier.default_expense_category || 'הוצאה קבועה',
    };
  }

  return {
    type: 'other',
    label: 'הוצאה אחרת',
    category: invoice?.expense_category || supplier.default_expense_category || 'אחר',
  };
}