/**
 * Deterministic gate that decides whether the second-pass MONETARY AUDIT must run.
 *
 * The audit exists because a first pass often grabs a turnover / balance / summary figure as the
 * payable total. It costs a full extra model call per document, so it is skipped ONLY when the
 * first pass already produced a self-proving, label-backed and arithmetically closed set of
 * amounts. Everything else — any doubt whatsoever — still runs the audit (fail-closed).
 *
 * No supplier names, no expected values, no "largest amount" logic. Printed label + arithmetic only.
 * This module deliberately imports nothing: the label predicate is injected by the caller so the
 * audit module stays the single owner of label semantics.
 */

export const MONETARY_AUDIT_GATE_VERSION = 'monetary-audit-gate-1.0.0';

/** Rounding-only tolerance for subtotal + VAT = total. */
const TOLERANCE = 0.02;

/** Israeli VAT rates that may legitimately appear (18% current, 17% historic, 0% zero-rated). */
const PLAUSIBLE_VAT_RATES = [0.18, 0.17, 0];
const VAT_RATE_TOLERANCE = 0.005;

const SIMPLE_KINDS = new Set(['TAX_INVOICE', 'CREDIT_NOTE']);

function isNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Returns { needs_audit, reason_code, reason_he }.
 * needs_audit === false means the first-pass amounts stand on their own printed evidence.
 * isPayableLabel must be the audit module's own printed-label predicate.
 */
export function planMonetaryAudit(extraction: any, isPayableLabel: (label: unknown) => boolean) {
  const need = (reason_code: string, reason_he: string) => ({ needs_audit: true, reason_code, reason_he });

  if (!extraction || typeof extraction !== 'object') return need('NO_EXTRACTION', 'אין נתוני חילוץ.');
  if (typeof isPayableLabel !== 'function') return need('NO_LABEL_PREDICATE', 'אין בודק תיוג מודפס.');

  if (!SIMPLE_KINDS.has(String(extraction.classification || ''))) {
    return need('NON_SIMPLE_DOCUMENT', 'המסמך אינו חשבונית מס/זיכוי פשוטה.');
  }

  const sub = extraction.subtotal_before_vat;
  const vat = extraction.vat_amount;
  const total = extraction.total_with_vat;
  if (!isNum(sub) || !isNum(vat) || !isNum(total)) {
    return need('INCOMPLETE_BREAKDOWN', 'חסר פירוט מלא של לפני מע״מ / מע״מ / סה״כ.');
  }

  // A document that also prints a transactions / activity / deposits table can hide a turnover
  // figure that looks like a total — those always go through the audit.
  if (extraction.has_transactions_table === true) {
    return need('TRANSACTIONS_TABLE', 'המסמך מכיל טבלת עסקאות/פעילות ולכן נדרשת ביקורת סכומים.');
  }

  // The printed label next to the total must positively state it is the amount to pay.
  if (!isPayableLabel(extraction.total_printed_label)) {
    return need('NO_PAYABLE_LABEL', 'אין תיוג מודפס מפורש של סכום לתשלום ליד הסה״כ.');
  }

  // Arithmetic must close (magnitudes too, so a credit note's sign convention cannot break it).
  const signed = Math.abs(sub + vat - total);
  const magnitude = Math.abs(Math.abs(sub) + Math.abs(vat) - Math.abs(total));
  if (Math.min(signed, magnitude) > TOLERANCE) {
    return need('ARITHMETIC_MISMATCH', 'לפני מע״מ + מע״מ אינם שווים לסה״כ.');
  }

  // The VAT share must be a plausible statutory rate — an arbitrary ratio means the figures are
  // probably not a real charge block.
  const vatBase = Math.abs(sub);
  if (vatBase > 0) {
    const rate = Math.abs(vat) / vatBase;
    if (!PLAUSIBLE_VAT_RATES.some((r) => Math.abs(rate - r) <= VAT_RATE_TOLERANCE)) {
      return need('IMPLAUSIBLE_VAT_RATE', 'שיעור המע״מ שחולץ אינו שיעור חוקי מוכר.');
    }
  } else if (Math.abs(vat) > TOLERANCE) {
    return need('IMPLAUSIBLE_VAT_RATE', 'קיים מע״מ ללא סכום לפני מע״מ.');
  }

  return {
    needs_audit: false,
    reason_code: 'FIRST_PASS_SELF_PROVING',
    reason_he: 'הסכומים מהמעבר הראשון נתמכים בתיוג מודפס ומסתדרים אריתמטית; ביקורת הסכומים לא נדרשה.'
  };
}

/** Provenance written when the audit is skipped, so the audit trail stays complete. */
export function buildSkippedAuditProvenance(extraction: any, plan: any, auditVersion: string) {
  return {
    audit_version: auditVersion,
    gate_version: MONETARY_AUDIT_GATE_VERSION,
    audit_skipped: true,
    ambiguous: false,
    candidates: [],
    total_evidence_label: extraction?.total_printed_label ?? null,
    total_evidence_role: 'document_payable',
    subtotal_evidence_label: null,
    vat_evidence_label: null,
    reasons: [plan?.reason_he].filter(Boolean)
  };
}