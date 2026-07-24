const GOODS_KEYWORDS = [
  'טלפון', 'סלולרי', 'מכשיר', 'סמארטפון', 'iphone', 'galaxy', 'samsung', 'apple',
  'xiaomi', 'אביזר', 'מטען', 'כבל', 'מגן', 'כיסוי', 'אוזניות', 'מסך', 'טאבלט',
  'מחשב', 'שעון', 'מק״ט', 'מקט', 'sku', 'gb', 'handset', 'device'
];

const FIXED_KEYWORDS = [
  'שירותי תקשורת', 'תקשורת', 'חיוב חודשי', 'דמי מנוי', 'מנוי', 'subscription',
  'monthly', 'חבילה', 'קו ', 'קווים', 'שיחות', 'גלישה', 'סים', 'sim', 'תוכנית',
  'רישיון', 'license', 'שירות', 'עמלת סליקה', 'פרסום', 'ads module', 'bi module'
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function categoryFromValue(value) {
  const v = normalize(value);
  if (!v) return null;
  if (v === 'goods' || v.includes('סחורה')) return 'goods';
  if (v === 'fixed' || v === 'recurring' || v === 'communication' || v === 'payment_processing' ||
      v.includes('קבוע') || v.includes('תקשורת') || v.includes('סליקה') || v.includes('מנוי') || v.includes('שירות')) return 'fixed';
  return null;
}

export function getManualInvoiceCategory(invoice) {
  const explicit = normalize(invoice?.notes).includes('[manual_classification_override]') ||
    invoice?.classification_status === 'manually_corrected';
  if (!explicit) return null;
  if (invoice?.is_goods_invoice === true) return 'goods';
  if (invoice?.is_recurring_expense === true) return 'fixed';
  return categoryFromValue(invoice?.expense_category);
}

export function getLearnedSupplierCategory(supplier) {
  return categoryFromValue(supplier?.learned_classification) ||
    categoryFromValue(supplier?.supplier_type) ||
    categoryFromValue(supplier?.default_expense_category);
}

export function classifyInvoiceLines({ invoice = {}, supplier = null, lineItems = [], learnedLinePatterns = [] }) {
  const manualCategory = getManualInvoiceCategory(invoice);
  const learnedCategory = getLearnedSupplierCategory(supplier);
  const supplierKnown = !!supplier?.id;
  const supplierDefault = manualCategory || learnedCategory || (supplierKnown ? (supplier?.is_recurring || supplier?.is_recurring_expense ? 'fixed' : 'goods') : null);
  const defaultSource = manualCategory ? 'manual' : learnedCategory ? 'learned' : supplierKnown ? 'supplier_default' : 'keywords';

  const lines = (lineItems || []).map((line, index) => {
    const text = normalize(`${line?.product_name || ''} ${line?.description || ''} ${line?.sku || ''}`);
    const goodsSignal = includesAny(text, GOODS_KEYWORDS);
    const fixedSignal = includesAny(text, FIXED_KEYWORDS);
    const sku = normalize(line?.sku);
    const name = normalize(line?.product_name || line?.description);
    const learnedLine = learnedLinePatterns.find((pattern) =>
      (pattern.pattern_type === 'line_sku_classification' && sku && normalize(pattern.pattern_value) === sku) ||
      (pattern.pattern_type === 'line_name_classification' && name && normalize(pattern.pattern_value) === name)
    );
    const learnedLineCategory = categoryFromValue(learnedLine?.classification);
    let category = null;
    let source = defaultSource;
    let reason = '';

    if (manualCategory) {
      category = manualCategory;
      reason = 'סיווג ידני מפורש בחשבונית';
    } else if (learnedLineCategory) {
      category = learnedLineCategory;
      source = 'learned';
      reason = 'סיווג שנלמד ידנית עבור מק״ט או שורת מוצר זו אצל הספק';
    } else if (learnedCategory) {
      category = learnedCategory;
      reason = 'סיווג ידני שנלמד עבור הספק';
    } else if (supplierKnown && (supplier?.is_recurring || supplier?.is_recurring_expense)) {
      category = goodsSignal ? 'goods' : 'fixed';
      source = goodsSignal ? 'keywords' : 'supplier_default';
      reason = goodsSignal ? 'שורת מכשיר/סחורה ברורה אצל ספק קבוע' : 'ברירת מחדל של ספק הוצאה קבועה';
    } else if (supplierKnown) {
      category = fixedSignal && !goodsSignal ? 'fixed' : 'goods';
      source = fixedSignal && !goodsSignal ? 'keywords' : 'supplier_default';
      reason = fixedSignal && !goodsSignal ? 'שורת שירות/מנוי ברורה' : 'ברירת מחדל של ספק סחורה';
    } else if (goodsSignal || fixedSignal) {
      category = goodsSignal ? 'goods' : 'fixed';
      reason = goodsSignal ? 'מילות מפתח מובהקות של סחורה' : 'מילות מפתח מובהקות של הוצאה קבועה';
    } else {
      reason = 'הספק לא זוהה ואין בשורה מילות מפתח מכריעות';
    }

    return { ...line, _index: index, line_category: category, classification_source: source, classification_reason: reason };
  });

  const categories = new Set(lines.map((line) => line.line_category).filter(Boolean));
  let invoiceClassification = null;
  if (categories.size > 1) invoiceClassification = 'mixed';
  else if (categories.size === 1) invoiceClassification = Array.from(categories)[0];
  else if (supplierDefault) invoiceClassification = supplierDefault;

  const unresolved = lines.filter((line) => !line.line_category).length;
  const needsReview = !invoiceClassification || unresolved > 0;
  const classificationReason = needsReview
    ? (unresolved > 0 ? `${unresolved} שורות ללא הכרעה: הספק לא זוהה ומילות המפתח אינן מספיקות` : 'הספק לא זוהה ואין שורות מכריעות')
    : invoiceClassification === 'mixed'
      ? 'החשבונית כוללת גם שורות הוצאה קבועה וגם שורות סחורה'
      : `כל השורות סווגו כ-${invoiceClassification === 'goods' ? 'סחורה' : 'הוצאה קבועה'}`;

  return {
    lines,
    invoice_classification: invoiceClassification,
    classification_status: manualCategory ? 'manually_corrected' : needsReview ? 'needs_review' : 'auto_classified',
    classification_reason: classificationReason,
    needs_review: needsReview
  };
}