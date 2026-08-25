/**
 * P1-A — FAIL-CLOSED second-pass recovery for CRITICAL invoice header fields.
 *
 * Why: a first pass sometimes misses one printed header field (document number, document date,
 * payable total, supplier identity) on an otherwise readable document. Instead of re-extracting
 * the whole document, this module asks ONLY for the failed fields together with the printed label
 * and evidence that proves them, and then a DETERMINISTIC, FAIL-CLOSED merge decides per field.
 *
 * Hard rules implemented here:
 *  - the second pass runs ONLY when a critical field is deterministically missing/implausible;
 *    a healthy extraction never triggers an extra LLM call;
 *  - first-pass values are PRESERVED and never silently overwritten;
 *  - a recovered value is accepted only with field-appropriate PRINTED-LABEL evidence.
 *    Model confidence is telemetry and is never part of any decision;
 *  - two valid but disagreeing values, or missing/ambiguous evidence → the field stays
 *    unresolved (null) and manual review is forced with a stable reason code;
 *  - invoice_date can never come from a due-date / payment-date label;
 *  - total_with_vat is re-judged by the EXISTING monetary-audit selector (turnover / balance /
 *    summary / VAT-only labels stay disqualified) plus an arithmetic safety check;
 *  - nothing here approves anything: classification guard, supplier resolver, line checks,
 *    duplicate checks and the deterministic validation gate all stay mandatory.
 *
 * Pure module apart from the single clearly-marked LLM helper at the bottom.
 */

import { cleanEvidence, isSentinelValue } from './invoiceSentinelValues.ts';
import { isValidVatIdentifier } from './supplierResolver.ts';
import { roundMoney } from './invoiceExtraction.ts';
import { selectPayableAmounts, isFinalPayableLabel, formatTargetScope } from './invoiceMonetaryAudit.ts';
import { validateProfileDocNumber, profileRecoveryHints } from './invoiceSupplierProfiles.ts';

export const CRITICAL_RECOVERY_VERSION = 'critical-recovery-1.0.0';

/** The only fields this block may ever ask for again. Line items are never requested. */
export const RECOVERABLE_FIELDS = ['supplier_name', 'supplier_vat_id', 'doc_number', 'invoice_date', 'total_with_vat'];

export const RECOVERY_REASON_CODES = {
  NOT_NEEDED: 'CRITICAL_FIELD_RECOVERY_NOT_NEEDED',
  FIRST_PASS_VALID: 'CRITICAL_FIELD_FIRST_PASS_VALID',
  AGREEMENT: 'CRITICAL_FIELD_AGREEMENT',
  RECOVERED: 'CRITICAL_FIELD_RECOVERED',
  CONFLICT: 'CRITICAL_FIELD_CONFLICT',
  UNRESOLVED: 'CRITICAL_FIELD_RECOVERY_UNRESOLVED',
  EVIDENCE_MISSING: 'CRITICAL_FIELD_EVIDENCE_MISSING',
  EVIDENCE_REJECTED: 'CRITICAL_FIELD_EVIDENCE_REJECTED',
  VALUE_IMPLAUSIBLE: 'CRITICAL_FIELD_VALUE_IMPLAUSIBLE'
};

export const RECOVERY_EVENT_OUTCOMES = {
  ATTEMPTED: 'attempted',
  APPLIED: 'applied',
  CONFLICT: 'conflict',
  UNRESOLVED: 'unresolved'
};

/** Deterministic plausibility window for a printed document date. */
const MIN_DOC_DATE = Date.parse('2015-01-01T00:00:00Z');
const FUTURE_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;

// ── Field-appropriate PRINTED-LABEL vocabularies ────────────────────────────
const DOC_NUMBER_LABEL = /(מספר|מס[’'"״]?\s*(חשבונית|מסמך|חשבון)|אסמכתא|invoice\s*(no\.?|number|#)|document\s*(no\.?|number)|doc\s*no|reference\s*(no\.?|number)|#)/i;
const INVOICE_DATE_LABEL = /(תאריך|תארין|invoice\s*date|document\s*date|date\s*of\s*issue|issue\s*date|issued\s*on|\bdate\b)/i;
/** A due / payment-date label can NEVER produce the invoice date. */
const DUE_DATE_LABEL = /(מועד\s*תשלום|תאריך\s*תשלום|לתשלום\s*עד|תנאי\s*תשלום|שוטף\s*\+?\s*\d*|due\s*date|payment\s*date|pay\s*by|payment\s*terms|net\s*\d+)/i;
const VAT_ID_LABEL = /(ח\.?\s*[”"״']?\s*פ|עוסק\s*מורשה|מספר\s*עוסק|ע\.?\s*מ\b|תיק\s*ניכויים|vat\s*(id|no\.?|number|reg\w*)|tax\s*(id|number)|company\s*(id|number|reg\w*)|registration\s*number|business\s*number)/i;
const SUPPLIER_NAME_LABEL = /(שם\s*(ה)?(ספק|חברה|החברה|עוסק|העוסק|מוכר|המוכר)|ספק|מאת|מטעם|עוסק|from|vendor|supplier|seller|billed\s*by|issued\s*by|company\s*name)/i;

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function str(value: unknown): string {
  return cleanEvidence(value);
}

/** ISO yyyy-mm-dd, a real calendar date, inside the plausible window. */
export function isPlausibleDocDate(value: unknown, now: string | number | Date = new Date()): boolean {
  const raw = str(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed)) return false;
  if (new Date(parsed).toISOString().slice(0, 10) !== raw) return false;
  if (parsed < MIN_DOC_DATE) return false;
  return parsed <= new Date(now).getTime() + FUTURE_TOLERANCE_MS;
}

/** Same contract the validation gate uses: 2–40 chars, at least one digit, no sentinels. */
export function isPlausibleDocNumberValue(value: unknown): boolean {
  const raw = str(value);
  if (!raw || raw.length < 2 || raw.length > 40) return false;
  return /\d/.test(raw);
}

export function isPlausibleTotalValue(value: unknown): boolean {
  return isFiniteNumber(value);
}

/** A readable supplier name — sentinels and 1-character noise are not evidence. */
export function isUsableSupplierName(value: unknown): boolean {
  return str(value).length >= 2;
}

/**
 * Deterministic decision on whether a second pass is allowed AND which fields it may request.
 * Returns needed:false for a healthy extraction and for anything the classification guard
 * already sent to OTHER / skip — recovery can never revive a skipped document.
 */
export function planCriticalFieldRecovery(extraction: any = {}, options: any = {}) {
  const now = options.now || new Date();
  const skipped = extraction?.should_skip === true || String(extraction?.classification || '').toUpperCase() === 'OTHER';

  const missing: any[] = [];
  const supplierName = isUsableSupplierName(extraction?.supplier_name);
  const supplierVat = isValidVatIdentifier(extraction?.supplier_vat_id);
  const supplierUnresolved = options.supplier_unresolved === true;
  if (!supplierVat && (!supplierName || supplierUnresolved)) {
    missing.push({ field: 'supplier_name', reason: 'זהות הספק אינה קריאה מהמסמך.' });
    missing.push({ field: 'supplier_vat_id', reason: 'לא נקרא ח.פ/מספר עוסק תקין.' });
  }
  if (!isPlausibleDocNumberValue(extraction?.doc_number)) {
    missing.push({ field: 'doc_number', reason: 'מספר המסמך חסר או לא סביר.' });
  } else if (options.profile_match) {
    // P1-B: a generically plausible number can still be implausible for a RELIABLY matched
    // supplier profile. That requests doc_number recovery ONLY — never a pattern-based repair.
    const profileCheck = validateProfileDocNumber(options.profile_match, extraction?.doc_number);
    if (profileCheck.applicable && !profileCheck.valid) {
      missing.push({ field: 'doc_number', reason: profileCheck.reason, reason_code: profileCheck.reason_code });
    }
  }
  const dateValue = extraction?.invoice_date ?? extraction?.doc_date;
  if (!isPlausibleDocDate(dateValue, now)) {
    missing.push({ field: 'invoice_date', reason: 'תאריך המסמך חסר או לא סביר.' });
  }
  if (!isPlausibleTotalValue(extraction?.total_with_vat)) {
    missing.push({ field: 'total_with_vat', reason: 'הסכום לתשלום חסר או לא תקין.' });
  }

  const request_fields = skipped ? [] : missing.map((m) => m.field);
  return {
    version: CRITICAL_RECOVERY_VERSION,
    needed: request_fields.length > 0,
    skipped_document: skipped,
    request_fields,
    missing_fields: skipped ? [] : missing,
    reasons_he: skipped ? ['המסמך סווג כלא רלוונטי ולכן לא בוצע ניסיון השלמה.'] : missing.map((m) => m.reason)
  };
}

// ── Second-pass contract ────────────────────────────────────────────────────

export const RECOVERY_SCHEMA = {
  type: 'object',
  properties: {
    request_fields: { type: 'array', items: { type: 'string' } },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          raw_value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          normalized_value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          printed_label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          evidence_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          evidence_location: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          found: { type: 'boolean' },
          confidence: { anyOf: [{ type: 'number' }, { type: 'null' }] }
        },
        required: ['field', 'found']
      }
    },
    notes: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  },
  required: ['fields'],
  additionalProperties: true
};

/**
 * Narrow prompt: only the failed fields, only printed evidence, never line items.
 * With a targetScope (multi-invoice file) every returned field and its evidence is restricted
 * to that ONE invoice, and fields belonging to any other invoice in the file must be refused.
 */
export function buildRecoveryPrompt(requestFields: string[] = [], targetScope?: any, profileHints?: any): string {
  const fields = requestFields.filter((f) => RECOVERABLE_FIELDS.includes(f));
  const perField: Record<string, string> = {
    supplier_name: `- supplier_name: the ISSUING supplier/vendor legal or trade name as printed in the document header ("שם הספק", "מאת", "From", "Vendor"). NEVER the recipient/customer ("לכבוד", "Bill to").`,
    supplier_vat_id: `- supplier_vat_id: the ISSUING supplier's company / VAT / dealer id as printed ("ח.פ", "עוסק מורשה", "ע.מ", "VAT no", "Tax ID"). NEVER the recipient's id, never a phone/bank/invoice number.`,
    doc_number: `- doc_number: the document's own number as printed next to a number label ("מספר חשבונית", "מס' מסמך", "Invoice No", "#"). NEVER an order/customer/phone/bank/page number.`,
    invoice_date: `- invoice_date: the DOCUMENT/ISSUE date only ("תאריך", "תאריך החשבונית", "Invoice Date", "Date of issue"), normalized to YYYY-MM-DD. CRITICAL: if the only date printed is a PAYMENT/DUE date ("מועד תשלום", "לתשלום עד", "Due Date", "שוטף + 30"), report found = false. A due date is NEVER the invoice date.`,
    total_with_vat: `- total_with_vat: the final amount THIS document demands to be paid, with the EXACT printed label copied verbatim into printed_label ("סה״כ לתשלום", "סה״כ כולל מע״מ", "Amount Due", "Total"). CRITICAL: turnover / מחזור / סכום עסקאות / previous balance / יתרה / account summary / credit limit / settlement-deposit / a VAT-only line / a before-VAT subtotal are NEVER this value — if only those are printed, report found = false.`
  };

  const scopeText = formatTargetScope(targetScope);
  const scopeBlock = scopeText ? `

TARGET SCOPE (MANDATORY)
This file contains MORE THAN ONE invoice/document. Recover fields ONLY from the following target:
${scopeText}
- Every value, printed_label and evidence_text you return MUST come from that target invoice only.
- Any field printed on a DIFFERENT invoice/page/document inside this file MUST be refused: set found = false. Cross-invoice evidence is forbidden, not even as context.
- If you cannot confidently isolate the target invoice, set found = false for every requested field rather than mixing documents.
- All other rules below still apply exactly as stated.` : '';

  // P1-B hints NARROW where to look. They are never positive evidence, never an expected value,
  // and can never turn a due/payment date into the invoice date.
  const hintLines = profileHints ? [
    profileHints.doc_number_patterns?.length ? `- doc_number reference shapes seen from this supplier: ${profileHints.doc_number_patterns.join(' , ')} (prefixes: ${(profileHints.reference_prefixes || []).join(', ') || 'none'}). Read what is PRINTED; if the printed number does not fit these shapes, report exactly what is printed. NEVER add, delete or change a digit to make it fit.` : '',
    profileHints.invoice_date_labels?.length ? `- invoice_date is usually labelled: ${profileHints.invoice_date_labels.join(' / ')}. A payment/due label still means found = false.` : '',
    profileHints.payable_total_labels?.length ? `- total_with_vat is usually labelled: ${profileHints.payable_total_labels.join(' / ')}.` : ''
  ].filter(Boolean) : [];
  const hintBlock = hintLines.length ? `

SUPPLIER LABEL HINTS (WHERE TO LOOK ONLY — NOT EVIDENCE, NOT EXPECTED VALUES)
${hintLines.join('\n')}
- These hints never justify a value: only what is actually printed in this document counts. If the printed evidence is missing, report found = false.` : '';

  return `SYSTEM / INSTRUCTION

You are a NARROW FIELD RECOVERY engine for ONE business document.${scopeBlock}${hintBlock} A first extraction pass failed to read a small number of CRITICAL header fields. You do ONE job: look at the attached document again and report ONLY those fields, each with the exact printed evidence that proves it.

INPUT
ONE document file (PDF/JPG/PNG) is attached. Read ONLY what is printed in it.
You are given NO expected values. Never guess, never calculate, never infer from context.

REQUEST_FIELDS (report exactly these, nothing else)
${fields.map((f) => perField[f]).join('\n')}

DO NOT extract line items, products, quantities, subtotals, VAT breakdowns, due dates, summaries or any field not listed above.

FOR EACH REQUESTED FIELD RETURN:
- field: the field name exactly as listed above
- found: true only if the value is PRINTED in the document and you located it
- raw_value: the value exactly as printed (verbatim)
- normalized_value: normalized form (dates as YYYY-MM-DD; amounts as a number with '.' decimal and no currency symbol or thousands separators; text trimmed)
- printed_label: the EXACT label text printed immediately next to / above that value, copied verbatim (Hebrew stays Hebrew). If no label is printed, use null.
- evidence_text: a short verbatim quote from the document containing the label and the value
- evidence_location: short hint where it appears (page/section/header/footer), or null
- confidence: 0-100 telemetry only

ABSOLUTE RULES
1) If the field is not printed, or you cannot see a label that proves what it is, set found = false and every value to null. Reporting "not found" is CORRECT behaviour; guessing is a failure.
2) Never copy a value from a different document, page or invoice inside this file.
3) Never derive one field from another (no due date as invoice date, no turnover as total, no subtotal as total).
4) Never return placeholder strings such as "null", "N/A", "-", "unknown". Use found = false instead.

OUTPUT
Output ONLY one valid JSON object matching the requested schema. No markdown, no commentary.`;
}

// ── Deterministic, fail-closed merge ────────────────────────────────────────

function normalizeCandidate(field: string, candidate: any) {
  const rawValue = candidate?.normalized_value ?? candidate?.raw_value ?? null;
  const label = str(candidate?.printed_label);
  const evidenceText = str(candidate?.evidence_text);
  const found = candidate?.found === true;
  let value: any = null;
  if (field === 'total_with_vat') {
    const numeric = typeof rawValue === 'number' ? rawValue : (isSentinelValue(rawValue) ? NaN : Number(String(rawValue).replace(/[^\d.\-]/g, '')));
    value = Number.isFinite(numeric) ? roundMoney(numeric) : null;
  } else {
    value = str(rawValue) || null;
  }
  return {
    field,
    found,
    value,
    printed_label: label || null,
    evidence_text: evidenceText || null,
    evidence_location: str(candidate?.evidence_location) || null,
    confidence: isFiniteNumber(candidate?.confidence) ? candidate.confidence : null
  };
}

function isValueValid(field: string, value: any, context: any) {
  switch (field) {
    case 'doc_number': return isPlausibleDocNumberValue(value);
    case 'invoice_date': return isPlausibleDocDate(value, context.now);
    case 'total_with_vat': return isPlausibleTotalValue(value);
    case 'supplier_vat_id': return isValidVatIdentifier(value);
    case 'supplier_name': return isUsableSupplierName(value);
    default: return false;
  }
}

/**
 * Field-appropriate printed evidence. Purely deterministic — the model's confidence is ignored.
 * total_with_vat is delegated to the EXISTING monetary-audit selector so the payable-label,
 * turnover, balance, summary and VAT-only exclusions stay authoritative and are not restated here.
 */
function evaluateEvidence(field: string, candidate: any, context: any) {
  const label = candidate.printed_label || '';
  const evidence = `${label} ${candidate.evidence_text || ''}`.trim();
  if (!label && !candidate.evidence_text) {
    return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'לא הוחזר תיוג מודפס או ציטוט מהמסמך.' };
  }

  if (field === 'invoice_date') {
    if (DUE_DATE_LABEL.test(evidence)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, reason: 'התיוג מצביע על מועד תשלום ולא על תאריך המסמך.' };
    }
    if (!INVOICE_DATE_LABEL.test(label)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'אין תיוג מודפס של תאריך מסמך.' };
    }
    const due = str(context.extraction?.due_date);
    if (due && due === candidate.value) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, reason: 'התאריך שהוחזר זהה למועד התשלום ולכן נדחה.' };
    }
    return { ok: true };
  }

  if (field === 'doc_number') {
    if (!DOC_NUMBER_LABEL.test(label)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'אין תיוג מודפס של מספר מסמך.' };
    }
    return { ok: true };
  }

  if (field === 'supplier_vat_id') {
    if (!VAT_ID_LABEL.test(label)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'אין תיוג מודפס של ח.פ/מספר עוסק.' };
    }
    return { ok: true };
  }

  if (field === 'supplier_name') {
    if (!SUPPLIER_NAME_LABEL.test(evidence)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'אין תיוג מודפס המזהה את שם הספק המנפיק.' };
    }
    return { ok: true };
  }

  if (field === 'total_with_vat') {
    // The synthetic document_payable role below is NOT trusted on its own: the printed label must
    // first pass the authoritative final-payable predicate, so a before-VAT/subtotal, VAT-only,
    // turnover, transactions, settlement, balance, summary or credit-limit label is rejected here
    // even though the candidate is presented as payable.
    if (!isFinalPayableLabel(label)) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, reason: `התיוג "${label || 'ללא תיוג'}" אינו תיוג של סכום סופי לתשלום.` };
    }
    // Reuse of the authoritative monetary selector: the recovered amount must ALSO survive it as a
    // labelled document_payable candidate.
    const selection = selectPayableAmounts({
      document_kind: 'standard_invoice',
      ambiguous: false,
      candidates: [{ amount: candidate.value, printed_label: label, role: 'document_payable', in_document_totals_block: true, location_hint: candidate.evidence_location }]
    });
    if (selection.total === null || selection.total !== candidate.value) {
      return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, reason: `התיוג "${label || 'ללא תיוג'}" אינו סכום לתשלום לפי כללי ביקורת הסכומים.` };
    }
    // Arithmetic safety: an existing printed breakdown must still close on the recovered total.
    const sub = context.extraction?.subtotal_before_vat;
    const vat = context.extraction?.vat_amount;
    if (isFiniteNumber(sub) && isFiniteNumber(vat)) {
      const signed = Math.round(Math.abs(sub + vat - candidate.value) * 100) / 100;
      const magnitude = Math.round(Math.abs(Math.abs(sub) + Math.abs(vat) - Math.abs(candidate.value)) * 100) / 100;
      if (Math.min(signed, magnitude) > 0.02) {
        return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, reason: `הסכום שהושלם (${candidate.value}) אינו מתיישב עם לפני מע״מ + מע״מ שנקראו מהמסמך.` };
      }
    }
    return { ok: true };
  }

  return { ok: false, reason_code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, reason: 'שדה שאינו נתמך להשלמה.' };
}

function firstPassValue(field: string, extraction: any) {
  if (field === 'invoice_date') return str(extraction?.invoice_date ?? extraction?.doc_date) || null;
  if (field === 'total_with_vat') return isFiniteNumber(extraction?.total_with_vat) ? roundMoney(extraction.total_with_vat) : null;
  return str(extraction?.[field]) || null;
}

function sameValue(field: string, a: any, b: any) {
  if (a === null || b === null) return false;
  if (field === 'total_with_vat') return Math.abs(Number(a) - Number(b)) <= 0.02;
  if (field === 'supplier_name') return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (field === 'supplier_vat_id') return String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
  return String(a).trim() === String(b).trim();
}

/**
 * PURE merge. Returns one decision per requested field plus the values that may be applied.
 * Nothing is mutated here, nothing is approved here.
 */
export function mergeCriticalFieldRecovery({ extraction = {}, plan, second = null, now = new Date() }: any) {
  const requested: string[] = Array.isArray(plan?.request_fields) ? plan.request_fields : [];
  const context = { extraction, now };
  const byField = new Map<string, any>();
  for (const raw of (Array.isArray(second?.fields) ? second.fields : [])) {
    const field = String(raw?.field || '').trim();
    if (RECOVERABLE_FIELDS.includes(field) && !byField.has(field)) byField.set(field, normalizeCandidate(field, raw));
  }

  const decisions: any[] = [];
  const apply: Record<string, any> = {};
  const unresolved: string[] = [];
  const conflicts: string[] = [];
  const review_reasons_he: string[] = [];

  for (const field of requested) {
    const first = firstPassValue(field, extraction);
    const firstValid = first !== null && isValueValid(field, first, context);
    const candidate = byField.get(field) || null;
    const secondValue = candidate?.found ? candidate.value : null;
    const secondValid = secondValue !== null && isValueValid(field, secondValue, context);

    const decision: any = {
      field,
      first_pass: { value: first, valid: firstValid },
      second_pass: candidate
        ? { value: secondValue, valid: secondValid, printed_label: candidate.printed_label, evidence_text: candidate.evidence_text, evidence_location: candidate.evidence_location, confidence: candidate.confidence }
        : null,
      selected_value: null,
      selected_source: null,
      reason_code: RECOVERY_REASON_CODES.UNRESOLVED,
      reason: null
    };

    if (firstValid && secondValid && sameValue(field, first, secondValue)) {
      decision.selected_value = first;
      decision.selected_source = 'FIRST_PASS';
      decision.reason_code = RECOVERY_REASON_CODES.AGREEMENT;
      decision.reason = 'שני המעברים קראו את אותו ערך תקין; נשמר ערך המעבר הראשון.';
    } else if (firstValid && secondValid) {
      // Two valid, disagreeing readings → fail closed, keep BOTH candidates for the reviewer.
      decision.reason_code = RECOVERY_REASON_CODES.CONFLICT;
      decision.reason = `סתירה בין המעברים: "${first}" מול "${secondValue}".`;
      conflicts.push(field);
      review_reasons_he.push(`${RECOVERY_REASON_CODES.CONFLICT} (${field}): ${decision.reason}`);
    } else if (firstValid) {
      decision.selected_value = first;
      decision.selected_source = 'FIRST_PASS';
      decision.reason_code = RECOVERY_REASON_CODES.FIRST_PASS_VALID;
      decision.reason = 'ערך המעבר הראשון תקין ונשמר.';
    } else if (secondValid) {
      const evidence = evaluateEvidence(field, candidate, context);
      if (evidence.ok) {
        decision.selected_value = secondValue;
        decision.selected_source = 'SECOND_PASS';
        decision.reason_code = RECOVERY_REASON_CODES.RECOVERED;
        decision.reason = `הושלם מהמסמך לפי תיוג מודפס: "${candidate.printed_label || candidate.evidence_text}".`;
        apply[field] = secondValue;
      } else {
        decision.reason_code = evidence.reason_code;
        decision.reason = evidence.reason;
        unresolved.push(field);
        review_reasons_he.push(`${RECOVERY_REASON_CODES.UNRESOLVED} (${field}): ${evidence.reason}`);
      }
    } else {
      decision.reason_code = candidate && candidate.found && !secondValid
        ? RECOVERY_REASON_CODES.VALUE_IMPLAUSIBLE
        : RECOVERY_REASON_CODES.UNRESOLVED;
      decision.reason = candidate && candidate.found
        ? 'הערך שהוחזר במעבר השני אינו תקין/סביר ולכן נדחה.'
        : 'הערך אינו מודפס במסמך או לא אותר במעבר השני.';
      unresolved.push(field);
      review_reasons_he.push(`${RECOVERY_REASON_CODES.UNRESOLVED} (${field}): ${decision.reason}`);
    }

    decisions.push(decision);
  }

  const applied_fields = Object.keys(apply);
  return {
    version: CRITICAL_RECOVERY_VERSION,
    requested_fields: requested,
    decisions,
    apply,
    applied_fields,
    unresolved_fields: unresolved,
    conflict_fields: conflicts,
    // Fail-closed: any conflict or unresolved critical field forces manual review. A recovered
    // value never approves anything on its own — the gate still decides.
    requires_manual_review: conflicts.length > 0 || unresolved.length > 0,
    review_reasons_he,
    outcome: conflicts.length ? RECOVERY_EVENT_OUTCOMES.CONFLICT
      : (unresolved.length ? RECOVERY_EVENT_OUTCOMES.UNRESOLVED
        : (applied_fields.length ? RECOVERY_EVENT_OUTCOMES.APPLIED : RECOVERY_EVENT_OUTCOMES.ATTEMPTED))
  };
}

/**
 * Applies ONLY the accepted values onto the extraction object and attaches compact metadata.
 * Never touches classification, line items, due_date, subtotal or VAT, and never removes the
 * first-pass candidate (it is preserved inside extraction.critical_field_recovery.decisions).
 */
export function applyCriticalFieldRecovery(extraction: any, merge: any) {
  for (const [field, value] of Object.entries(merge?.apply || {})) {
    if (field === 'invoice_date') {
      extraction.invoice_date = value;
      extraction.doc_date = value;
    } else {
      extraction[field] = value;
    }
  }
  extraction.critical_field_recovery = {
    version: merge?.version || CRITICAL_RECOVERY_VERSION,
    requested_fields: merge?.requested_fields || [],
    applied_fields: merge?.applied_fields || [],
    unresolved_fields: merge?.unresolved_fields || [],
    conflict_fields: merge?.conflict_fields || [],
    requires_manual_review: merge?.requires_manual_review === true,
    outcome: merge?.outcome || RECOVERY_EVENT_OUTCOMES.ATTEMPTED,
    review_reasons_he: merge?.review_reasons_he || [],
    decisions: merge?.decisions || []
  };
  return extraction;
}

/**
 * IMPURE helper — the ONLY LLM call in this module. Same original file, gpt_5_mini,
 * no internet context, narrow request. Callers must first check plan.needed === true.
 */
export async function runCriticalFieldRecovery(base44: any, fileUrl: string, requestFields: string[], model = 'gpt_5_mini', targetScope?: any, profileHints?: any) {
  let result = await base44.integrations.Core.InvokeLLM({
    prompt: buildRecoveryPrompt(requestFields, targetScope, profileHints),
    add_context_from_internet: false,
    response_json_schema: RECOVERY_SCHEMA,
    file_urls: [fileUrl],
    model
  });
  if (result && typeof result === 'object' && result.response && Array.isArray(result.response.fields)) result = result.response;
  return result;
}

/**
 * Convenience orchestration used by the production routes and the dry run:
 * plan → (only if needed) narrow second pass → pure merge → apply accepted values.
 * A failed second pass degrades to "unresolved" and manual review, never to a guess.
 */
export async function recoverCriticalFields(base44: any, extraction: any, fileUrl: string, options: any = {}) {
  const plan = planCriticalFieldRecovery(extraction, options);
  if (!plan.needed) {
    extraction.critical_field_recovery = { version: CRITICAL_RECOVERY_VERSION, requested_fields: [], applied_fields: [], unresolved_fields: [], conflict_fields: [], requires_manual_review: false, outcome: RECOVERY_REASON_CODES.NOT_NEEDED, review_reasons_he: [], decisions: [] };
    return { plan, second: null, merge: null, attempted: false };
  }
  let second: any = null;
  let error: string | null = null;
  try {
    // options.target_scope is passed ONLY for multi-invoice files, so the narrow second pass is
    // restricted to the same invoice the extraction and monetary audit were scoped to.
    second = await runCriticalFieldRecovery(base44, fileUrl, plan.request_fields, options.model || 'gpt_5_mini', options.target_scope, profileRecoveryHints(options.profile_match));
  } catch (err: any) {
    error = err?.message || String(err);
  }
  const merge = mergeCriticalFieldRecovery({ extraction, plan, second, now: options.now || new Date() });
  applyCriticalFieldRecovery(extraction, merge);
  if (error) {
    extraction.critical_field_recovery.error = error;
    extraction.critical_field_recovery.requires_manual_review = true;
  }
  return { plan, second, merge, attempted: true, error };
}