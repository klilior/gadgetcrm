/**
 * P1-E — LOW-LEVEL ALTERNATE-BASE INFERENCE (pure, DB-free, supplier-agnostic).
 *
 * Extracted out of invoiceExtraction.ts to remove the circular dependency
 * (invoiceLineApplicability ⇄ invoiceExtraction). This module imports NOTHING from the app;
 * invoiceLineApplicability and invoiceExtraction both import it one-way.
 *
 * It answers ONE legacy-safe question: for a row whose printed P1-E metadata is ABSENT, do the
 * unit price and the line total look like they sit on DIFFERENT bases (explicit discount,
 * VAT-inclusive unit price, service / rounding / subscription presentation)?
 */

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

const ALTERNATE_BASE_TEXT = /(הנחה|discount|זיכוי|עיגול|rounding|מע"?מ|מע״מ|\bvat\b|דמי טיפול|שירות חודשי|subscription|מנוי|proration|יחסי)/;

/**
 * True when unit price and line total are printed on DIFFERENT bases, so qty × unit price is not
 * comparable to the line total: explicit discounts, VAT-inclusive unit prices, or service /
 * rounding / shipping-fee style lines.
 */
export function hasAlternateLineBase(item: any): boolean {
  if (!item) return false;
  if (item.unit_price_includes_vat === true || item.price_includes_vat === true) return true;
  if (isFiniteNumber(item.discount_amount) && item.discount_amount !== 0) return true;
  if (isFiniteNumber(item.discount_percent) && item.discount_percent !== 0) return true;
  if (isFiniteNumber(item.line_total_with_vat) && isFiniteNumber(item.line_total_before_vat)
    && Math.abs(item.line_total_with_vat - item.line_total_before_vat) > 0.02
    && isFiniteNumber(item.quantity) && isFiniteNumber(item.unit_price_before_vat)
    && Math.abs(Math.abs(item.quantity * item.unit_price_before_vat) - Math.abs(item.line_total_with_vat)) <= 0.02) return true;
  const name = `${item.product_name || ''} ${item.description || ''} ${item.sku || ''}`.toLowerCase();
  return ALTERNATE_BASE_TEXT.test(name);
}