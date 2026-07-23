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

const GOODS_KEYWORDS = [
  'טלפון', 'סלולרי', 'מכשיר', 'סמארטפון', 'iphone', 'galaxy', 'samsung', 'apple',
  'xiaomi', 'אביזר', 'מטען', 'כבל', 'מגן', 'כיסוי', 'אוזניות', 'מסך', 'טאבלט',
  'מחשב', 'שעון', 'מק״ט', 'מקט', 'sku', 'gb', 'handset', 'device'
];

const FIXED_KEYWORDS = [
  'תקשורת', 'חיוב חודשי', 'דמי מנוי', 'מנוי', 'subscription', 'monthly', 'חבילה',
  'קו ', 'קווים', 'שיחות', 'גלישה', 'סים', 'sim', 'תוכנית', 'רישיון', 'license',
  'שירות', 'עמלת סליקה', 'פרסום', 'ads module', 'bi module'
];

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function storedCategory(value) {
  const category = normalized(value);
  if (category === 'goods' || category.includes('סחורה')) return 'goods';
  if (category === 'fixed' || category === 'recurring' || category === 'communication' || category === 'payment_processing' ||
      category.includes('קבוע') || category.includes('תקשורת') || category.includes('סליקה') || category.includes('מנוי') || category.includes('שירות')) return 'fixed';
  return null;
}

export function getLineClassification(line, supplier = {}, invoice = {}) {
  const manual = String(invoice?.notes || '').includes('[manual_classification_override]') || invoice?.classification_status === 'manually_corrected';
  const manualCategory = manual && (invoice?.is_goods_invoice ? 'goods' : invoice?.is_recurring_expense ? 'fixed' : storedCategory(invoice?.expense_category));
  const learned = storedCategory(supplier?.learned_classification) || storedCategory(supplier?.supplier_type) || storedCategory(supplier?.default_expense_category);
  if (line?.line_category) return line.line_category;
  if (manualCategory) return manualCategory;
  if (learned) return learned;

  const text = normalized(`${line?.product_name || ''} ${line?.description || ''} ${line?.sku || ''}`);
  const goods = GOODS_KEYWORDS.some((word) => text.includes(word));
  const fixed = FIXED_KEYWORDS.some((word) => text.includes(word));
  if (supplier?.id && (supplier?.is_recurring || supplier?.is_recurring_expense)) return goods ? 'goods' : 'fixed';
  if (supplier?.id) return fixed && !goods ? 'fixed' : 'goods';
  if (goods || fixed) return goods ? 'goods' : 'fixed';
  return null;
}

export function getInvoiceClassification(invoice, suppliersMap = {}) {
  const supplier = suppliersMap[invoice?.supplier] || suppliersMap[invoice?.detected_supplier_id] || {};
  let summary = invoice?.invoice_classification || null;

  if (!summary) {
    let extraction = {};
    try { extraction = invoice?.ai_debug_last_extraction_json ? JSON.parse(invoice.ai_debug_last_extraction_json) : {}; } catch (_) {}
    const categories = new Set((extraction?.line_items || []).map((line) => getLineClassification(line, supplier, invoice)).filter(Boolean));
    if (categories.size > 1) summary = 'mixed';
    else if (categories.size === 1) summary = Array.from(categories)[0];
    else summary = getLineClassification({}, supplier, invoice);
  }

  if (summary === 'goods') return { type: 'goods', summaryType: 'goods', label: 'סחורה', category: invoice?.expense_category || 'סחורה' };
  if (summary === 'fixed') return { type: 'recurring', summaryType: 'fixed', label: 'הוצאה קבועה', category: invoice?.expense_category || supplier.default_expense_category || 'הוצאה קבועה' };
  if (summary === 'mixed') return { type: 'mixed', summaryType: 'mixed', label: 'מעורבת', category: 'סחורה והוצאה קבועה' };
  return { type: 'other', summaryType: null, label: 'דורש סיווג', category: invoice?.expense_category || 'אחר' };
}