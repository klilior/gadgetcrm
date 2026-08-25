/**
 * P1-E — DETERMINISTIC LINE APPLICABILITY (pure, DB-free, supplier-agnostic).
 *
 * Decides, per line, whether a qty × unit-price comparison is SEMANTICALLY meaningful, using
 * optional printed metadata when the extraction reported it and legacy-safe inference otherwise.
 *
 * Hard rules:
 *  - A blocking arithmetic claim requires finite operands on the SAME VAT basis and the SAME
 *    discount basis, on a comparable DETAIL line (product / service / shipping / unknown).
 *  - SUMMARY / DISCOUNT / ROUNDING rows and mismatched-or-unknown bases are NON-comparable:
 *    they yield a stable LINE_BASE_NOT_COMPARABLE reason, never an arithmetic contradiction.
 *  - Missing / zero quantity stays critical for real detail lines only.
 *  - Header subtotal/VAT/total logic is untouched here; lines never rewrite header totals.
 *  - Nothing here approves anything — the validation gate remains the only approval authority.
 *  - Behaviour is never keyed by supplier name, invoice id, file name or an expected value.
 */

import { hasAlternateLineBase } from './invoiceExtraction.ts';

export const LINE_APPLICABILITY_VERSION = 'line-applicability-1.0.0';

export const LINE_ROLES = ['PRODUCT', 'SERVICE', 'SHIPPING', 'DISCOUNT', 'ROUNDING', 'SUMMARY', 'UNKNOWN'];
export const LINE_BASES = ['BEFORE_DISCOUNT', 'AFTER_DISCOUNT', 'UNKNOWN'];
export const SIGN_CONVENTIONS = ['DEBIT', 'CREDIT', 'ABSOLUTE', 'UNKNOWN'];

export const LINE_APPLICABILITY_REASON_CODES = {
  NOT_COMPARABLE: 'LINE_BASE_NOT_COMPARABLE',
  MISSING_OPERANDS: 'LINE_OPERANDS_MISSING',
  ZERO_QUANTITY: 'LINE_ZERO_QUANTITY'
};

/** Roles that are not per-item detail rows, so qty × price is meaningless on them. */
const NON_DETAIL_ROLES = new Set(['SUMMARY', 'DISCOUNT', 'ROUNDING']);

const ROLE_HINTS: [RegExp, string][] = [
  [/(סה"?כ|סה״כ|סיכום|subtotal|total\b|summary)/i, 'SUMMARY'],
  [/(הנחה|discount)/i, 'DISCOUNT'],
  [/(עיגול|rounding)/i, 'ROUNDING'],
  [/(משלוח|דמי משלוח|shipping|freight|delivery\s*fee)/i, 'SHIPPING'],
  [/(שירות|דמי טיפול|מנוי|subscription|service)/i, 'SERVICE']
];

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function enumValue(raw: unknown, allowed: string[], fallback: string): string {
  const value = String(raw ?? '').trim().toUpperCase();
  return allowed.includes(value) ? value : fallback;
}

/** Explicit reported role wins; otherwise inferred from the row's own printed text. */
export function resolveLineRole(item: any): { role: string; source: 'explicit' | 'inferred' | 'default' } {
  const explicit = String(item?.line_role ?? '').trim().toUpperCase();
  if (LINE_ROLES.includes(explicit) && explicit !== 'UNKNOWN') return { role: explicit, source: 'explicit' };
  const text = `${item?.product_name || ''} ${item?.description || ''} ${item?.sku || ''}`;
  for (const [pattern, role] of ROLE_HINTS) {
    if (pattern.test(text)) return { role, source: 'inferred' };
  }
  return { role: 'PRODUCT', source: 'default' };
}

/**
 * PURE per-line applicability decision.
 * @param item  one extraction line (optional P1-E metadata is used when present)
 * @param context { isCreditNote }
 */
export function decideLineApplicability(item: any, context: any = {}) {
  const lineNumber = item?.line_number ?? null;
  const { role, source: role_source } = resolveLineRole(item);
  const unit_price_basis = enumValue(item?.unit_price_basis, LINE_BASES, 'UNKNOWN');
  const line_total_basis = enumValue(item?.line_total_basis, LINE_BASES, 'UNKNOWN');
  const sign_convention = enumValue(item?.sign_convention, SIGN_CONVENTIONS, 'UNKNOWN');
  const unit_vat = typeof item?.unit_price_includes_vat === 'boolean' ? item.unit_price_includes_vat : null;
  const total_vat = typeof item?.line_total_includes_vat === 'boolean' ? item.line_total_includes_vat : null;

  const qty = item?.quantity;
  const unit = item?.unit_price_before_vat;
  const total = item?.line_total_before_vat;
  const hasOperands = isFiniteNumber(qty) && isFiniteNumber(unit) && isFiniteNumber(total);

  const blockers: string[] = [];
  if (NON_DETAIL_ROLES.has(role)) blockers.push(`role_not_detail:${role}`);
  // Explicit disagreement on the VAT basis of the two operands.
  if (unit_vat !== null && total_vat !== null && unit_vat !== total_vat) blockers.push('vat_basis_mismatch');
  // Explicit disagreement on the discount basis of the two operands.
  if (unit_price_basis !== 'UNKNOWN' && line_total_basis !== 'UNKNOWN' && unit_price_basis !== line_total_basis) blockers.push('discount_basis_mismatch');
  // Legacy-safe inference (discount amount/percent, VAT-inclusive unit, service/rounding text).
  if (hasAlternateLineBase(item)) blockers.push('alternate_base_inferred');

  const comparable = hasOperands && blockers.length === 0;
  const quantity_required = !NON_DETAIL_ROLES.has(role);
  // A row may only join the before-VAT sum when its own total is genuinely a before-VAT figure.
  const before_vat_sum_comparable = !NON_DETAIL_ROLES.has(role) && total_vat !== true && unit_vat !== true && !(role === 'SUMMARY');

  return {
    version: LINE_APPLICABILITY_VERSION,
    line_number: lineNumber,
    role,
    role_source,
    unit_price_basis,
    line_total_basis,
    unit_price_includes_vat: unit_vat,
    line_total_includes_vat: total_vat,
    sign_convention,
    has_operands: hasOperands,
    comparable,
    quantity_required,
    before_vat_sum_comparable,
    blockers,
    reason_code: comparable ? null : (hasOperands ? LINE_APPLICABILITY_REASON_CODES.NOT_COMPARABLE : LINE_APPLICABILITY_REASON_CODES.MISSING_OPERANDS),
    is_credit_note: context.isCreditNote === true
  };
}

/** Compact per-document applicability summary (counts + per-line metadata, no document text). */
export function summarizeLineApplicability(decisions: any[]) {
  const rows = decisions || [];
  return {
    version: LINE_APPLICABILITY_VERSION,
    total_lines: rows.length,
    comparable_lines: rows.filter((d) => d.comparable).length,
    non_comparable_lines: rows.filter((d) => !d.comparable && d.has_operands).length,
    incomplete_lines: rows.filter((d) => !d.has_operands).length,
    quantity_required_lines: rows.filter((d) => d.quantity_required).length,
    sum_comparable_lines: rows.filter((d) => d.before_vat_sum_comparable).length,
    sum_applicable: rows.length > 0 && rows.every((d) => d.before_vat_sum_comparable),
    roles: rows.map((d) => ({ line_number: d.line_number, role: d.role, comparable: d.comparable, reason_code: d.reason_code }))
  };
}