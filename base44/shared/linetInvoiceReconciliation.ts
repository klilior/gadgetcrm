export function normalizeInvoiceNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

export function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (!match || match[0].startsWith('0000-')) return '';
  return match[0];
}

export function numberValue(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function normalizedText(value) {
  return String(value || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function evaluateLinetMatch(invoice, purchase, invoiceLines = [], supplier = null, tolerance = 1) {
  const numberMatch = normalizeInvoiceNumber(invoice.doc_number) !== '' && normalizeInvoiceNumber(invoice.doc_number) === purchase.normalized_invoice_number;
  if (!numberMatch) return { level: 'none', numberMatch: false };

  const localVat = String(supplier?.vat_id || '').replace(/\D/g, '');
  const linetVat = String(purchase.supplier_vat_id || '').replace(/\D/g, '');
  if (localVat && linetVat && localVat !== linetVat) return { level: 'none', numberMatch: true, supplierMismatch: true };

  const dateMatch = !!dateOnly(invoice.doc_date) && dateOnly(invoice.doc_date) === dateOnly(purchase.doc_date);
  const localTotal = numberValue(invoice.total_with_vat);
  const linetTotal = numberValue(purchase.total_with_vat);
  const totalMatch = localTotal !== null && linetTotal !== null && Math.abs(localTotal - linetTotal) <= tolerance;
  const withVatLineSum = invoiceLines.reduce((sum, line) => sum + (numberValue(line.line_total_with_vat) || 0), 0);
  const beforeVatLineSum = invoiceLines.reduce((sum, line) => sum + (numberValue(line.line_total_before_vat) || 0), 0);
  const lineMatch = invoiceLines.length > 0 && (
    Math.abs(withVatLineSum - (numberValue(purchase.line_total_with_vat) || -999999)) <= tolerance ||
    Math.abs(beforeVatLineSum - (numberValue(purchase.subtotal_before_vat) || -999999)) <= tolerance
  );
  const level = dateMatch && totalMatch ? 'confirmed' : (dateMatch || totalMatch || lineMatch ? 'possible' : 'number_only');
  return { level, numberMatch, dateMatch, totalMatch, lineMatch, reason: `מספר=${numberMatch ? 'כן' : 'לא'}, תאריך=${dateMatch ? 'כן' : 'לא'}, סכום=${totalMatch ? 'כן' : 'לא'}, שורות=${lineMatch ? 'כן' : 'לא'}` };
}