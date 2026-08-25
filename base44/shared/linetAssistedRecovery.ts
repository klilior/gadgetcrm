/**
 * P1-C — DETERMINISTIC LINET-ASSISTED RECOVERY of missing/implausible critical header fields.
 *
 * What this is: after P1-A (narrow second pass) and P1-B (curated profile re-evaluation), a
 * critical header field can still be missing. This block looks for the SAME transaction inside
 * already-synced, read-only LinetPurchaseDocument rows and — only under exact, unique, verified
 * evidence — fills ONLY the still-missing fields.
 *
 * What this is NOT: a fuzzy matcher, a Linet sync, a Linet writer, a duplicate detector, an
 * approval mechanism, or a way to overwrite what the document clearly prints.
 *
 * HARD RULES
 *  - Runs only AFTER classification guard, date normalization, monetary audit, P1-A recovery,
 *    final P1-B profile re-evaluation and deterministic supplier resolution, and BEFORE the gate.
 *  - A healthy invoice does zero candidate work (plan.needed === false).
 *  - OTHER / should_skip documents are never revived.
 *  - Exact supplier identity (verified Linet account and/or exact VAT) is MANDATORY. Weak,
 *    ambiguous or conflicting supplier evidence, or a profile with no verified Linet account
 *    (currently ALPHONE), never recovers anything.
 *  - No Levenshtein / contains / near-text matching anywhere. A partial or profile-invalid
 *    reference is recorded as weak context and scores 0 exact-reference points.
 *  - A clear printed value is NEVER overwritten; disagreement with a clear printed value is a
 *    HARD CONFLICT (review), never a correction.
 *  - Selection requires ONE unique strong candidate that beats the runner-up by >= 20 points.
 *    Never first-of-list.
 *  - After filling, the candidate is re-simulated through the EXISTING evaluateLinetMatch and must
 *    return 'confirmed'; otherwise nothing is applied.
 *  - Nothing here approves anything: the central gate, business duplicate, line check,
 *    classification guard and all remaining P1-A/P1-B failures still apply. The existing
 *    post-persist reconcileLinetInvoices still runs and stays authoritative for match state.
 *
 * Pure module apart from the two clearly-marked helpers at the bottom (candidate read + orchestration).
 */

import { cleanEvidence } from './invoiceSentinelValues.ts';
import { roundMoney } from './invoiceExtraction.ts';
import {
  compareLines,
  dateOnly,
  evaluateLinetMatch,
  normalizeInvoiceNumber,
  numberValue,
  parseLinetLines,
  LINET_MATCH_TOLERANCE,
  LINET_REASON_CODES
} from './linetInvoiceReconciliation.ts';
import { normalizeProfileReference, normalizeReference, validateProfileDocNumber } from './invoiceSupplierProfiles.ts';
import { isPlausibleDocDate, isPlausibleDocNumberValue, isPlausibleTotalValue } from './invoiceCriticalFieldRecovery.ts';

export const LINET_ASSISTED_RECOVERY_VERSION = 'linet-assisted-recovery-1.0.0';

export const LINET_ASSISTED_REASON_CODES = {
  NOT_NEEDED: 'LINET_RECOVERY_NOT_NEEDED',
  SKIPPED_DOCUMENT: 'LINET_RECOVERY_SKIPPED_DOCUMENT',
  NO_EXACT_IDENTITY: 'LINET_RECOVERY_NO_EXACT_IDENTITY',
  NO_CANDIDATES: 'LINET_RECOVERY_NO_CANDIDATES',
  NONE: 'LINET_RECOVERY_NONE',
  AMBIGUOUS: 'LINET_RECOVERY_AMBIGUOUS',
  CONFLICT: 'LINET_RECOVERY_CONFLICT',
  POST_FILL_UNCONFIRMED: 'LINET_RECOVERY_POST_FILL_UNCONFIRMED',
  ALREADY_OWNED: 'LINET_RECOVERY_PURCHASE_ALREADY_OWNED',
  APPLIED: 'LINET_RECOVERY_APPLIED'
};

/**
 * Transparent, versioned weights.
 * NOTE on date proximity: the suggested small proximity hints (<=1d: 8, <=3d: 4) are deliberately
 * neutralized to 0 here. Reason: proximity is only computable when the document already prints a
 * CLEAR date, and a clear printed date differing from Linet is already a HARD CONFLICT. Awarding
 * points there would be strictly weaker than the conflict rule, so 0 keeps this block at least as
 * strict as specified. The constants stay declared and are proven at 0 in the harness.
 */
export const LINET_ASSISTED_WEIGHTS = {
  supplier_exact: 30,
  exact_reference: 40,
  exact_total: 25,
  exact_date: 20,
  line_agreement: 25,
  date_proximity_1d: 0,
  date_proximity_3d: 0
};

export const LINET_ASSISTED_THRESHOLDS = {
  min_score: 85,
  min_anchors: 3,
  min_margin: 20,
  max_candidates: 500,
  total_tolerance: LINET_MATCH_TOLERANCE
};

/** Header fields this block may ever fill. Line items and classification are never touched. */
export const LINET_FILLABLE_FIELDS = ['doc_number', 'invoice_date', 'total_with_vat', 'subtotal_before_vat', 'vat_amount'];

// ── small pure helpers ──────────────────────────────────────────────────────

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** compareLines-compatible shape from the extraction's own line items (no persistence needed). */
export function invoiceLinesFromExtraction(extraction: any = {}) {
  return (extraction?.line_items || []).map((item: any, index: number) => ({
    line_number: numberValue(item?.line_number) || index + 1,
    sku: cleanEvidence(item?.sku),
    product_name: cleanEvidence(item?.product_name),
    quantity: numberValue(item?.quantity),
    line_total_before_vat: numberValue(item?.line_total_before_vat)
  })).filter((line: any) => line.sku || line.product_name || line.quantity !== null);
}

/** Every comparison form of the document's own reference, including P1-B contextual normalization. */
export function localReferenceForms(extraction: any, profileMatch: any) {
  const printed = normalizeReference(extraction?.doc_number);
  const contextual = normalizeProfileReference(profileMatch, extraction?.doc_number);
  const forms = new Set<string>();
  if (printed) forms.add(printed);
  if (contextual.applied && contextual.normalized) forms.add(normalizeReference(contextual.normalized));
  const numeric = new Set<string>();
  for (const form of forms) {
    const bare = normalizeInvoiceNumber(form);
    if (bare) numeric.add(bare);
  }
  return { forms: [...forms], numeric_forms: [...numeric], contextual_applied: contextual.applied === true };
}

function purchaseReferenceForms(purchase: any) {
  const forms = new Set<string>();
  const numeric = new Set<string>();
  for (const raw of [purchase?.supplier_invoice_number, purchase?.normalized_invoice_number]) {
    const form = normalizeReference(raw);
    if (form) forms.add(form);
    const bare = normalizeInvoiceNumber(raw);
    if (bare) numeric.add(bare);
  }
  return { forms: [...forms], numeric_forms: [...numeric] };
}

/**
 * EXACT reference equality only: identical normalized reference text, or identical normalized
 * numeric core. No substring, prefix, distance or similarity logic exists here by design.
 */
function referencesEqual(local: any, linet: any): boolean {
  if (local.forms.some((form: string) => linet.forms.includes(form))) return true;
  return local.numeric_forms.some((core: string) => linet.numeric_forms.includes(core));
}

// ── eligibility plan ───────────────────────────────────────────────────────

/**
 * Deterministic decision on whether Linet-assisted recovery may run at all, which fields it may
 * fill, and which exact identity bounds the candidate read.
 *
 * @param options { profile_match, supplier, supplier_resolution, now }
 */
export function planLinetAssistedRecovery(extraction: any = {}, options: any = {}) {
  const now = options.now || new Date();
  const profileMatch = options.profile_match || null;
  const resolution = options.supplier_resolution || null;
  const supplier = options.supplier || resolution?.supplier || null;
  const skipped = extraction?.should_skip === true || String(extraction?.classification || '').toUpperCase() === 'OTHER';

  // "Clear" = survived P1-A as a plausible value AND (for the reference) is valid for a reliably
  // matched profile. A clear value may never be overwritten and may never be re-filled.
  const docNumberPlausible = isPlausibleDocNumberValue(extraction?.doc_number);
  const profileDoc = validateProfileDocNumber(profileMatch, extraction?.doc_number);
  const docNumberProfileInvalid = docNumberPlausible && profileDoc.applicable === true && profileDoc.valid === false;
  const clear = {
    doc_number: docNumberPlausible && !docNumberProfileInvalid,
    invoice_date: isPlausibleDocDate(extraction?.invoice_date ?? extraction?.doc_date, now),
    total_with_vat: isPlausibleTotalValue(extraction?.total_with_vat)
  };

  // P1-A interplay: the SAME profile-invalid reference read twice is CLEAR conflicting document
  // evidence. Linet may then neither fill nor overwrite it — a differing Linet reference becomes a
  // hard conflict instead, and the P1-B guard can never be satisfied.
  const docDecision = (options.recovery_merge?.decisions || []).find((decision: any) => decision?.field === 'doc_number') || null;
  const repeatedDocReading = !!docDecision
    && docDecision.first_pass?.value != null
    && docDecision.second_pass?.value != null
    && normalizeReference(docDecision.first_pass.value) === normalizeReference(docDecision.second_pass.value);
  const blocked_fields: string[] = [];
  if (docNumberProfileInvalid && repeatedDocReading) {
    clear.doc_number = true;
    blocked_fields.push('doc_number');
  }

  const supplierUnresolved = !supplier?.id;
  const target_fields: string[] = [];
  if (!clear.doc_number) target_fields.push('doc_number');
  if (!clear.invoice_date) target_fields.push('invoice_date');
  if (!clear.total_with_vat) target_fields.push('total_with_vat');
  // Breakdown fields are never "critical" on their own; they may only ride along with a confirmed
  // recovery and only while genuinely absent.
  const optional_fields = ['subtotal_before_vat', 'vat_amount'].filter((field) => !isFiniteNumber(extraction?.[field]));

  const needed = target_fields.length > 0 || supplierUnresolved;
  const base = {
    version: LINET_ASSISTED_RECOVERY_VERSION,
    needed,
    eligible: false,
    skipped_document: skipped,
    clear,
    doc_number_profile_invalid: docNumberProfileInvalid,
    profile_doc_number: {
      applicable: profileDoc.applicable === true,
      first_valid: profileDoc.valid !== false,
      profile_key: profileDoc.profile_key ?? null,
      reason_code: profileDoc.reason_code ?? null
    },
    supplier_unresolved: supplierUnresolved,
    blocked_fields,
    target_fields,
    optional_fields,
    identity: { linet_supplier_account_id: null as string | null, vat_id: null as string | null, supplier_id: supplier?.id ?? null, source: 'none' },
    max_candidates: LINET_ASSISTED_THRESHOLDS.max_candidates,
    reason_code: LINET_ASSISTED_REASON_CODES.NOT_NEEDED,
    reason: 'כל שדות הכותרת הקריטיים נקראו; לא נדרש שחזור מול לינט.'
  };

  if (!needed) return base;
  if (skipped) {
    return { ...base, reason_code: LINET_ASSISTED_REASON_CODES.SKIPPED_DOCUMENT, reason: 'המסמך סווג כלא רלוונטי ולכן אין שחזור מול לינט.' };
  }

  // Exact identity, in strength order. A reliable profile must ALSO carry a verified Linet account
  // (ALPHONE has none → never eligible). A stored supplier qualifies with a verified account or VAT.
  const profileReliable = profileMatch?.matched === true && profileMatch.reliable_for_auto_approval === true;
  const profileAccount = profileReliable ? cleanEvidence(profileMatch.linet_supplier_account_id) : '';
  const resolutionReliable = resolution ? resolution.reliable_for_auto_approval === true : !!supplier?.id;
  const supplierAccount = resolutionReliable ? cleanEvidence(supplier?.linet_supplier_account_id) : '';
  const supplierVat = resolutionReliable ? digits(supplier?.vat_id) : '';

  const account = profileAccount || supplierAccount;
  const vat = supplierVat || (profileReliable ? digits(profileMatch?.supplier?.vat_id) : '');
  if (!account && !vat) {
    return {
      ...base,
      reason_code: LINET_ASSISTED_REASON_CODES.NO_EXACT_IDENTITY,
      reason: 'אין זהות ספק מדויקת ומאומתת (חשבון לינט מאומת ו/או ח.פ מדויק) ולכן לא בוצע שחזור מול לינט.'
    };
  }

  return {
    ...base,
    eligible: true,
    identity: {
      linet_supplier_account_id: account || null,
      vat_id: vat || null,
      supplier_id: supplier?.id ?? (profileReliable ? profileMatch.supplier_id : null),
      source: profileAccount ? 'profile_linet_account' : (supplierAccount ? 'supplier_linet_account' : 'supplier_vat_id')
    },
    reason_code: null,
    reason: `נדרש שחזור מול לינט לשדות: ${target_fields.join(', ') || 'זהות ספק'}.`
  };
}

// ── pure scoring ───────────────────────────────────────────────────────────

/**
 * Score ONE read-only purchase document against the current extraction.
 * Exact fields only. Returns hard conflicts separately — a conflicted candidate can never be
 * strong, no matter how high its score.
 */
export function scoreLinetCandidate(purchase: any, context: any = {}) {
  const { extraction = {}, plan, profile_match = null, supplier = null, invoice_lines = [], invoice_id = null } = context;
  const clear = plan?.clear || { doc_number: false, invoice_date: false, total_with_vat: false };
  const identity = plan?.identity || {};

  const local = localReferenceForms(extraction, profile_match);
  const linetRef = purchaseReferenceForms(purchase);
  const localDate = dateOnly(extraction?.invoice_date ?? extraction?.doc_date);
  const linetDate = dateOnly(purchase?.doc_date);
  const localTotal = isFiniteNumber(extraction?.total_with_vat) ? roundMoney(extraction.total_with_vat) : null;
  const linetTotal = numberValue(purchase?.total_with_vat);
  const localVat = digits(supplier?.vat_id) || digits(identity.vat_id);
  const linetVat = digits(purchase?.supplier_vat_id);
  const localAccount = cleanEvidence(supplier?.linet_supplier_account_id) || cleanEvidence(identity.linet_supplier_account_id);
  const linetAccount = cleanEvidence(purchase?.supplier_account_id);
  const lineComparison = compareLines(invoice_lines, parseLinetLines(purchase));

  const conflicts: string[] = [];
  const anchors: string[] = [];
  let score = 0;

  // 1) Supplier identity — mandatory, exact only.
  const vatComparable = !!localVat && !!linetVat;
  const accountComparable = !!localAccount && !!linetAccount;
  const vatEqual = vatComparable && localVat === linetVat;
  const accountEqual = accountComparable && localAccount === linetAccount;
  if ((vatComparable && !vatEqual) || (accountComparable && !accountEqual)) {
    conflicts.push(LINET_REASON_CODES.SUPPLIER);
  }
  const supplierExact = (vatEqual || accountEqual) && !conflicts.includes(LINET_REASON_CODES.SUPPLIER);
  if (supplierExact) {
    score += LINET_ASSISTED_WEIGHTS.supplier_exact;
    anchors.push('supplier_exact');
  }

  // 2) Reference — exact equality only, and only when the document's own reference is CLEAR.
  const referenceExact = clear.doc_number && local.forms.length > 0 && linetRef.forms.length > 0 && referencesEqual(local, linetRef);
  if (referenceExact) {
    score += LINET_ASSISTED_WEIGHTS.exact_reference;
    anchors.push('exact_reference');
  } else if (clear.doc_number && local.forms.length > 0 && linetRef.forms.length > 0) {
    // A clear, profile-valid printed reference that differs is a hard conflict, never a repair.
    conflicts.push('LINET_REFERENCE_CONFLICT');
  }
  // Weak context ONLY: an unclear/profile-invalid reference scores nothing and can never select.
  const weak_reference_context = !clear.doc_number && local.forms.length > 0 && linetRef.forms.length > 0 && referencesEqual(local, linetRef);

  // 3) Total — exact within rounding tolerance; a clear differing total is a hard conflict.
  const totalComparable = localTotal !== null && linetTotal !== null;
  const totalExact = totalComparable && Math.abs(localTotal - linetTotal) <= LINET_ASSISTED_THRESHOLDS.total_tolerance;
  if (totalExact) {
    score += LINET_ASSISTED_WEIGHTS.exact_total;
    anchors.push('exact_total');
  } else if (totalComparable && clear.total_with_vat) {
    conflicts.push(LINET_REASON_CODES.TOTAL);
  }

  // 4) Date — exact only; a clear differing printed date is a hard conflict. Proximity scores 0.
  const dateComparable = !!localDate && !!linetDate;
  const dateExact = dateComparable && localDate === linetDate;
  let proximity_days: number | null = null;
  if (dateExact) {
    score += LINET_ASSISTED_WEIGHTS.exact_date;
    anchors.push('exact_date');
  } else if (dateComparable) {
    proximity_days = Math.round(Math.abs(Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${linetDate}T00:00:00Z`)) / 86400000);
    if (clear.invoice_date) conflicts.push(LINET_REASON_CODES.DATE);
    // Search hint only, weighted 0 (see LINET_ASSISTED_WEIGHTS note).
    score += proximity_days <= 1 ? LINET_ASSISTED_WEIGHTS.date_proximity_1d
      : (proximity_days <= 3 ? LINET_ASSISTED_WEIGHTS.date_proximity_3d : 0);
  }

  // 5) Lines — positive agreement scores; a meaningful contradiction is a hard conflict.
  if (lineComparison.conflict) conflicts.push(LINET_REASON_CODES.LINE);
  const lineAgreement = lineComparison.applicable === true && lineComparison.agrees === true && !lineComparison.conflict;
  if (lineAgreement) {
    score += LINET_ASSISTED_WEIGHTS.line_agreement;
    anchors.push('line_agreement');
  }

  // 6) Ownership — a purchase owned by another invoice may never be selected on any path.
  const owner = purchase?.matched_invoice_id;
  const alreadyOwned = !!owner && String(owner) !== String(invoice_id ?? '');
  if (alreadyOwned) conflicts.push(LINET_REASON_CODES.PURCHASE_ALREADY_MATCHED);

  // Anchor combinations. C is allowed ONLY when the reference itself is what is missing.
  const patternA = anchors.includes('exact_reference') && anchors.includes('exact_total');
  const patternB = anchors.includes('exact_reference') && anchors.includes('exact_date');
  const patternC = !clear.doc_number && anchors.includes('exact_total') && anchors.includes('exact_date') && anchors.includes('line_agreement');
  const strong = conflicts.length === 0
    && supplierExact
    && anchors.length >= LINET_ASSISTED_THRESHOLDS.min_anchors
    && score >= LINET_ASSISTED_THRESHOLDS.min_score
    && (patternA || patternB || patternC);

  return {
    purchase,
    linet_purchase_document_id: purchase?.id ?? null,
    linet_doc_id: purchase?.linet_doc_id ?? null,
    linet_doc_number: purchase?.linet_doc_number ?? null,
    supplier_invoice_number: purchase?.supplier_invoice_number ?? null,
    score,
    anchors,
    conflicts,
    strong,
    matched_pattern: strong ? (patternA ? 'A_reference_total' : (patternB ? 'B_reference_date' : 'C_total_date_lines')) : null,
    weak_reference_context,
    already_owned: alreadyOwned,
    values: {
      local_reference_forms: local.forms,
      linet_reference_forms: linetRef.forms,
      local_doc_date: localDate || null,
      linet_doc_date: linetDate || null,
      local_total_with_vat: localTotal,
      linet_total_with_vat: linetTotal,
      supplier_identity: accountEqual ? 'linet_account' : (vatEqual ? 'vat' : (conflicts.includes(LINET_REASON_CODES.SUPPLIER) ? 'conflict' : 'none')),
      date_proximity_days: proximity_days,
      line_agreement: lineAgreement,
      line_conflict: lineComparison.conflict === true
    }
  };
}

// ── pure decision ──────────────────────────────────────────────────────────

function compactCandidate(candidate: any) {
  return {
    linet_purchase_document_id: candidate.linet_purchase_document_id,
    linet_doc_number: candidate.linet_doc_number,
    supplier_invoice_number: candidate.supplier_invoice_number,
    score: candidate.score,
    anchors: candidate.anchors,
    conflicts: candidate.conflicts,
    strong: candidate.strong,
    matched_pattern: candidate.matched_pattern,
    weak_reference_context: candidate.weak_reference_context,
    values: candidate.values
  };
}

/**
 * PURE: scores every candidate, selects at most one, builds the fill plan and REQUIRES the existing
 * evaluateLinetMatch to confirm the post-fill state before anything may be applied.
 * Nothing is mutated here.
 */
export function decideLinetAssistedRecovery({ extraction = {}, plan, purchases = [], profile_match = null, supplier = null, invoice_lines = null, invoice_id = null }: any) {
  const lines = invoice_lines || invoiceLinesFromExtraction(extraction);
  const base = {
    version: LINET_ASSISTED_RECOVERY_VERSION,
    weights: LINET_ASSISTED_WEIGHTS,
    thresholds: LINET_ASSISTED_THRESHOLDS,
    attempted: false,
    applied: false,
    outcome: 'not_needed',
    reason_code: plan?.reason_code ?? LINET_ASSISTED_REASON_CODES.NOT_NEEDED,
    reason: plan?.reason ?? null,
    target_fields: plan?.target_fields || [],
    apply: {} as Record<string, any>,
    applied_fields: [] as string[],
    applied_supplier_id: null as string | null,
    selected: null as any,
    runner_up_score: null as number | null,
    margin: null as number | null,
    candidates: [] as any[],
    post_fill: null as any,
    satisfies_profile_doc_guard: false,
    requires_manual_review: false,
    review_reasons_he: [] as string[]
  };

  if (!plan?.needed) return base;
  if (!plan.eligible) {
    return { ...base, outcome: 'not_eligible', reason_code: plan.reason_code, reason: plan.reason };
  }

  const context = { extraction, plan, profile_match, supplier, invoice_lines: lines, invoice_id };
  const scored = (purchases || []).map((purchase: any) => scoreLinetCandidate(purchase, context));
  const compact = scored.map(compactCandidate).sort((a: any, b: any) => b.score - a.score);

  if (!scored.length) {
    return { ...base, attempted: true, outcome: 'none', reason_code: LINET_ASSISTED_REASON_CODES.NO_CANDIDATES, reason: 'לא נמצאו מסמכי רכש בלינט עבור זהות הספק המדויקת.', candidates: [] };
  }

  const strong = scored.filter((candidate: any) => candidate.strong);
  const conflicted = scored.filter((candidate: any) => candidate.conflicts.length > 0);

  const review = (reasonCode: string, reason: string, outcome: string) => ({
    ...base,
    attempted: true,
    outcome,
    reason_code: reasonCode,
    reason,
    candidates: compact,
    requires_manual_review: true,
    review_reasons_he: [`${reasonCode}: ${reason}`]
  });

  if (strong.length > 1) {
    return review(LINET_ASSISTED_REASON_CODES.AMBIGUOUS, `נמצאו ${strong.length} מסמכי רכש חזקים ולא ניתן לבחור באופן חד-משמעי; נדרש אימות ידני.`, 'ambiguous');
  }

  if (!strong.length) {
    // A clear contradiction against the document is reported as a conflict; otherwise simply none.
    const owned = conflicted.find((candidate: any) => candidate.already_owned);
    if (owned) {
      return review(LINET_ASSISTED_REASON_CODES.ALREADY_OWNED, 'מסמך הרכש בלינט משויך כבר לחשבונית אחרת ולכן לא ניתן להשתמש בו לשחזור.', 'conflict');
    }
    if (conflicted.length) {
      const codes = [...new Set(conflicted.flatMap((candidate: any) => candidate.conflicts))];
      return review(LINET_ASSISTED_REASON_CODES.CONFLICT, `נמצאה סתירה מובהקת מול מסמך רכש בלינט (${codes.join(', ')}); הערכים שנקראו מהמסמך לא שונו.`, 'conflict');
    }
    return { ...base, attempted: true, outcome: 'none', reason_code: LINET_ASSISTED_REASON_CODES.NONE, reason: 'אין מועמד חזק ומאומת בלינט לשחזור השדות החסרים.', candidates: compact };
  }

  const selected = strong[0];
  const runnerUp = scored
    .filter((candidate: any) => candidate !== selected)
    .reduce((max: number, candidate: any) => Math.max(max, candidate.score), 0);
  const margin = selected.score - runnerUp;
  if (margin < LINET_ASSISTED_THRESHOLDS.min_margin) {
    return {
      ...review(LINET_ASSISTED_REASON_CODES.AMBIGUOUS, `המועמד המוביל (${selected.score}) אינו מוביל בפער הנדרש של ${LINET_ASSISTED_THRESHOLDS.min_margin} נקודות מול המועמד הבא (${runnerUp}); נדרש אימות ידני.`, 'ambiguous'),
      runner_up_score: runnerUp,
      margin
    };
  }

  // Fill plan — ONLY still-missing fields, taken from the read-only purchase document.
  const purchase = selected.purchase;
  const apply: Record<string, any> = {};
  if (plan.target_fields.includes('doc_number')) {
    const reference = cleanEvidence(purchase?.supplier_invoice_number);
    if (reference) apply.doc_number = reference;
  }
  if (plan.target_fields.includes('invoice_date')) {
    const date = dateOnly(purchase?.doc_date);
    if (date) apply.invoice_date = date;
  }
  if (plan.target_fields.includes('total_with_vat')) {
    const total = numberValue(purchase?.total_with_vat);
    if (total !== null) apply.total_with_vat = total;
  }
  for (const field of (plan.optional_fields || [])) {
    const value = numberValue(purchase?.[field]);
    if (value !== null) apply[field] = value;
  }
  const appliedSupplierId = plan.supplier_unresolved
    ? (supplier?.id || (profile_match?.matched && profile_match.reliable_for_auto_approval && profile_match.supplier?.is_active !== false ? profile_match.supplier_id : null))
    : null;

  // Post-fill verification through the EXISTING matcher — the only thing that authorizes an apply.
  const effectiveSupplier = supplier || (appliedSupplierId ? profile_match?.supplier : null) || null;
  const simulated = {
    doc_number: apply.doc_number ?? extraction?.doc_number ?? null,
    doc_date: apply.invoice_date ?? dateOnly(extraction?.invoice_date ?? extraction?.doc_date) ?? null,
    total_with_vat: apply.total_with_vat ?? (isFiniteNumber(extraction?.total_with_vat) ? extraction.total_with_vat : null)
  };
  const postFill = evaluateLinetMatch(simulated, purchase, lines, effectiveSupplier);
  if (postFill.level !== 'confirmed') {
    return {
      ...review(LINET_ASSISTED_REASON_CODES.POST_FILL_UNCONFIRMED, `השחזור לא אושר באימות חוזר מול מסמך הרכש (${postFill.level}); לא בוצע שינוי כלשהו.`, 'post_fill_unconfirmed'),
      selected: compactCandidate(selected),
      runner_up_score: runnerUp,
      margin,
      post_fill: { level: postFill.level, conflict_codes: postFill.conflict_codes, reason: postFill.reason }
    };
  }

  const applied_fields = Object.keys(apply);
  const profileGuard = apply.doc_number ? validateProfileDocNumber(profile_match, apply.doc_number) : null;
  return {
    ...base,
    attempted: true,
    applied: applied_fields.length > 0 || !!appliedSupplierId,
    outcome: 'applied',
    reason_code: LINET_ASSISTED_REASON_CODES.APPLIED,
    reason: `הושלמו מלינט השדות: ${applied_fields.join(', ') || 'זהות ספק'} לפי מסמך רכש ${purchase?.linet_doc_number || purchase?.id} (ניקוד ${selected.score}, פער ${margin}).`,
    apply,
    applied_fields,
    applied_supplier_id: appliedSupplierId,
    selected: compactCandidate(selected),
    runner_up_score: runnerUp,
    margin,
    candidates: compact,
    post_fill: { level: postFill.level, conflict_codes: postFill.conflict_codes, reason: postFill.reason },
    // The P1-B guard may be considered satisfied ONLY when this recovery actually replaced the
    // implausible reference AND the recovered value validates for the same profile.
    satisfies_profile_doc_guard: !!apply.doc_number && profileGuard?.valid !== false
  };
}

/** Applies ONLY the verified fills and attaches compact audit metadata. Mutates the extraction. */
export function applyLinetAssistedRecovery(extraction: any, decision: any) {
  if (decision?.applied) {
    for (const [field, value] of Object.entries(decision.apply || {})) {
      if (field === 'invoice_date') {
        extraction.invoice_date = value;
        extraction.doc_date = value;
      } else {
        extraction[field] = value;
      }
    }
  }
  extraction.linet_assisted_recovery = {
    version: decision?.version || LINET_ASSISTED_RECOVERY_VERSION,
    attempted: decision?.attempted === true,
    applied: decision?.applied === true,
    outcome: decision?.outcome || 'not_needed',
    reason_code: decision?.reason_code || null,
    reason: decision?.reason || null,
    target_fields: decision?.target_fields || [],
    applied_fields: decision?.applied_fields || [],
    applied_supplier_id: decision?.applied_supplier_id || null,
    selected: decision?.selected || null,
    runner_up_score: decision?.runner_up_score ?? null,
    margin: decision?.margin ?? null,
    post_fill_level: decision?.post_fill?.level || null,
    satisfies_profile_doc_guard: decision?.satisfies_profile_doc_guard === true,
    requires_manual_review: decision?.requires_manual_review === true,
    review_reasons_he: decision?.review_reasons_he || []
  };
  return extraction;
}

/**
 * Remaining P1-A failures for the gate.
 * - conflict_fields are NEVER cleared by Linet (a candidate agreeing with one side of a two-pass
 *   disagreement still stays review);
 * - an unresolved field may be considered resolved ONLY when this strong, unique, post-fill
 *   confirmed recovery actually filled that exact field.
 * The stored P1-A audit record is never mutated or erased.
 */
export function remainingCriticalRecoveryFailures(merge: any, decision: any) {
  const conflicts = merge?.conflict_fields || [];
  const unresolved = merge?.unresolved_fields || [];
  const filled = new Set<string>(decision?.applied === true ? (decision.applied_fields || []) : []);
  const resolved_by_linet = unresolved.filter((field: string) => filled.has(field));
  const remaining_unresolved = unresolved.filter((field: string) => !filled.has(field));
  const keptFields = new Set<string>([...conflicts, ...remaining_unresolved]);
  const review_reasons_he = (merge?.review_reasons_he || []).filter((reason: string) =>
    [...keptFields].some((field) => String(reason).includes(`(${field})`))
  );
  return {
    conflict_fields: conflicts,
    remaining_unresolved_fields: remaining_unresolved,
    resolved_by_linet,
    requires_manual_review: conflicts.length > 0 || remaining_unresolved.length > 0,
    review_reasons_he
  };
}

/**
 * The ONE place where P1-A, P1-C and the P1-B profile-reference guard are folded into the central
 * deterministic gate, so all three routes behave identically and nothing can be weakened locally.
 * The gate is only ever made STRICTER here — no failure is ever removed.
 */
export function applyRecoveryOutcomesToGate(gate: any, { merge = null, decision = null, profile_doc_check = null }: any = {}) {
  const push = (failure: string) => {
    if (failure && !gate.failures.includes(failure)) gate.failures.push(failure);
    gate.passed = false;
  };

  // P1-A, minus ONLY the unresolved fields a strong post-fill-confirmed Linet recovery actually filled.
  const remaining = remainingCriticalRecoveryFailures(merge, decision);
  if (merge?.requires_manual_review && remaining.requires_manual_review) {
    const reasons = remaining.review_reasons_he.length ? remaining.review_reasons_he : (merge.review_reasons_he || []);
    for (const reason of reasons) push(reason);
  }

  // P1-C's own review outcomes (ambiguous / conflict / already-owned / post-fill unconfirmed).
  if (decision?.requires_manual_review) {
    for (const reason of (decision.review_reasons_he || [])) push(reason);
  }

  // P1-B guard: satisfied only when P1-C actually replaced the implausible reference with a
  // profile-valid one; otherwise the original failure stands.
  let profile_guard_kept = false;
  if (profile_doc_check?.applicable && profile_doc_check.valid === false && decision?.satisfies_profile_doc_guard !== true) {
    push(`${profile_doc_check.reason_code}: ${profile_doc_check.reason}`);
    profile_guard_kept = true;
  }

  return { remaining, profile_guard_kept };
}

/** Compact processing events, reusing the existing Linet event vocabulary (no schema change). */
export function buildLinetAssistedEvents(decision: any, at = new Date().toISOString()) {
  if (!decision?.attempted) return [];
  const meta = {
    stage: 'P1C',
    version: decision.version,
    target_fields: decision.target_fields || [],
    applied_fields: decision.applied_fields || [],
    selected: decision.selected?.linet_purchase_document_id || null,
    score: decision.selected?.score ?? null,
    margin: decision.margin ?? null
  };
  const type = decision.outcome === 'applied' ? 'LINET_CONFIRMED'
    : (decision.outcome === 'conflict' ? 'LINET_CONFLICT'
      : (decision.outcome === 'ambiguous' || decision.outcome === 'post_fill_unconfirmed' ? 'LINET_POSSIBLE' : 'LINET_MISSING'));
  return [{
    type,
    at,
    outcome: decision.outcome === 'applied' ? 'applied' : (decision.requires_manual_review ? 'manual_review' : 'none'),
    reason: decision.reason_code ? `${decision.reason_code}` : null,
    meta
  }];
}

/** Critical-field values for provenance — applied fields only, so LINET selects nothing else. */
export function linetProvenanceValues(decision: any) {
  const values: Record<string, any> = {};
  if (decision?.applied !== true) return values;
  for (const [field, value] of Object.entries(decision.apply || {})) {
    if (field === 'invoice_date') values.doc_date = value;
    else values[field] = value;
  }
  if (decision.applied_supplier_id) values.supplier = decision.applied_supplier_id;
  return values;
}

// ── IMPURE: bounded read-only candidate load + orchestration ────────────────

/**
 * Reads ONLY existing LinetPurchaseDocument rows, bounded by the exact verified identity and by
 * LINET_ASSISTED_THRESHOLDS.max_candidates. Never syncs Linet and never writes anything.
 */
export async function loadLinetCandidates(base44: any, plan: any) {
  if (!plan?.needed || !plan.eligible) return [];
  const limit = plan.max_candidates || LINET_ASSISTED_THRESHOLDS.max_candidates;
  const byId = new Map<string, any>();
  const queries: any[] = [];
  if (plan.identity.linet_supplier_account_id) queries.push({ supplier_account_id: plan.identity.linet_supplier_account_id });
  if (plan.identity.vat_id) queries.push({ supplier_vat_id: plan.identity.vat_id });
  for (const query of queries) {
    const rows = await base44.asServiceRole.entities.LinetPurchaseDocument.filter(query, undefined, limit);
    for (const row of (rows || [])) {
      if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
      if (byId.size >= limit) break;
    }
    if (byId.size >= limit) break;
  }
  return [...byId.values()];
}

/**
 * Route-shared orchestration: plan → (only if needed/eligible) bounded read → pure decision →
 * apply verified fills. Any read failure degrades to "no recovery", never to a guess.
 */
export async function runLinetAssistedRecovery(base44: any, extraction: any, options: any = {}) {
  const plan = planLinetAssistedRecovery(extraction, options);
  if (!plan.needed || !plan.eligible) {
    const decision = decideLinetAssistedRecovery({ extraction, plan, purchases: [], ...options });
    applyLinetAssistedRecovery(extraction, decision);
    return { plan, decision, purchases_count: 0 };
  }
  let purchases: any[] = [];
  let error: string | null = null;
  try {
    purchases = await loadLinetCandidates(base44, plan);
  } catch (err: any) {
    error = err?.message || String(err);
  }
  const decision = decideLinetAssistedRecovery({ extraction, plan, purchases, ...options });
  applyLinetAssistedRecovery(extraction, decision);
  if (error) extraction.linet_assisted_recovery.error = error;
  return { plan, decision, purchases_count: purchases.length, error };
}