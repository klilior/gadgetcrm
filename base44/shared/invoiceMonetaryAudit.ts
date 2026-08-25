/**
 * Second-pass MONETARY AUDIT — file-grounded, supplier-agnostic.
 *
 * Why: a single extraction pass often grabs the biggest printed figure (turnover /
 * מחזור / סכום עסקאות / settlement volume) as the invoice total. This pass asks the
 * model for EVERY monetary candidate together with the EXACT printed label next to it
 * and a semantic role, and then a DETERMINISTIC selector decides the payable total.
 *
 * Hard rules implemented here (no supplier names, no document numbers, no expected values):
 *  - Turnover / transaction volume / settlement transfer / previous balance /
 *    account summary / credit limit are NEVER the invoice total.
 *  - On clearing / commission / settlement documents the charge / fee / commission /
 *    net amount explicitly tied to THIS document is the payable total.
 *  - Never pick by "largest amount" and never accept arithmetic consistency alone as evidence.
 *  - Never substitute a VAT amount just because it is small — only its printed label decides.
 *  - No direct label evidence, or conflicting candidates → monetary fields become null
 *    and the record is marked ambiguous so the deterministic gate sends it to review.
 */

import { roundMoney } from './invoiceExtraction.ts';

export const MONETARY_AUDIT_VERSION = 'monetary-audit-1.0.0';

export const AMOUNT_ROLES = [
  'document_payable',
  'document_subtotal',
  'document_vat',
  'fee_or_commission',
  'transaction_turnover',
  'settlement_transfer',
  'previous_balance',
  'account_summary',
  'credit_limit',
  'unknown'
];

export const MONETARY_AUDIT_PROMPT = `SYSTEM / INSTRUCTION

You are a NARROW MONETARY AUDIT engine for a single business document (invoice, credit note,
commission statement, clearing/settlement statement). You do ONE job: find every monetary
amount printed in the document, quote the EXACT label printed next to it, and classify what
that amount semantically IS. You do not summarise the document and you do not extract products.

INPUT
ONE document file (PDF/JPG/PNG) is attached. Read ONLY what is printed in it.
You are given NO expected values. Never invent, never calculate a missing figure.

FOR EVERY AMOUNT YOU FIND, RETURN:
- amount: the number exactly as printed (no currency symbol, no thousands separators, '.' decimal)
- printed_label: the EXACT text printed immediately next to / above that amount, copied verbatim
  (Hebrew stays Hebrew). If truly no label is printed, use null.
- role: one of
  * document_payable      — the amount THIS document demands to be paid
                            ("סה״כ לתשלום", "לתשלום", "סה״כ כולל מע״מ", "סה״כ חשבונית",
                             "Total", "Amount Due", "Grand Total")
  * document_subtotal     — this document's total BEFORE VAT ("סה״כ לפני מע״מ", "Subtotal")
  * document_vat          — this document's VAT ("מע״מ", "מע״מ 18%", "VAT")
  * fee_or_commission     — a charge/fee/commission/service amount billed by this document
                            ("עמלה", "עמלת סליקה", "דמי טיפול", "דמי שירות", "Fee", "Commission")
  * transaction_turnover  — volume of business/transactions, NOT a charge.
                            ("מחזור", "סכום עסקאות", "סה״כ עסקאות", "turnover", "volume")
                            CRITICAL: the grand total / sum row at the foot of a transactions,
                            activity, deals or deposits table is transaction_turnover EVEN IF it
                            is printed as "סה״כ" / "סיכום" / "Total". A sum of listed transactions
                            is turnover, never the amount this document demands to be paid.
  * settlement_transfer   — money transferred/deposited to the customer ("סכום להעברה", "הופקד", "settlement")
  * previous_balance      — earlier/carried balance ("יתרה קודמת", "יתרה", "previous balance")
  * account_summary       — cumulative or periodic account summary ("סיכום חשבון", "סה״כ חשבון", "account summary")
  * credit_limit          — credit framework ("מסגרת אשראי", "credit limit")
  * unknown               — printed amount whose label you cannot interpret
- in_document_totals_block: true only if the amount sits inside this document's own totals block
- location_hint: short hint where it appears (page/section), or null

HOW TO FIND WHAT THIS DOCUMENT DEMANDS (TWO STEPS, IN THIS ORDER)
Step 1 — locate THIS document's own charge block: the small block that states what is being
billed (fees / commissions / service charges), its VAT line, and its own total. It is usually
near the document header/footer and is separate from any list of transactions.
Step 2 — the payable total is the total of THAT charge block.
A figure that summarises listed transactions, deposits or a period of activity belongs to the
turnover/summary roles even when it is bigger and even when it is labelled "סה״כ".
If the document has no charge block at all, the payable total is null and ambiguous = true.

THEN SELECT (evidence only):
- selected_payable_total + selected_payable_evidence_label
  On a normal invoice this is the document_payable amount.
  On a clearing / commission / settlement statement the payable total is the charge / fee /
  commission / net amount explicitly tied to THIS document — the turnover figures are context only.
- selected_subtotal + selected_subtotal_evidence_label (this document's pre-VAT total, else null)
- selected_vat + selected_vat_evidence_label (this document's VAT, else null)
- document_kind: "standard_invoice" | "clearing_or_commission_statement" | "credit_note" | "other"
- ambiguous: true if there is no directly labelled payable amount, or two labelled candidates
  disagree, or you are not certain which printed amount this document demands.
- ambiguity_reason: short Hebrew explanation when ambiguous is true, else null.

ABSOLUTE PROHIBITIONS
1) NEVER choose an amount because it is the largest (or smallest) on the page.
2) turnover / מחזור / סכום עסקאות / settlement volume / previous balance / account summary /
   credit limit are NEVER the payable total, no matter how they are formatted.
3) NEVER present a VAT amount as the payable total just because it is small — the printed label decides.
4) Arithmetic consistency alone is NOT evidence. A printed label is required.
5) If evidence is missing or conflicting: set the selected_* fields to null and ambiguous = true.
   Being ambiguous is CORRECT behaviour; guessing is a failure.

OUTPUT
Output ONLY one valid JSON object matching the requested schema. No markdown, no commentary.`;

export const MONETARY_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          printed_label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          role: { enum: AMOUNT_ROLES },
          in_document_totals_block: { type: 'boolean' },
          location_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        },
        required: ['amount', 'role']
      }
    },
    selected_payable_total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    selected_payable_evidence_label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    selected_subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    selected_subtotal_evidence_label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    selected_vat: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    selected_vat_evidence_label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    document_kind: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    ambiguous: { type: 'boolean' },
    ambiguity_reason: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  },
  required: ['candidates', 'ambiguous'],
  additionalProperties: true
};

/** Roles that can never be a payable invoice total. */
const NEVER_PAYABLE_ROLES = new Set([
  'transaction_turnover',
  'settlement_transfer',
  'previous_balance',
  'account_summary',
  'credit_limit',
  'document_subtotal',
  'document_vat',
  'unknown'
]);

/** Printed-label guard, independent of the role the model assigned. */
const NEVER_PAYABLE_LABEL = /(מחזור|סכום\s*עסקאות|סה[”"״']?כ\s*עסקאות|עסקאות\s*בתקופה|turnover|volume|יתרה\s*קודמת|יתרת\s*פתיחה|previous\s*balance|opening\s*balance|סיכום\s*חשבון|סה[”"״']?כ\s*חשבון|account\s*summary|מסגרת\s*אשראי|credit\s*limit|להעברה|הופקד|deposit|settlement)/i;

const VAT_ONLY_LABEL = /^(\s*)(מע[”"״']?מ|vat)(\s|:|\d|%|$)/i;

/**
 * Labels that state, in print, that this amount is the document's final payable figure.
 * "סה״כ" / "סכום כולל" / "Total" belong here: a foot-of-transactions-table "סה״כ" never reaches
 * this test, because NEVER_PAYABLE_LABEL and the turnover roles are evaluated first.
 */
const EXPLICIT_PAYABLE_LABEL = /(לתשלום|כולל\s*מע[”"״']?מ|סה[”"״']?כ\s*חשבונית|סה[”"״']?כ|סכום\s*כולל|סך\s*הכל|amount\s*due|total\s*due|balance\s*due|grand\s*total|net\s*payable|total)/i;

/**
 * Labels that state, in print, that the amount is NOT the final payable figure because it is a
 * pre-VAT / net-of-VAT subtotal. Evaluated BEFORE the positive payable test, so a label such as
 * "סה״כ לפני מע״מ" / "Subtotal" can never be read as the document's final demand.
 */
const BEFORE_VAT_LABEL = /(לפני\s*מע[”"״']?מ|ללא\s*מע[”"״']?מ|בלי\s*מע[”"״']?מ|לא\s*כולל\s*מע[”"״']?מ|בטרם\s*מע[”"״']?מ|sub[\s-]*total|before\s*(vat|tax)|excl\.?\s*(vat|tax)|excluding\s*(vat|tax)|net\s*of\s*(vat|tax)|ex\.?\s*vat|pre[\s-]*vat)/i;

/**
 * PURE authoritative printed-label predicate for a FINAL PAYABLE amount.
 * A label qualifies only when it positively states a final total AND is not one of the
 * disqualified families (before-VAT/subtotal, VAT-only, turnover, transactions, settlement
 * transfer/deposit, previous/opening balance, account summary, credit limit).
 * The semantic role a model assigns is NOT trusted — only the printed label decides here.
 */
export function isFinalPayableLabel(label: unknown): boolean {
  const text = cleanLabel(label);
  if (!text) return false;
  if (NEVER_PAYABLE_LABEL.test(text)) return false;
  if (VAT_ONLY_LABEL.test(text)) return false;
  if (BEFORE_VAT_LABEL.test(text)) return false;
  return EXPLICIT_PAYABLE_LABEL.test(text);
}

/** Document kinds where an explicitly labelled payable total is the document's own demand. */
const STANDARD_KINDS = new Set(['standard_invoice', 'credit_note']);

const PAYABLE_ROLES_PRIMARY = ['document_payable'];
const PAYABLE_ROLES_FALLBACK = ['fee_or_commission'];

function cleanLabel(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function pickPool(candidates: any[], roles: string[], requireTotalsBlock: boolean) {
  return candidates.filter((c) => {
    if (!c || !isNum(c.amount)) return false;
    if (!roles.includes(c.role)) return false;
    if (NEVER_PAYABLE_ROLES.has(c.role)) return false;
    const label = cleanLabel(c.printed_label);
    if (!label) return false;                       // evidence label is mandatory
    if (NEVER_PAYABLE_LABEL.test(label)) return false;
    if (VAT_ONLY_LABEL.test(label)) return false;   // a VAT line is never the payable total
    if (requireTotalsBlock && c.in_document_totals_block !== true) return false;
    return true;
  });
}

/**
 * A candidate that equals the sum (or a listed value) of the document's turnover figures is
 * an aggregate of listed transactions, not what the document demands. Purely disqualifying —
 * arithmetic is never used as positive evidence.
 */
function isTurnoverAggregate(amount: number, candidates: any[]) {
  const turnover = candidates.filter((c) => c && isNum(c.amount) && ['transaction_turnover', 'settlement_transfer', 'account_summary', 'previous_balance'].includes(c.role));
  if (!turnover.length) return false;
  if (turnover.some((c) => Math.abs((roundMoney(c.amount) as number) - amount) <= 0.02)) return true;
  const sum = roundMoney(turnover.reduce((acc, c) => acc + c.amount, 0)) as number;
  return Math.abs(sum - amount) <= 0.05;
}

function distinctAmounts(pool: any[]) {
  const seen = new Map<number, any>();
  for (const c of pool) {
    const key = roundMoney(c.amount) as number;
    if (!seen.has(key)) seen.set(key, c);
  }
  return seen;
}

function pickRole(candidates: any[], role: string) {
  const pool = candidates.filter((c) => c && isNum(c.amount) && c.role === role && cleanLabel(c.printed_label) && !NEVER_PAYABLE_LABEL.test(cleanLabel(c.printed_label)));
  const distinct = distinctAmounts(pool);
  if (distinct.size !== 1) return null;
  const [amount, candidate] = [...distinct.entries()][0];
  return { amount, label: cleanLabel(candidate.printed_label) };
}

/**
 * Deterministic selection over the audit candidates.
 * Returns { total, subtotal, vat, provenance } — any field may be null (→ review).
 */
export function selectPayableAmounts(audit: any) {
  const provenance: any = {
    audit_version: MONETARY_AUDIT_VERSION,
    document_kind: audit?.document_kind ?? null,
    model_ambiguous: audit?.ambiguous === true,
    model_ambiguity_reason: audit?.ambiguity_reason ?? null,
    candidates: [],
    total_evidence_label: null,
    total_evidence_role: null,
    subtotal_evidence_label: null,
    vat_evidence_label: null,
    ambiguous: false,
    reasons: [] as string[]
  };

  const candidates = Array.isArray(audit?.candidates) ? audit.candidates : [];
  provenance.candidates = candidates
    .filter((c: any) => c && isNum(c.amount))
    .map((c: any) => ({
      amount: roundMoney(c.amount),
      printed_label: cleanLabel(c.printed_label) || null,
      role: c.role || 'unknown',
      in_document_totals_block: c.in_document_totals_block === true,
      location_hint: c.location_hint ?? null
    }));

  if (!candidates.length) {
    provenance.ambiguous = true;
    provenance.reasons.push('החילוץ לא החזיר סכומים עם תיוג מודפס.');
    return { total: null, subtotal: null, vat: null, provenance };
  }

  const documentKind = cleanLabel(audit?.document_kind).toLowerCase();
  const isStandardKind = STANDARD_KINDS.has(documentKind);
  // A single, explicitly payable-labelled candidate is direct printed evidence. It rescues an
  // ordinary document that the model merely FELT unsure about — turnover/balance/summary
  // candidates can never enter this pool, so the Phoenix exclusions still hold.
  const explicitPool = pickPool(candidates, PAYABLE_ROLES_PRIMARY, false)
    .filter((c) => EXPLICIT_PAYABLE_LABEL.test(cleanLabel(c.printed_label)));
  const explicitDistinct = distinctAmounts(explicitPool);

  if (audit?.ambiguous === true) {
    if (explicitDistinct.size === 1) {
      provenance.reasons.push(`המסמך סומן כלא חד-משמעי (${cleanLabel(audit?.ambiguity_reason) || 'ללא הסבר'}), אך קיים תיוג מודפס יחיד לסכום לתשלום ולכן הוא נבחר.`);
    } else {
      provenance.ambiguous = true;
      provenance.reasons.push(`המסמך סומן כלא חד-משמעי: ${cleanLabel(audit?.ambiguity_reason) || 'ללא הסבר'}.`);
      return { total: null, subtotal: null, vat: null, provenance };
    }
  }

  // Primary: an amount this document explicitly demands. Fallback: the fee/commission charged
  // by a clearing/commission/settlement document. Turnover figures never enter these pools.
  let pool = pickPool(candidates, PAYABLE_ROLES_PRIMARY, true);
  let usedRole = 'document_payable';
  if (!pool.length) {
    pool = pickPool(candidates, PAYABLE_ROLES_PRIMARY, false);
  }
  // Drop aggregates of the listed transactions — those are turnover, whatever they are labelled.
  // On an ordinary invoice/credit note an explicitly payable-labelled amount is NOT disqualified
  // just because the same numeric value is also printed elsewhere (balance/summary echo).
  const beforeAggregateFilter = pool.length;
  pool = pool.filter((c) => {
    if (isStandardKind && EXPLICIT_PAYABLE_LABEL.test(cleanLabel(c.printed_label))) return true;
    return !isTurnoverAggregate(roundMoney(c.amount) as number, candidates);
  });
  if (beforeAggregateFilter && !pool.length) {
    provenance.reasons.push('המועמד לסכום לתשלום זהה לסיכום העסקאות/היתרה ולכן נדחה כמחזור.');
  }
  if (!pool.length) {
    pool = pickPool(candidates, PAYABLE_ROLES_FALLBACK, false)
      .filter((c) => !isTurnoverAggregate(roundMoney(c.amount) as number, candidates));
    usedRole = 'fee_or_commission';
  }

  if (!pool.length) {
    provenance.ambiguous = true;
    provenance.reasons.push('לא נמצא סכום לתשלום עם תיוג מודפס ישיר (מחזור/יתרה/סיכום חשבון אינם סכום לתשלום).');
    return { total: null, subtotal: null, vat: null, provenance };
  }

  let distinct = distinctAmounts(pool);
  if (distinct.size > 1) {
    // Disambiguate BETWEEN LABELLED CANDIDATES ONLY (never introduce a new number):
    // 1) the charge block's own total — the candidate that closes this document's
    //    printed "לפני מע״מ + מע״מ" pair;
    // 2) otherwise a candidate whose printed label explicitly says it must be paid.
    const subRole = pickRole(candidates, 'document_subtotal');
    const vatRole = pickRole(candidates, 'document_vat');
    let narrowed: any[] = [];
    if (subRole && vatRole) {
      const chargeTotal = roundMoney(subRole.amount + vatRole.amount) as number;
      // Supporting evidence only: the candidate that the printed "before VAT + VAT" pair closes,
      // by magnitude so a credit note's sign convention cannot break it.
      narrowed = pool.filter((c) => Math.abs(Math.abs(roundMoney(c.amount) as number) - Math.abs(chargeTotal)) <= 0.02);
      if (narrowed.length) provenance.reasons.push(`הובחר סכום סגירת גוש החיוב במסמך (${chargeTotal}) מבין ${distinct.size} מועמדים מתויגים.`);
    }
    if (!narrowed.length) {
      narrowed = pool.filter((c) => EXPLICIT_PAYABLE_LABEL.test(cleanLabel(c.printed_label)));
      if (narrowed.length) provenance.reasons.push(`הובחר המועמד בעל תיוג "לתשלום" מפורש מבין ${distinct.size} מועמדים מתויגים.`);
    }
    const narrowedDistinct = distinctAmounts(narrowed);
    if (narrowedDistinct.size !== 1) {
      provenance.ambiguous = true;
      provenance.reasons.push(`נמצאו ${distinct.size} מועמדים סותרים לסכום לתשלום: ${[...distinct.keys()].join(', ')}.`);
      return { total: null, subtotal: null, vat: null, provenance };
    }
    distinct = narrowedDistinct;
  }

  const [totalAmount, totalCandidate] = [...distinct.entries()][0];
  // The model's own selection may only confirm a candidate, never introduce a new number.
  const modelSelected = isNum(audit?.selected_payable_total) ? roundMoney(audit.selected_payable_total) : null;
  if (modelSelected !== null && modelSelected !== totalAmount) {
    provenance.reasons.push(`בחירת המודל (${modelSelected}) אינה תואמת את המועמד המתויג (${totalAmount}); נבחר המועמד המתויג.`);
  }

  provenance.total_evidence_label = cleanLabel(totalCandidate.printed_label);
  provenance.total_evidence_role = usedRole;

  // Subtotal / VAT are accepted only from their own labelled roles, and only when they
  // reconcile with the selected payable total (rounding only). Otherwise they are dropped —
  // the total stands on its own printed evidence.
  const sub = pickRole(candidates, 'document_subtotal');
  const vat = pickRole(candidates, 'document_vat');
  let subtotal: number | null = null;
  let vatAmount: number | null = null;
  if (sub && vat) {
    // Credit notes may be printed as positive presentation values or as signed values; the sign
    // convention must not break the coherence check, so magnitudes are compared.
    const signed = Math.round(Math.abs(sub.amount + vat.amount - totalAmount) * 100) / 100;
    const magnitude = Math.round(Math.abs(Math.abs(sub.amount) + Math.abs(vat.amount) - Math.abs(totalAmount)) * 100) / 100;
    const delta = Math.min(signed, magnitude);
    if (delta <= 0.02) {
      subtotal = sub.amount;
      vatAmount = vat.amount;
      provenance.subtotal_evidence_label = sub.label;
      provenance.vat_evidence_label = vat.label;
    } else {
      provenance.reasons.push(`פירוט לפני מע״מ (${sub.amount}) + מע״מ (${vat.amount}) אינו מתיישב עם הסכום לתשלום (${totalAmount}); הפירוט לא נשמר.`);
    }
  } else if (sub || vat) {
    provenance.reasons.push('פירוט לפני מע״מ/מע״מ חסר או חלקי; נשמר סכום לתשלום בלבד.');
  }

  return { total: totalAmount, subtotal, vat: vatAmount, provenance };
}

/**
 * Builds the audit prompt. With a target scope (plain text, or a structured
 * { index, supplier_hint, doc_number_hint, page_hint }) the audit is restricted to that
 * one invoice inside a multi-invoice file. No scope => the base prompt, unchanged.
 */
export function formatTargetScope(targetScope?: any): string {
  if (!targetScope) return '';
  if (typeof targetScope === 'string') return targetScope.trim();
  if (typeof targetScope !== 'object') return '';
  const parts: string[] = [];
  if (targetScope.index !== null && targetScope.index !== undefined) parts.push(`invoice #${targetScope.index}`);
  if (targetScope.supplier_hint) parts.push(`supplier: ${targetScope.supplier_hint}`);
  if (targetScope.doc_number_hint) parts.push(`document number: ${targetScope.doc_number_hint}`);
  if (targetScope.page_hint) parts.push(`location: ${targetScope.page_hint}`);
  if (targetScope.text) parts.push(String(targetScope.text));
  return parts.join(' | ');
}

export function buildScopedAuditPrompt(targetScope?: any): string {
  const scopeText = formatTargetScope(targetScope);
  if (!scopeText) return MONETARY_AUDIT_PROMPT;

  return `${MONETARY_AUDIT_PROMPT}

TARGET SCOPE (MANDATORY)
This file contains MORE THAN ONE invoice/document. Audit ONLY the following target:
${scopeText}
- Every candidate you report MUST come from that target invoice only.
- Amounts printed on any OTHER invoice/page/document in this file MUST be ignored completely — do not report them as candidates, not even as context.
- If you cannot confidently isolate the target invoice, report no payable candidate rather than mixing documents.
- All other rules above (roles, verbatim printed labels, never-payable figures, ambiguity) still apply exactly as stated.`;
}

/**
 * Runs the audit against the ORIGINAL file. Never receives stored invoice values.
 */
export async function runMonetaryAudit(base44: any, fileUrl: string, model = 'gpt_5_mini', targetScope?: any) {
  let audit = await base44.integrations.Core.InvokeLLM({
    prompt: buildScopedAuditPrompt(targetScope),
    add_context_from_internet: false,
    response_json_schema: MONETARY_AUDIT_SCHEMA,
    file_urls: [fileUrl],
    model
  });
  if (audit && typeof audit === 'object' && audit.response && typeof audit.response === 'object' && Array.isArray(audit.response.candidates)) {
    audit = audit.response;
  }
  return audit;
}

/**
 * Applies the audit onto an extraction object in place: monetary fields become the
 * evidence-selected values, or null when evidence is missing/conflicting.
 * Attaches extraction.amount_provenance for debug output.
 */
export function applyMonetaryAudit(extraction: any, audit: any) {
  const selection = selectPayableAmounts(audit);
  extraction.total_with_vat = selection.total;
  extraction.subtotal_before_vat = selection.subtotal;
  extraction.vat_amount = selection.vat;
  extraction.amount_provenance = selection.provenance;
  return selection;
}

/** Convenience wrapper: audit the file and apply it, degrading safely to "ambiguous". */
export async function auditAndApplyAmounts(base44: any, extraction: any, fileUrl: string, model = 'gpt_5_mini', targetScope?: any) {
  try {
    const audit = await runMonetaryAudit(base44, fileUrl, model, targetScope);
    return applyMonetaryAudit(extraction, audit);
  } catch (err: any) {
    extraction.total_with_vat = null;
    extraction.subtotal_before_vat = null;
    extraction.vat_amount = null;
    extraction.amount_provenance = {
      audit_version: MONETARY_AUDIT_VERSION,
      ambiguous: true,
      candidates: [],
      total_evidence_label: null,
      reasons: [`ביקורת הסכומים נכשלה: ${err?.message || String(err)}`]
    };
    return { total: null, subtotal: null, vat: null, provenance: extraction.amount_provenance };
  }
}