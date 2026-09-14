/** Shared review rules (browser copy of base44/shared/invoiceReviewPolicy.ts). Pure. */
export function parseReviewJson(value, fallback = {}) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
}
export function normalizeLearningText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function stableLinePattern(value) {
  const text = normalizeLearningText(value);
  if (!/[a-zא-ת]/i.test(text)) return '';
  return text.replace(/(תשלום|חודש|תקופה)\s*\d+/g, '$1 #').replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, '#date');
}
export function reviewCategory(invoice) {
  if (invoice.expense_category === 'goods') return 'goods';
  if (['shipping','rent','communication','advertising','software','payment_fee','payment_processing','service'].includes(invoice.expense_category)) return 'fixed';
  if (invoice.is_goods_invoice && !invoice.is_recurring_expense) return 'goods';
  if (invoice.is_recurring_expense && !invoice.is_goods_invoice) return 'fixed';
  return null;
}
export function hasHumanReview(invoice) {
  const provenance = parseReviewJson(invoice?.field_provenance_json);
  return invoice?.classification_status === 'manually_corrected' || !!invoice?.reviewed_at || Object.values(provenance.selected || {}).some((field) => field?.source === 'HUMAN');
}
export function reviewArithmetic(invoice) {
  const values = ['subtotal_before_vat','vat_amount','total_with_vat'].map(key => invoice[key]);
  if (values.some(v => v === '' || v == null || !Number.isFinite(Number(v)))) return {ok:false, reason:'יש להשלים סכום לפני מע״מ, מע״מ וסכום כולל.'};
  const [subtotal, vat, total] = values.map(Number);
  const delta = Math.round((subtotal + vat - total) * 100) / 100;
  return {ok: Math.abs(delta) <= 0.02, delta, reason: Math.abs(delta) <= 0.02 ? '' : 'הסכום לפני מע״מ והמע״מ אינם מסתכמים לסכום הכולל. יש לבדוק מול המסמך.'};
}
export function monetaryCorrectionExample(original, edited, context = {}) {
  const extraction = parseReviewJson(original.ai_debug_last_extraction_json);
  const fields = ['subtotal_before_vat','vat_amount','total_with_vat'];
  if (!fields.some(key => Number(original[key]) !== Number(edited[key]))) return null;
  const candidates = extraction.amount_provenance?.candidates || [];
  const total = Number(edited.total_with_vat);
  const labels = candidates.filter(c => Number.isFinite(c.amount) && Math.abs(c.amount-total)<0.02 && c.printed_label).map(c=>c.printed_label);
  return {
    version:1, doc_type: edited.doc_type || original.doc_type || null,
    document_kind: extraction.amount_provenance?.document_kind || null,
    supplier_names: [extraction.supplier_name,extraction.supplier_name_normalized,context.supplierName].map(normalizeLearningText).filter(Boolean),
    supplier_vat_id: context.vatId || extraction.supplier_vat_id || null,
    before: Object.fromEntries(fields.map(key=>[key,original[key] ?? null])),
    after: Object.fromEntries(fields.map(key=>[key,edited[key] ?? null])),
    preferred_total_labels: [...new Set(labels)],
    reason: context.reason || 'corrected_amount',
    label_hint: String(context.labelHint || '').trim().slice(0,120),
    evidence_only: true
  };
}