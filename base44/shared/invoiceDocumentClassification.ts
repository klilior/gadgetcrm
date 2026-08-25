/**
 * D3a — deterministic document-classification guard (pure, DB-free, supplier-agnostic).
 *
 * Only two document kinds may be processed: חשבונית מס (tax invoice) and חשבונית זיכוי
 * (credit note). This guard downgrades anything else to OTHER using GENERAL printed-title
 * rules only — never an invoice id, supplier name or file name:
 *  - a receipt / delivery note / statement / order-confirmation style document stays OTHER;
 *  - a generic "Invoice" title (no tax-invoice qualification anywhere) stays OTHER;
 *  - an explicit "חשבונית מס" / "Tax Invoice" (or "חשבונית זיכוי" / "Credit Note") is supported.
 */

export const SUPPORTED_DOC_TYPES = ['חשבונית מס', 'חשבונית זיכוי'];

export const CLASSIFICATION_GUARD_VERSION = 'classification-guard-1.0.0';

export const CLASSIFICATION_REASON_CODES = {
  NON_TAX_DOCUMENT: 'NON_TAX_DOCUMENT',
  GENERIC_INVOICE_TITLE: 'GENERIC_INVOICE_TITLE',
  UNSUPPORTED_DOC_TYPE: 'UNSUPPORTED_DOC_TYPE'
};

/**
 * Titles that are never a tax invoice / credit note, whatever amounts they carry.
 * Exported so P1-E classification recovery uses the SAME patterns (never a copy).
 */
export const NON_TAX_TITLE_PATTERN = /(קבלה|חשבון\s*עסקה|דרישת\s*תשלום|תעודת\s*משלוח|תעודת\s*החזרה|שובר|הזמנת\s*רכש|הזמנה|הצעת\s*מחיר|דוח|ריכוז|הודעת\s*חיוב|receipt|payment\s*confirmation|delivery\s*note|packing\s*slip|proforma|pro\s*forma|quote|quotation|purchase\s*order|order\s*confirmation|statement|report|remittance|העברה\s*בנקאית|העברת\s*תשלום|סיכום\s*חשבון|ריכוז\s*תשלומים|bank\s*transfer|wire\s*transfer|payment\s*advice|account\s*summary)/i;

/** Explicit tax-invoice qualification. A bare "Invoice"/"חשבונית" is NOT one of these. */
export const TAX_INVOICE_TITLE_PATTERN = /(חשבונית\s*מס|חשבונית-מס|מס\s*\/?\s*קבלה|tax\s*invoice|vat\s*invoice)/i;

export const CREDIT_NOTE_TITLE_PATTERN = /(חשבונית\s*זיכוי|חשבון\s*זיכוי|תעודת\s*זיכוי|credit\s*note|credit\s*memo)/i;

/** A bare, unqualified "Invoice" / "חשבונית" heading — never upgradable. */
export const GENERIC_INVOICE_TITLE_PATTERN = /(^|[\s:#\-])(invoice|חשבונית)([\s:#\-]|$)/i;

/**
 * The ONE recognized supported Israeli combined title that legitimately contains the word
 * "קבלה" — a tax-receipt. It is a NARROW exception: it consumes only its own phrase.
 */
export const TAX_RECEIPT_TITLE_PATTERN = /(חשבונית\s*מס\s*[\/\\|,\-–]?\s*קבלה|מס\s*[\/\\|\-–]\s*קבלה)/i;

/**
 * THE single shared printed-title verdict, owned here and used by BOTH the strict guard and P1-E
 * classification recovery so the two can never diverge.
 *
 * PRECEDENCE:
 *  1. The recognized tax-receipt phrase is consumed (only that phrase).
 *  2. Any explicit negative phrase REMAINING afterwards blocks — even when a positive phrase is
 *     also printed ("Tax Invoice / Delivery Note", "חשבונית מס/קבלה - תעודת משלוח").
 *  3. A tax-receipt phrase with nothing negative left is a positive TAX_INVOICE.
 *  4. Otherwise: explicit positive tax/credit → positive; bare generic → generic.
 *
 * @returns { present, verdict: 'absent'|'negative'|'positive'|'ambiguous'|'generic'|'not_positive', type }
 */
export function evaluateTitleVerdict(rawTitle: unknown) {
  const title = String(rawTitle ?? '').trim();
  if (!title) return { present: false, verdict: 'absent', type: null };

  const isTaxReceipt = TAX_RECEIPT_TITLE_PATTERN.test(title);
  // Consume ONLY the recognized tax-receipt phrase, then judge what is left.
  const residual = isTaxReceipt
    ? title.replace(new RegExp(TAX_RECEIPT_TITLE_PATTERN.source, 'gi'), ' ')
    : title;
  if (NON_TAX_TITLE_PATTERN.test(residual)) return { present: true, verdict: 'negative', type: null };
  if (isTaxReceipt) return { present: true, verdict: 'positive', type: 'TAX_INVOICE' };

  const isTax = TAX_INVOICE_TITLE_PATTERN.test(title);
  const isCredit = CREDIT_NOTE_TITLE_PATTERN.test(title);
  if (isCredit && !isTax) return { present: true, verdict: 'positive', type: 'CREDIT_NOTE' };
  if (isTax && !isCredit) return { present: true, verdict: 'positive', type: 'TAX_INVOICE' };
  if (isTax && isCredit) return { present: true, verdict: 'ambiguous', type: null };
  if (GENERIC_INVOICE_TITLE_PATTERN.test(title)) return { present: true, verdict: 'generic', type: null };
  return { present: true, verdict: 'not_positive', type: null };
}

function text(...values: unknown[]): string {
  return values
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v))
    .join(' \n ')
    .trim();
}

export function isSupportedDocType(docTypeHe: unknown): boolean {
  return SUPPORTED_DOC_TYPES.includes(String(docTypeHe ?? '').trim());
}

/**
 * @param input { classification, doc_type_he, document_title, display_summary_he }
 *   document_title = the printed title/heading evidence the extraction reported (may be null).
 * @returns { classification, doc_type_he, should_skip, skip_reason_he, downgraded, reason_code }
 */
export function evaluateDocumentClassification(input: any = {}) {
  const claimed = String(input.classification ?? '').trim().toUpperCase();
  // The PRINTED title is authoritative when it exists: the model's own doc_type_he claim may not
  // upgrade a receipt or a bare "Invoice" into a tax invoice. Only when no title was reported do
  // we fall back to the claimed type / summary text.
  const printedTitle = text(input.document_title);
  const evidence = printedTitle || text(input.doc_type_he, input.display_summary_he);
  const supported = claimed === 'TAX_INVOICE' || claimed === 'CREDIT_NOTE';

  const otherResult = (reason_code: string, skip_reason_he: string) => ({
    classification: 'OTHER',
    doc_type_he: null,
    should_skip: true,
    skip_reason_he,
    downgraded: supported,
    reason_code,
    guard_version: CLASSIFICATION_GUARD_VERSION
  });

  if (!supported) {
    return otherResult(CLASSIFICATION_REASON_CODES.UNSUPPORTED_DOC_TYPE, 'המסמך אינו חשבונית מס או חשבונית זיכוי ולכן דולג.');
  }

  // ONE shared verdict, computed once from the same evidence, decides everything below:
  // a negative phrase blocks even alongside a positive one, and the claimed type must MATCH the
  // printed type exactly. Anything else (ambiguous / generic / not positive / wrong type) fails closed.
  const verdict = evaluateTitleVerdict(evidence);

  if (verdict.verdict === 'negative') {
    return otherResult(CLASSIFICATION_REASON_CODES.NON_TAX_DOCUMENT, 'המסמך הוא קבלה/אסמכתא שאינה חשבונית מס ולכן דולג.');
  }

  const positiveType = verdict.verdict === 'positive' ? verdict.type : null;

  if (claimed === 'CREDIT_NOTE') {
    if (positiveType !== 'CREDIT_NOTE') {
      return otherResult(CLASSIFICATION_REASON_CODES.GENERIC_INVOICE_TITLE, 'לא נמצא תיוג מודפס מפורש וחד-משמעי של חשבונית זיכוי ולכן המסמך דולג.');
    }
    return { classification: 'CREDIT_NOTE', doc_type_he: 'חשבונית זיכוי', should_skip: false, skip_reason_he: null, downgraded: false, reason_code: null, guard_version: CLASSIFICATION_GUARD_VERSION };
  }

  // TAX_INVOICE requires an explicit, unambiguous tax qualification (a tax-receipt counts);
  // a generic "Invoice" heading or a credit-note title is not enough.
  if (positiveType !== 'TAX_INVOICE') {
    return otherResult(CLASSIFICATION_REASON_CODES.GENERIC_INVOICE_TITLE, 'המסמך אינו נושא תיוג מודפס חד-משמעי של "חשבונית מס" ולכן דולג.');
  }
  return { classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', should_skip: false, skip_reason_he: null, downgraded: false, reason_code: null, guard_version: CLASSIFICATION_GUARD_VERSION };
}

/** Applies the guard onto an extraction object in place; returns the guard result. */
export function applyDocumentClassificationGuard(extraction: any) {
  const result = evaluateDocumentClassification({
    classification: extraction?.classification,
    doc_type_he: extraction?.doc_type_he,
    document_title: extraction?.document_title,
    display_summary_he: extraction?.display_summary_he
  });
  extraction.classification = result.classification;
  extraction.doc_type_he = result.doc_type_he;
  if (result.should_skip) {
    extraction.should_skip = true;
    extraction.skip_reason_he = extraction.skip_reason_he || result.skip_reason_he;
  }
  extraction.classification_guard = result;
  return result;
}