import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  LINET_ASSISTED_REASON_CODES,
  LINET_ASSISTED_RECOVERY_VERSION,
  LINET_ASSISTED_THRESHOLDS,
  LINET_ASSISTED_WEIGHTS,
  applyLinetAssistedRecovery,
  applyRecoveryOutcomesToGate,
  buildLinetAssistedEvents,
  decideLinetAssistedRecovery,
  invoiceLinesFromExtraction,
  linetProvenanceValues,
  planLinetAssistedRecovery,
  remainingCriticalRecoveryFailures,
  scoreLinetCandidate
} from '../../shared/linetAssistedRecovery.ts';
import {
  CRITICAL_SUMMARY_FIELDS,
  missingCriticalFields,
  planLinetRecoveryReconciliationCheck,
  planLinetLineApplication,
  planPostReconciliationTruth,
  snapshotCriticalValues
} from '../../shared/linetAssistedRecovery.ts';
import { evaluateLinetMatch, selectLinetCandidate } from '../../shared/linetInvoiceReconciliation.ts';
import { matchSupplierProfile, validateProfileDocNumber } from '../../shared/invoiceSupplierProfiles.ts';
import { applyExtractionProvenance, applyLinetProvenance, parseProvenance } from '../../shared/invoiceProvenance.ts';

/**
 * P1-C REGRESSION HARNESS — admin-only, DB-FREE and LLM-FREE.
 * Every fixture below is synthetic: no entity is read, created, updated or deleted, no Linet call
 * is made and no extraction runs. It proves the safety properties of the Linet-assisted recovery:
 * exact-only evidence, mandatory unique strong candidate with margin, mandatory post-fill
 * confirmation, no overwrite of clear document values, and no interference with P1-A/P1-B.
 */

const STS_ID = '696f8b608af51a27cabb505e';
const INTECH_ID = '69c944172ddebc3eff81c9c3';
const ALPHONE_ID = '6a12f0860a0eb61e7a5c5e45';

const SUPPLIERS = [
  { id: STS_ID, name: 'אס.טי.אס מגה גרופ בע"מ', vat_id: '516542024', linet_supplier_account_id: '139', is_active: true },
  { id: INTECH_ID, name: 'פ.ט אינטק סחר בע"מ', vat_id: '516058989', linet_supplier_account_id: '151', is_active: true },
  // REAL data: Alphone HAS a verified VAT (515893683) but NO proven Linet account. A reliable
  // curated profile without a verified Linet account must never fall back to this VAT.
  { id: ALPHONE_ID, name: 'אולפון יבוא סחר בעמ', vat_id: '515893683', linet_supplier_account_id: null, is_active: true }
];

const STS_SUPPLIER = SUPPLIERS[0];
const ALPHONE_SUPPLIER = SUPPLIERS[2];

const stsProfile = () => matchSupplierProfile({ vat_id: '516542024' }, { suppliers: SUPPLIERS });
const alphoneProfile = () => matchSupplierProfile({ vat_id: '515893683' }, { suppliers: SUPPLIERS });
const conflictProfile = () => matchSupplierProfile({ vat_id: '516542024', sender_email: 'allphonedocs@gmail.com' }, { suppliers: SUPPLIERS });

const reliableResolution = (supplier: any) => ({ supplier, supplier_id: supplier?.id ?? null, reliable_for_auto_approval: !!supplier?.id, method: 'vat_id' });
const weakResolution = () => ({ supplier: null, supplier_id: null, reliable_for_auto_approval: false, method: 'none' });

/** Healthy STS extraction; overrides remove/replace exactly what a fixture needs. */
function extractionFixture(overrides: any = {}) {
  return {
    classification: 'TAX_INVOICE',
    should_skip: false,
    doc_type_he: 'חשבונית מס',
    supplier_name: 'אס.טי.אס מגה גרופ בע"מ',
    supplier_vat_id: '516542024',
    doc_number: '264002392',
    invoice_date: '2026-05-14',
    doc_date: '2026-05-14',
    due_date: null,
    currency: 'ILS',
    subtotal_before_vat: 1000,
    vat_amount: 180,
    total_with_vat: 1180,
    line_items: [{ line_number: 1, sku: 'SKU-1', product_name: 'מוצר א', quantity: 2, unit_price_before_vat: 500, line_total_before_vat: 1000 }],
    ...overrides
  };
}

function purchaseFixture(overrides: any = {}) {
  return {
    id: 'p-264002392',
    linet_doc_id: '13-9001',
    linet_doc_number: '9001',
    supplier_invoice_number: '264002392',
    normalized_invoice_number: '264002392',
    doc_date: '2026-05-14',
    supplier_account_id: '139',
    supplier_vat_id: '516542024',
    supplier_name: 'אס.טי.אס מגה גרופ',
    subtotal_before_vat: 1000,
    vat_amount: 180,
    total_with_vat: 1180,
    lines_json: JSON.stringify([{ sku: 'SKU-1', product_name: 'מוצר א', quantity: 2, line_total_before_vat: 1000 }]),
    matched_invoice_id: null,
    ...overrides
  };
}

/** A far-away STS purchase used as a low-scoring runner-up. */
const noiseFixture = (id = 'p-noise') => purchaseFixture({
  id,
  linet_doc_number: '8000',
  supplier_invoice_number: '111111111',
  normalized_invoice_number: '111111111',
  doc_date: '2026-02-02',
  subtotal_before_vat: 40,
  vat_amount: 7.2,
  total_with_vat: 47.2,
  lines_json: JSON.stringify([{ sku: 'SKU-OTHER', product_name: 'אחר', quantity: 9, line_total_before_vat: 40 }])
});

function runRecovery(extraction: any, purchases: any[], options: any = {}) {
  const profile_match = options.profile_match === undefined ? stsProfile() : options.profile_match;
  const supplier = options.supplier === undefined ? STS_SUPPLIER : options.supplier;
  const supplier_resolution = options.supplier_resolution === undefined ? reliableResolution(supplier) : options.supplier_resolution;
  const plan = planLinetAssistedRecovery(extraction, { profile_match, supplier, supplier_resolution, recovery_merge: options.recovery_merge || null });
  const decision = decideLinetAssistedRecovery({
    extraction,
    plan,
    purchases,
    profile_match,
    supplier,
    invoice_id: options.invoice_id || 'inv-under-test'
  });
  return { plan, decision, profile_match, supplier };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const cases: any[] = [];
    const check = (name: string, expected: any, actual: any) => {
      cases.push({ case: name, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual });
    };

    // ── weights / neutralized proximity ─────────────────────────────────────
    check('w1_documented_weights_and_thresholds',
      { supplier: 30, reference: 40, total: 25, date: 20, lines: 25, prox1: 0, prox3: 0, min_score: 85, min_anchors: 3, min_margin: 20, max_candidates: 500 },
      {
        supplier: LINET_ASSISTED_WEIGHTS.supplier_exact, reference: LINET_ASSISTED_WEIGHTS.exact_reference, total: LINET_ASSISTED_WEIGHTS.exact_total,
        date: LINET_ASSISTED_WEIGHTS.exact_date, lines: LINET_ASSISTED_WEIGHTS.line_agreement,
        prox1: LINET_ASSISTED_WEIGHTS.date_proximity_1d, prox3: LINET_ASSISTED_WEIGHTS.date_proximity_3d,
        min_score: LINET_ASSISTED_THRESHOLDS.min_score, min_anchors: LINET_ASSISTED_THRESHOLDS.min_anchors,
        min_margin: LINET_ASSISTED_THRESHOLDS.min_margin, max_candidates: LINET_ASSISTED_THRESHOLDS.max_candidates
      });

    // ── eligibility / zero extra work ───────────────────────────────────────
    const healthy = runRecovery(extractionFixture(), [purchaseFixture()]);
    check('e1_healthy_invoice_does_zero_candidate_work',
      { needed: false, eligible: false, attempted: false, applied: false, outcome: 'not_needed', reason_code: LINET_ASSISTED_REASON_CODES.NOT_NEEDED, candidates: 0 },
      { needed: healthy.plan.needed, eligible: healthy.plan.eligible, attempted: healthy.decision.attempted, applied: healthy.decision.applied, outcome: healthy.decision.outcome, reason_code: healthy.decision.reason_code, candidates: healthy.decision.candidates.length });

    const skipped = runRecovery(extractionFixture({ classification: 'OTHER', should_skip: true, doc_number: null }), [purchaseFixture()]);
    check('e2_other_skipped_document_is_never_revived',
      { eligible: false, outcome: 'not_eligible', reason_code: LINET_ASSISTED_REASON_CODES.SKIPPED_DOCUMENT, applied: false },
      { eligible: skipped.plan.eligible, outcome: skipped.decision.outcome, reason_code: skipped.decision.reason_code, applied: skipped.decision.applied });

    // ── STS partial / missing reference → unique selection of 264002392 ──────
    const missingRefExtraction = extractionFixture({ doc_number: null });
    const missingRef = runRecovery(missingRefExtraction, [purchaseFixture(), noiseFixture()]);
    check('f1_sts_missing_reference_uniquely_selects_264002392',
      { outcome: 'applied', applied: true, applied_fields: ['doc_number'], selected: 'p-264002392', score: 100, pattern: 'C_total_date_lines', margin: 70, post_fill: 'confirmed', guard: true },
      {
        outcome: missingRef.decision.outcome, applied: missingRef.decision.applied, applied_fields: missingRef.decision.applied_fields,
        selected: missingRef.decision.selected.linet_purchase_document_id, score: missingRef.decision.selected.score,
        pattern: missingRef.decision.selected.matched_pattern, margin: missingRef.decision.margin,
        post_fill: missingRef.decision.post_fill.level, guard: missingRef.decision.satisfies_profile_doc_guard
      });
    applyLinetAssistedRecovery(missingRefExtraction, missingRef.decision);
    check('f1b_recovered_reference_is_written_with_linet_audit_metadata',
      { doc_number: '264002392', applied_fields: ['doc_number'], outcome: 'applied', post_fill: 'confirmed' },
      { doc_number: missingRefExtraction.doc_number, applied_fields: missingRefExtraction.linet_assisted_recovery.applied_fields, outcome: missingRefExtraction.linet_assisted_recovery.outcome, post_fill: missingRefExtraction.linet_assisted_recovery.post_fill_level });

    // A profile-INVALID printed reference (10 digits) is treated as not clear and recovered.
    const partialRef = runRecovery(extractionFixture({ doc_number: 'IN2640002281' }), [purchaseFixture(), noiseFixture()]);
    check('f2_profile_invalid_reference_is_recovered_and_satisfies_the_profile_guard',
      { targets: ['doc_number'], applied_fields: ['doc_number'], value: '264002392', guard: true, recovered_valid: true },
      { targets: partialRef.plan.target_fields, applied_fields: partialRef.decision.applied_fields, value: partialRef.decision.apply.doc_number, guard: partialRef.decision.satisfies_profile_doc_guard, recovered_valid: validateProfileDocNumber(stsProfile(), partialRef.decision.apply.doc_number).valid });

    // ── missing date / missing total ────────────────────────────────────────
    const missingDate = runRecovery(extractionFixture({ invoice_date: null, doc_date: null }), [purchaseFixture(), noiseFixture()]);
    check('f3_missing_date_recovered_from_exact_supplier_reference_total',
      { applied_fields: ['invoice_date'], value: '2026-05-14', score: 120, pattern: 'A_reference_total', post_fill: 'confirmed' },
      { applied_fields: missingDate.decision.applied_fields, value: missingDate.decision.apply.invoice_date, score: missingDate.decision.selected.score, pattern: missingDate.decision.selected.matched_pattern, post_fill: missingDate.decision.post_fill.level });

    const missingTotal = runRecovery(extractionFixture({ total_with_vat: null }), [purchaseFixture(), noiseFixture()]);
    check('f4_missing_total_recovered_from_exact_supplier_reference_date',
      { applied_fields: ['total_with_vat'], value: 1180, pattern: 'B_reference_date', post_fill: 'confirmed' },
      { applied_fields: missingTotal.decision.applied_fields, value: missingTotal.decision.apply.total_with_vat, pattern: missingTotal.decision.selected.matched_pattern, post_fill: missingTotal.decision.post_fill.level });

    // ── ambiguity / insufficiency ───────────────────────────────────────────
    const dupA = purchaseFixture({ id: 'p-dup-a', supplier_invoice_number: '264002392', normalized_invoice_number: '264002392', lines_json: null });
    const dupB = purchaseFixture({ id: 'p-dup-b', linet_doc_number: '9002', supplier_invoice_number: '264009999', normalized_invoice_number: '264009999', lines_json: null });
    const dateTotalDup = runRecovery(extractionFixture({ doc_number: null }), [dupA, dupB]);
    check('f5_date_total_duplicates_without_line_distinction_never_apply',
      { outcome: 'none', reason_code: LINET_ASSISTED_REASON_CODES.NONE, applied: false, top_scores: [75, 75] },
      { outcome: dateTotalDup.decision.outcome, reason_code: dateTotalDup.decision.reason_code, applied: dateTotalDup.decision.applied, top_scores: dateTotalDup.decision.candidates.map((c: any) => c.score) });

    // One strong candidate, runner-up within 20 points → ambiguous, nothing applied.
    const marginStrong = purchaseFixture({ id: 'p-margin-strong', lines_json: null });
    const marginRunnerUp = purchaseFixture({ id: 'p-margin-runner', linet_doc_number: '9003', lines_json: JSON.stringify([{ sku: 'SKU-1', product_name: 'מוצר א', quantity: 9, line_total_before_vat: 1000 }]) });
    const marginCase = runRecovery(extractionFixture({ invoice_date: null, doc_date: null }), [marginStrong, marginRunnerUp]);
    check('f6_leading_candidate_without_20_point_margin_is_ambiguous',
      { outcome: 'ambiguous', reason_code: LINET_ASSISTED_REASON_CODES.AMBIGUOUS, applied: false, margin: 0, review: true },
      { outcome: marginCase.decision.outcome, reason_code: marginCase.decision.reason_code, applied: marginCase.decision.applied, margin: marginCase.decision.margin, review: marginCase.decision.requires_manual_review });

    const twoStrong = runRecovery(extractionFixture({ invoice_date: null, doc_date: null }), [
      purchaseFixture({ id: 'p-strong-1' }),
      purchaseFixture({ id: 'p-strong-2', linet_doc_number: '9004' })
    ]);
    check('f7_two_equally_strong_candidates_never_choose_the_first',
      { outcome: 'ambiguous', reason_code: LINET_ASSISTED_REASON_CODES.AMBIGUOUS, applied: false, selected: null },
      { outcome: twoStrong.decision.outcome, reason_code: twoStrong.decision.reason_code, applied: twoStrong.decision.applied, selected: twoStrong.decision.selected });

    const weak = runRecovery(extractionFixture({ doc_number: null, total_with_vat: null, subtotal_before_vat: null, vat_amount: null, line_items: [] }), [
      purchaseFixture({ id: 'p-weak', lines_json: null, total_with_vat: null })
    ]);
    check('f8_insufficient_anchors_and_score_apply_nothing',
      { outcome: 'none', applied: false, score: 50, anchors: ['supplier_exact', 'exact_date'] },
      { outcome: weak.decision.outcome, applied: weak.decision.applied, score: weak.decision.candidates[0].score, anchors: weak.decision.candidates[0].anchors });

    const noCandidates = runRecovery(extractionFixture({ doc_number: null }), []);
    check('f9_no_candidate_rows_reports_no_candidates',
      { outcome: 'none', reason_code: LINET_ASSISTED_REASON_CODES.NO_CANDIDATES, applied: false },
      { outcome: noCandidates.decision.outcome, reason_code: noCandidates.decision.reason_code, applied: noCandidates.decision.applied });

    // ── hard conflicts: no overwrite, ever ──────────────────────────────────
    const refMismatchExtraction = extractionFixture({ total_with_vat: null });
    const refMismatch = runRecovery(refMismatchExtraction, [purchaseFixture({ supplier_invoice_number: '264009999', normalized_invoice_number: '264009999' })]);
    applyLinetAssistedRecovery(refMismatchExtraction, refMismatch.decision);
    check('c1_clear_profile_valid_reference_mismatch_is_conflict_and_never_overwrites',
      { outcome: 'conflict', reason_code: LINET_ASSISTED_REASON_CODES.CONFLICT, applied: false, conflicts: ['LINET_REFERENCE_CONFLICT'], doc_number: '264002392', total: null },
      { outcome: refMismatch.decision.outcome, reason_code: refMismatch.decision.reason_code, applied: refMismatch.decision.applied, conflicts: refMismatch.decision.candidates[0].conflicts, doc_number: refMismatchExtraction.doc_number, total: refMismatchExtraction.total_with_vat });

    const totalDateMismatchExtraction = extractionFixture({ doc_number: null });
    const totalDateMismatch = runRecovery(totalDateMismatchExtraction, [purchaseFixture({ total_with_vat: 999, doc_date: '2026-01-01' })]);
    applyLinetAssistedRecovery(totalDateMismatchExtraction, totalDateMismatch.decision);
    check('c2_clear_total_and_date_mismatch_are_conflicts_and_change_nothing',
      { outcome: 'conflict', conflicts: ['LINET_TOTAL_CONFLICT', 'LINET_DATE_CONFLICT'], applied: false, total: 1180, date: '2026-05-14', doc_number: null },
      { outcome: totalDateMismatch.decision.outcome, conflicts: totalDateMismatch.decision.candidates[0].conflicts, applied: totalDateMismatch.decision.applied, total: totalDateMismatchExtraction.total_with_vat, date: totalDateMismatchExtraction.doc_date, doc_number: totalDateMismatchExtraction.doc_number });

    const supplierConflict = runRecovery(extractionFixture({ doc_number: null }), [purchaseFixture({ supplier_vat_id: '516058989', supplier_account_id: '151' })]);
    check('c3_supplier_account_or_vat_conflict_is_a_hard_conflict',
      { outcome: 'conflict', applied: false, conflicts: ['LINET_SUPPLIER_CONFLICT'], identity: 'conflict' },
      { outcome: supplierConflict.decision.outcome, applied: supplierConflict.decision.applied, conflicts: supplierConflict.decision.candidates[0].conflicts, identity: supplierConflict.decision.candidates[0].values.supplier_identity });

    const lineConflict = runRecovery(extractionFixture({ doc_number: null }), [purchaseFixture({ lines_json: JSON.stringify([{ sku: 'SKU-1', product_name: 'מוצר א', quantity: 9, line_total_before_vat: 1000 }]) })]);
    check('c4_line_quantity_contradiction_is_a_hard_conflict',
      { outcome: 'conflict', applied: false, conflicts: ['LINET_LINE_CONFLICT'], line_conflict: true },
      { outcome: lineConflict.decision.outcome, applied: lineConflict.decision.applied, conflicts: lineConflict.decision.candidates[0].conflicts, line_conflict: lineConflict.decision.candidates[0].values.line_conflict });

    const owned = runRecovery(extractionFixture({ doc_number: null }), [purchaseFixture({ matched_invoice_id: 'another-invoice' })]);
    check('c5_purchase_already_owned_by_another_invoice_is_blocked',
      { outcome: 'conflict', reason_code: LINET_ASSISTED_REASON_CODES.ALREADY_OWNED, applied: false, conflicts: ['LINET_PURCHASE_ALREADY_MATCHED'] },
      { outcome: owned.decision.outcome, reason_code: owned.decision.reason_code, applied: owned.decision.applied, conflicts: owned.decision.candidates[0].conflicts });

    // ── no fuzzy / contains / near-text matching anywhere ────────────────────
    const nearRefClear = scoreLinetCandidate(purchaseFixture({ supplier_invoice_number: '26400239', normalized_invoice_number: '26400239' }), {
      extraction: extractionFixture(),
      plan: planLinetAssistedRecovery(extractionFixture({ total_with_vat: null }), { profile_match: stsProfile(), supplier: STS_SUPPLIER, supplier_resolution: reliableResolution(STS_SUPPLIER) }),
      profile_match: stsProfile(),
      supplier: STS_SUPPLIER,
      invoice_lines: invoiceLinesFromExtraction(extractionFixture()),
      invoice_id: 'inv-under-test'
    });
    const nearRefMissing = runRecovery(extractionFixture({ doc_number: 'IN2640002281' }), [purchaseFixture({ supplier_invoice_number: '2640002', normalized_invoice_number: '2640002', total_with_vat: 7, doc_date: '2026-03-03', lines_json: null })]);
    check('n1_prefix_or_substring_reference_is_never_exact_and_never_selects',
      // An unclear reference gives the near-text candidate NO exact-reference credit, so it can only
      // ever end as conflict/none — never as a selection.
      { clear_prefix: { has_exact_reference_anchor: false, conflicts: ['LINET_REFERENCE_CONFLICT'], strong: false }, unclear_prefix: { weak_context: false, has_exact_reference_anchor: false, outcome: 'conflict', applied: false } },
      {
        clear_prefix: { has_exact_reference_anchor: nearRefClear.anchors.includes('exact_reference'), conflicts: nearRefClear.conflicts, strong: nearRefClear.strong },
        unclear_prefix: { weak_context: nearRefMissing.decision.candidates[0].weak_reference_context, has_exact_reference_anchor: nearRefMissing.decision.candidates[0].anchors.includes('exact_reference'), outcome: nearRefMissing.decision.outcome, applied: nearRefMissing.decision.applied }
      });

    // ── post-fill confirmation is mandatory ─────────────────────────────────
    const unconfirmedExtraction = extractionFixture({ total_with_vat: null });
    const unconfirmed = runRecovery(unconfirmedExtraction, [purchaseFixture({ total_with_vat: null })]);
    applyLinetAssistedRecovery(unconfirmedExtraction, unconfirmed.decision);
    check('p1_post_fill_not_confirmed_applies_nothing',
      { outcome: 'post_fill_unconfirmed', reason_code: LINET_ASSISTED_REASON_CODES.POST_FILL_UNCONFIRMED, applied: false, unfilled: ['total_with_vat'], total_still_null: true, review: true },
      { outcome: unconfirmed.decision.outcome, reason_code: unconfirmed.decision.reason_code, applied: unconfirmed.decision.applied, unfilled: unconfirmed.decision.unfilled_target_fields, total_still_null: unconfirmedExtraction.total_with_vat === null, review: unconfirmed.decision.requires_manual_review });

    // Every target field filled, yet the shared matcher still refuses → nothing is applied.
    const simRejectExtraction = extractionFixture({ doc_number: null });
    const simReject = runRecovery(simRejectExtraction, [purchaseFixture({ supplier_invoice_number: 'REF-ABC', normalized_invoice_number: 'REF-ABC' }), noiseFixture()]);
    applyLinetAssistedRecovery(simRejectExtraction, simReject.decision);
    check('p2_simulated_post_fill_match_must_return_confirmed_or_nothing_is_applied',
      { outcome: 'post_fill_unconfirmed', post_fill: 'none', applied: false, doc_number_still_null: true, review: true },
      { outcome: simReject.decision.outcome, post_fill: simReject.decision.post_fill.level, applied: simReject.decision.applied, doc_number_still_null: simRejectExtraction.doc_number === null, review: simReject.decision.requires_manual_review });

    // ── existing exact reconciliation semantics still hold post-fill ─────────
    const reconciledInvoice = { doc_number: '264002392', doc_date: '2026-05-14', total_with_vat: 1180 };
    const reconMatch = evaluateLinetMatch(reconciledInvoice, purchaseFixture(), invoiceLinesFromExtraction(extractionFixture()), STS_SUPPLIER);
    const reconSelection = selectLinetCandidate([{ purchase: purchaseFixture(), match: reconMatch }], { invoiceId: 'inv-under-test' });
    const reconOwned = selectLinetCandidate([{ purchase: purchaseFixture({ matched_invoice_id: 'another-invoice' }), match: reconMatch }], { invoiceId: 'inv-under-test' });
    check('r1_post_fill_state_reconciles_to_the_same_candidate_and_ownership_still_protects',
      { level: 'confirmed', conflicts: [], decision: 'confirmed', selected: 'p-264002392', owned_decision: 'blocked', owned_reason: 'LINET_PURCHASE_ALREADY_MATCHED' },
      { level: reconMatch.level, conflicts: reconMatch.conflict_codes, decision: reconSelection.decision, selected: reconSelection.selected?.purchase?.id ?? null, owned_decision: reconOwned.decision, owned_reason: reconOwned.reason_code });

    // ── identity gating ─────────────────────────────────────────────────────
    const alphonePlan = planLinetAssistedRecovery(extractionFixture({ doc_number: null, supplier_vat_id: '515893683', supplier_name: 'אולפון יבוא סחר' }), {
      profile_match: alphoneProfile(), supplier: ALPHONE_SUPPLIER, supplier_resolution: reliableResolution(ALPHONE_SUPPLIER)
    });
    const noProfilePlan = planLinetAssistedRecovery(extractionFixture({ doc_number: null }), { profile_match: null, supplier: null, supplier_resolution: weakResolution() });
    const conflictPlan = planLinetAssistedRecovery(extractionFixture({ doc_number: null }), { profile_match: conflictProfile(), supplier: null, supplier_resolution: weakResolution() });
    const weakSupplierPlan = planLinetAssistedRecovery(extractionFixture({ doc_number: null }), { profile_match: stsProfile(), supplier: null, supplier_resolution: weakResolution() });
    check('i1_alphone_null_account_weak_and_conflicting_evidence_never_recover',
      {
        alphone: { needed: true, eligible: false, code: LINET_ASSISTED_REASON_CODES.NO_EXACT_IDENTITY },
        no_profile: { eligible: false, code: LINET_ASSISTED_REASON_CODES.NO_EXACT_IDENTITY },
        profile_conflict: { eligible: false, code: LINET_ASSISTED_REASON_CODES.NO_EXACT_IDENTITY },
        // A reliable STS profile carries a VERIFIED Linet account (139), so it alone is exact identity.
        sts_profile_only: { eligible: true, account: '139', source: 'profile_linet_account' }
      },
      {
        alphone: { needed: alphonePlan.needed, eligible: alphonePlan.eligible, code: alphonePlan.reason_code },
        no_profile: { eligible: noProfilePlan.eligible, code: noProfilePlan.reason_code },
        profile_conflict: { eligible: conflictPlan.eligible, code: conflictPlan.reason_code },
        sts_profile_only: { eligible: weakSupplierPlan.eligible, account: weakSupplierPlan.identity.linet_supplier_account_id, source: weakSupplierPlan.identity.source }
      });

    const alphoneDecision = decideLinetAssistedRecovery({ extraction: extractionFixture({ doc_number: null }), plan: alphonePlan, purchases: [purchaseFixture()], profile_match: alphoneProfile(), supplier: ALPHONE_SUPPLIER, invoice_id: 'inv-under-test' });
    check('i2_ineligible_identity_scores_no_candidate_at_all',
      { outcome: 'not_eligible', attempted: false, applied: false, candidates: 0 },
      { outcome: alphoneDecision.outcome, attempted: alphoneDecision.attempted, applied: alphoneDecision.applied, candidates: alphoneDecision.candidates.length });

    // ── P1-A interplay ──────────────────────────────────────────────────────
    const conflictMerge = {
      requires_manual_review: true,
      conflict_fields: ['doc_number'],
      unresolved_fields: [],
      review_reasons_he: ['CRITICAL_FIELD_CONFLICT (doc_number): סתירה בין המעברים: "A" מול "B".'],
      decisions: [{ field: 'doc_number', first_pass: { value: 'A' }, second_pass: { value: 'B' } }]
    };
    const conflictRemaining = remainingCriticalRecoveryFailures(conflictMerge, { applied: true, applied_fields: ['doc_number'] });
    const conflictGate = { passed: true, failures: [] as string[] };
    applyRecoveryOutcomesToGate(conflictGate, { merge: conflictMerge, decision: { applied: true, applied_fields: ['doc_number'] }, profile_doc_check: null });
    check('a1_p1a_conflict_is_never_cleared_by_a_linet_agreement',
      { conflict_fields: ['doc_number'], resolved_by_linet: [], review: true, gate_passed: false, gate_failures: 1 },
      { conflict_fields: conflictRemaining.conflict_fields, resolved_by_linet: conflictRemaining.resolved_by_linet, review: conflictRemaining.requires_manual_review, gate_passed: conflictGate.passed, gate_failures: conflictGate.failures.length });

    const unresolvedMerge = {
      requires_manual_review: true,
      conflict_fields: [],
      unresolved_fields: ['invoice_date'],
      review_reasons_he: ['CRITICAL_FIELD_RECOVERY_UNRESOLVED (invoice_date): הערך אינו מודפס במסמך או לא אותר במעבר השני.'],
      decisions: [{ field: 'invoice_date', first_pass: { value: null }, second_pass: null }]
    };
    const resolvedGate = { passed: true, failures: [] as string[] };
    const resolvedOutcome = applyRecoveryOutcomesToGate(resolvedGate, { merge: unresolvedMerge, decision: missingDate.decision, profile_doc_check: null });
    const notResolvedGate = { passed: true, failures: [] as string[] };
    applyRecoveryOutcomesToGate(notResolvedGate, { merge: unresolvedMerge, decision: unconfirmed.decision, profile_doc_check: null });
    check('a2_unresolved_field_clears_only_via_strong_post_fill_confirmed_recovery',
      { resolved: { resolved_by_linet: ['invoice_date'], remaining: [], review: false, gate_passed: true }, not_resolved: { gate_passed: false, has_failure: true } },
      {
        resolved: { resolved_by_linet: resolvedOutcome.remaining.resolved_by_linet, remaining: resolvedOutcome.remaining.remaining_unresolved_fields, review: resolvedOutcome.remaining.requires_manual_review, gate_passed: resolvedGate.passed },
        not_resolved: { gate_passed: notResolvedGate.passed, has_failure: notResolvedGate.failures.length > 0 }
      });

    // Same profile-invalid reference read twice = clear conflicting evidence → never overwritten.
    const repeatedMerge = {
      requires_manual_review: true,
      conflict_fields: [],
      unresolved_fields: ['doc_number'],
      review_reasons_he: ['CRITICAL_FIELD_RECOVERY_UNRESOLVED (doc_number): שני המעברים קראו את אותו מספר מסמך שאינו תואם את תבניות הפרופיל STS.'],
      decisions: [{ field: 'doc_number', first_pass: { value: 'IN2640002281' }, second_pass: { value: 'IN2640002281' } }]
    };
    const repeatedExtraction = extractionFixture({ doc_number: 'IN2640002281' });
    const repeated = runRecovery(repeatedExtraction, [purchaseFixture()], { recovery_merge: repeatedMerge });
    applyLinetAssistedRecovery(repeatedExtraction, repeated.decision);
    const repeatedGate = { passed: true, failures: [] as string[] };
    const repeatedOutcome = applyRecoveryOutcomesToGate(repeatedGate, { merge: repeatedMerge, decision: repeated.decision, profile_doc_check: validateProfileDocNumber(stsProfile(), repeatedExtraction.doc_number) });
    check('a3_same_profile_invalid_reading_twice_cannot_be_overwritten_by_linet',
      { blocked: ['doc_number'], targets: [], needed: false, applied: false, doc_number: 'IN2640002281', guard_kept: true, gate_passed: false },
      { blocked: repeated.plan.blocked_fields, targets: repeated.plan.target_fields, needed: repeated.plan.needed, applied: repeated.decision.applied, doc_number: repeatedExtraction.doc_number, guard_kept: repeatedOutcome.profile_guard_kept, gate_passed: repeatedGate.passed });

    // A missing/failed second reading MAY still be recovered when every strong rule passes.
    const missingSecondMerge = {
      requires_manual_review: true,
      conflict_fields: [],
      unresolved_fields: ['doc_number'],
      review_reasons_he: ['CRITICAL_FIELD_RECOVERY_UNRESOLVED (doc_number): הערך אינו מודפס במסמך או לא אותר במעבר השני.'],
      decisions: [{ field: 'doc_number', first_pass: { value: null }, second_pass: null }]
    };
    const missingSecond = runRecovery(extractionFixture({ doc_number: null }), [purchaseFixture(), noiseFixture()], { recovery_merge: missingSecondMerge });
    const missingSecondGate = { passed: true, failures: [] as string[] };
    const missingSecondOutcome = applyRecoveryOutcomesToGate(missingSecondGate, { merge: missingSecondMerge, decision: missingSecond.decision, profile_doc_check: null });
    check('a4_missing_second_reading_is_recoverable_under_all_strong_rules',
      { blocked: [], applied_fields: ['doc_number'], resolved_by_linet: ['doc_number'], gate_passed: true },
      { blocked: missingSecond.plan.blocked_fields, applied_fields: missingSecond.decision.applied_fields, resolved_by_linet: missingSecondOutcome.remaining.resolved_by_linet, gate_passed: missingSecondGate.passed });

    // The P1-B guard is kept whenever P1-C did NOT replace the implausible reference.
    const guardKeptGate = { passed: true, failures: [] as string[] };
    const guardKept = applyRecoveryOutcomesToGate(guardKeptGate, { merge: null, decision: refMismatch.decision, profile_doc_check: { applicable: true, valid: false, reason_code: 'PROFILE_DOC_NUMBER_IMPLAUSIBLE', reason: 'לא תואם תבנית' } });
    const guardSatisfiedGate = { passed: true, failures: [] as string[] };
    const guardSatisfied = applyRecoveryOutcomesToGate(guardSatisfiedGate, { merge: null, decision: partialRef.decision, profile_doc_check: { applicable: true, valid: false, reason_code: 'PROFILE_DOC_NUMBER_IMPLAUSIBLE', reason: 'לא תואם תבנית' } });
    check('a5_profile_doc_guard_satisfied_only_when_linet_actually_replaced_the_reference',
      { kept: { guard_kept: true, gate_passed: false }, satisfied: { guard_kept: false, gate_passed: true } },
      { kept: { guard_kept: guardKept.profile_guard_kept, gate_passed: guardKeptGate.passed }, satisfied: { guard_kept: guardSatisfied.profile_guard_kept, gate_passed: guardSatisfiedGate.passed } });

    // P1-C never approves by itself: its own review outcomes always reach the gate.
    const p1cReviewGate = { passed: true, failures: [] as string[] };
    applyRecoveryOutcomesToGate(p1cReviewGate, { merge: null, decision: twoStrong.decision, profile_doc_check: null });
    check('a6_p1c_review_outcomes_always_reach_the_gate',
      { gate_passed: false, failures: 1 },
      { gate_passed: p1cReviewGate.passed, failures: p1cReviewGate.failures.length });

    // ── provenance / events ─────────────────────────────────────────────────
    const baseProvenance = applyExtractionProvenance({
      existingJson: null,
      values: { supplier: STS_ID, doc_number: null, doc_date: '2026-05-14', subtotal_before_vat: 1000, vat_amount: 180, total_with_vat: 1180 },
      supplierName: 'אס.טי.אס מגה גרופ בע"מ',
      reason: 'gate',
      at: '2026-08-25T09:00:00Z'
    });
    const linetValues = linetProvenanceValues(missingRef.decision);
    const withLinet = applyLinetProvenance({ existingJson: baseProvenance.json, level: 'confirmed', values: linetValues, appliedAsSourceOfTruth: true, reason: LINET_ASSISTED_REASON_CODES.APPLIED, at: '2026-08-25T09:05:00Z' });
    const state = parseProvenance(withLinet.json);
    check('v1_linet_is_selected_only_for_applied_fields_and_original_ai_stay_intact',
      {
        linet_values: { doc_number: '264002392' },
        selected_doc_number: { value: '264002392', source: 'LINET' },
        selected_total_source: 'VALIDATED',
        original_doc_number: null,
        ai_doc_number: null,
        original_total: 1180
      },
      {
        linet_values: linetValues,
        selected_doc_number: { value: state.selected.doc_number.value, source: state.selected.doc_number.source },
        selected_total_source: state.selected.total_with_vat.source,
        original_doc_number: state.original.fields.doc_number,
        ai_doc_number: state.ai.fields.doc_number,
        original_total: state.original.fields.total_with_vat
      });

    check('v2_no_provenance_selection_when_nothing_was_applied',
      { values: {}, selection_changed: false },
      { values: linetProvenanceValues(unconfirmed.decision), selection_changed: applyLinetProvenance({ existingJson: baseProvenance.json, level: 'possible', values: {}, appliedAsSourceOfTruth: false, at: '2026-08-25T09:06:00Z' }).selection_changed });

    const appliedEvents = buildLinetAssistedEvents(missingRef.decision, '2026-08-25T09:05:00Z');
    const conflictEvents = buildLinetAssistedEvents(refMismatch.decision, '2026-08-25T09:05:00Z');
    const noEvents = buildLinetAssistedEvents(healthy.decision, '2026-08-25T09:05:00Z');
    check('v3_compact_events_carry_no_document_text',
      {
        applied: { type: 'LINET_CONFIRMED', outcome: 'applied', stage: 'P1C', applied_fields: ['doc_number'] },
        conflict: { type: 'LINET_CONFLICT', outcome: 'manual_review' },
        not_attempted: 0
      },
      {
        applied: { type: appliedEvents[0].type, outcome: appliedEvents[0].outcome, stage: appliedEvents[0].meta.stage, applied_fields: appliedEvents[0].meta.applied_fields },
        conflict: { type: conflictEvents[0].type, outcome: conflictEvents[0].outcome },
        not_attempted: noEvents.length
      });

    // ── QA #3: reliable Alphone profile + reliable stored supplier VAT is STILL ineligible ───
    const alphoneWithVatPlan = planLinetAssistedRecovery(extractionFixture({ doc_number: null, supplier_vat_id: '515893683', supplier_name: 'אולפון יבוא סחר' }), {
      profile_match: alphoneProfile(), supplier: ALPHONE_SUPPLIER, supplier_resolution: reliableResolution(ALPHONE_SUPPLIER)
    });
    check('q3_reliable_profile_without_linet_account_never_falls_back_to_supplier_vat',
      { supplier_vat_present: '515893683', profile_reliable: true, eligible: false, code: LINET_ASSISTED_REASON_CODES.NO_EXACT_IDENTITY, identity: { account: null, vat: null, source: 'none' } },
      {
        supplier_vat_present: ALPHONE_SUPPLIER.vat_id,
        profile_reliable: alphoneProfile().reliable_for_auto_approval,
        eligible: alphoneWithVatPlan.eligible,
        code: alphoneWithVatPlan.reason_code,
        identity: { account: alphoneWithVatPlan.identity.linet_supplier_account_id, vat: alphoneWithVatPlan.identity.vat_id, source: alphoneWithVatPlan.identity.source }
      });

    // ── QA #1: EXACT production options shape (recovery_merge passed) blocks the repeated reading ──
    const routeOptions = (extraction: any, merge: any) => ({
      profile_match: stsProfile(),
      supplier: STS_SUPPLIER,
      supplier_resolution: reliableResolution(STS_SUPPLIER),
      recovery_merge: merge,
      invoice_id: 'inv-under-test'
    });
    const routeExtraction = extractionFixture({ doc_number: 'IN2640002281' });
    const routePlan = planLinetAssistedRecovery(routeExtraction, routeOptions(routeExtraction, repeatedMerge));
    const routeDecision = decideLinetAssistedRecovery({ extraction: routeExtraction, plan: routePlan, purchases: [purchaseFixture()], ...routeOptions(routeExtraction, repeatedMerge) });
    applyLinetAssistedRecovery(routeExtraction, routeDecision);
    const routeGate = { passed: true, failures: [] as string[] };
    const routeOutcome = applyRecoveryOutcomesToGate(routeGate, { merge: repeatedMerge, decision: routeDecision, profile_doc_check: validateProfileDocNumber(stsProfile(), routeExtraction.doc_number) });
    // Without the merge the same call could not see the repeated reading — proven side by side.
    const noMergePlan = planLinetAssistedRecovery(extractionFixture({ doc_number: 'IN2640002281' }), routeOptions(routeExtraction, null));
    check('q1_route_parity_options_block_same_bad_reading_twice',
      { blocked: ['doc_number'], targets: [], applied: false, doc_number: 'IN2640002281', resolved_by_linet: [], guard_kept: true, gate_passed: false, without_merge_targets: ['doc_number'] },
      {
        blocked: routePlan.blocked_fields, targets: routePlan.target_fields, applied: routeDecision.applied,
        doc_number: routeExtraction.doc_number, resolved_by_linet: routeOutcome.remaining.resolved_by_linet,
        guard_kept: routeOutcome.profile_guard_kept, gate_passed: routeGate.passed, without_merge_targets: noMergePlan.target_fields
      });

    // ── QA #2: route ORDER — snapshot before P1-C, then extraction/recovery/Linet provenance ──
    const orderExtraction = extractionFixture({ doc_number: null });
    const orderSnapshot = snapshotCriticalValues(orderExtraction, { supplier_id: STS_ID, round: true });
    const orderRecovery = runRecovery(orderExtraction, [purchaseFixture(), noiseFixture()]);
    applyLinetAssistedRecovery(orderExtraction, orderRecovery.decision);
    const orderProvenance = applyExtractionProvenance({ existingJson: null, values: orderSnapshot, supplierName: 'אס.טי.אס מגה גרופ בע"מ', reason: 'gate', at: '2026-08-25T10:00:00Z' });
    const orderLinetValues = linetProvenanceValues(orderRecovery.decision);
    const orderState = parseProvenance(applyLinetProvenance({ existingJson: orderProvenance.json, level: 'confirmed', values: orderLinetValues, appliedAsSourceOfTruth: true, reason: LINET_ASSISTED_REASON_CODES.APPLIED, at: '2026-08-25T10:05:00Z' }).json);
    check('q2_pre_linet_snapshot_keeps_original_and_ai_free_of_linet_values',
      {
        extraction_after: { doc_number: '264002392', doc_date: '2026-05-14' },
        original: { doc_number: null, doc_date: '2026-05-14', total_with_vat: 1180 },
        ai: { doc_number: null, doc_date: '2026-05-14' },
        selected: { doc_number: 'LINET', doc_date: 'VALIDATED', total_with_vat: 'VALIDATED' }
      },
      {
        extraction_after: { doc_number: orderExtraction.doc_number, doc_date: orderExtraction.doc_date },
        original: { doc_number: orderState.original.fields.doc_number, doc_date: orderState.original.fields.doc_date, total_with_vat: orderState.original.fields.total_with_vat },
        ai: { doc_number: orderState.ai.fields.doc_number, doc_date: orderState.ai.fields.doc_date },
        selected: { doc_number: orderState.selected.doc_number.source, doc_date: orderState.selected.doc_date.source, total_with_vat: orderState.selected.total_with_vat.source }
      });

    // ── QA #4: post-recovery summary drops the filled field, keeps unrelated failures ────────
    const summaryExtraction = extractionFixture({ doc_number: null, subtotal_before_vat: 900 });
    const missingBefore = missingCriticalFields(summaryExtraction);
    const summaryRecovery = runRecovery(summaryExtraction, [purchaseFixture(), noiseFixture()]);
    applyLinetAssistedRecovery(summaryExtraction, summaryRecovery.decision);
    const missingAfter = missingCriticalFields(summaryExtraction);
    const mathStillBroken = Math.abs((summaryExtraction.subtotal_before_vat + summaryExtraction.vat_amount) - summaryExtraction.total_with_vat) > 0.05;
    check('q4_post_recovery_summary_drops_filled_field_and_keeps_other_failures',
      { fields: CRITICAL_SUMMARY_FIELDS, before: ['doc_number'], after: [], applied: true, math_failure_kept: true },
      { fields: CRITICAL_SUMMARY_FIELDS, before: missingBefore, after: missingAfter, applied: summaryRecovery.decision.applied, math_failure_kept: mathStillBroken });

    // ── QA #5: post-persist reconciliation must confirm the SAME purchase (pure plans) ───────
    const appliedDecision = missingRef.decision;
    const sameCandidate = planLinetRecoveryReconciliationCheck(appliedDecision, { invoice_result: { invoice_id: 'inv-under-test', status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-264002392' } });
    const otherCandidate = planLinetRecoveryReconciliationCheck(appliedDecision, { invoice_result: { status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-other' } });
    const conflictRecon = planLinetRecoveryReconciliationCheck(appliedDecision, { invoice_result: { status: 'conflict' } });
    const possibleRecon = planLinetRecoveryReconciliationCheck(appliedDecision, { invoice_result: { status: 'possible_match' } });
    const ownedRecon = planLinetRecoveryReconciliationCheck(appliedDecision, { invoice_result: { status: 'blocked', linet_purchase_document_id: 'p-264002392' } });
    const missingRecon = planLinetRecoveryReconciliationCheck(appliedDecision, {});
    const exceptionRecon = planLinetRecoveryReconciliationCheck(appliedDecision, { error: 'timeout' });
    const notAppliedRecon = planLinetRecoveryReconciliationCheck(unconfirmed.decision, { invoice_result: { status: 'conflict' } });
    check('q5_reconciliation_must_confirm_the_same_selected_purchase',
      {
        same: { verified: true, downgrade: false, writes: 0 },
        different: { downgrade: true, code: LINET_ASSISTED_REASON_CODES.RECONCILIATION_MISMATCH, status: 'ממתין לאימות', passed: false, approved: false, event: 'LINET_POSSIBLE' },
        conflict: { downgrade: true }, possible: { downgrade: true }, owned: { downgrade: true }, missing: { downgrade: true }, exception: { downgrade: true },
        not_applied: { applicable: false, downgrade: false, verified: false }
      },
      {
        same: { verified: sameCandidate.verified, downgrade: sameCandidate.downgrade, writes: Object.keys(sameCandidate.writes).length },
        different: { downgrade: otherCandidate.downgrade, code: otherCandidate.reason_code, status: otherCandidate.writes.extraction_status, passed: otherCandidate.writes.validation_passed, approved: otherCandidate.writes.auto_approved, event: otherCandidate.event.type },
        conflict: { downgrade: conflictRecon.downgrade }, possible: { downgrade: possibleRecon.downgrade }, owned: { downgrade: ownedRecon.downgrade }, missing: { downgrade: missingRecon.downgrade }, exception: { downgrade: exceptionRecon.downgrade },
        not_applied: { applicable: notAppliedRecon.applicable, downgrade: notAppliedRecon.downgrade, verified: notAppliedRecon.verified }
      });

    // ── QA #6: line-apply ORDERING gate — wrong Linet lines can never land before the downgrade ──
    const matchedSame = { invoice_id: 'inv-under-test', status: 'matched' };
    const applySame = planLinetLineApplication({ decision: appliedDecision, invoice_result: matchedSame, recon_check: sameCandidate });
    const applyDifferent = planLinetLineApplication({ decision: appliedDecision, invoice_result: { status: 'matched' }, recon_check: otherCandidate });
    const applyConflict = planLinetLineApplication({ decision: appliedDecision, invoice_result: { status: 'conflict' }, recon_check: conflictRecon });
    const applyPossible = planLinetLineApplication({ decision: appliedDecision, invoice_result: { status: 'possible_match' }, recon_check: possibleRecon });
    const applyMissing = planLinetLineApplication({ decision: appliedDecision, invoice_result: null, recon_check: missingRecon });
    const applyException = planLinetLineApplication({ decision: appliedDecision, invoice_result: null, recon_check: exceptionRecon });
    // Non-P1C matched flow keeps its existing behaviour untouched.
    const applyNonP1c = planLinetLineApplication({ decision: unconfirmed.decision, invoice_result: matchedSame, recon_check: notAppliedRecon });
    const applyNonP1cUnmatched = planLinetLineApplication({ decision: unconfirmed.decision, invoice_result: { status: 'conflict' }, recon_check: notAppliedRecon });
    check('q6_line_apply_blocked_until_same_purchase_is_verified',
      {
        same: { allowed: true, p1c: true },
        different: { allowed: false, p1c: true, code: LINET_ASSISTED_REASON_CODES.RECONCILIATION_MISMATCH },
        conflict: false, possible: false, missing: false, exception: false,
        non_p1c_matched: { allowed: true, p1c: false }, non_p1c_unmatched: { allowed: false, p1c: false }
      },
      {
        same: { allowed: applySame.allowed, p1c: applySame.p1c_applied },
        different: { allowed: applyDifferent.allowed, p1c: applyDifferent.p1c_applied, code: applyDifferent.reason_code },
        conflict: applyConflict.allowed, possible: applyPossible.allowed, missing: applyMissing.allowed, exception: applyException.allowed,
        non_p1c_matched: { allowed: applyNonP1c.allowed, p1c: applyNonP1c.p1c_applied }, non_p1c_unmatched: { allowed: applyNonP1cUnmatched.allowed, p1c: applyNonP1cUnmatched.p1c_applied }
      });

    // ── QA #7: response truth on downgrade is manual/false/false, untouched otherwise ─────────
    const truthDowngraded = planPostReconciliationTruth({ recon_check: otherCandidate, extraction_status: 'אושר', validation_passed: true, auto_approved: true });
    const truthVerified = planPostReconciliationTruth({ recon_check: sameCandidate, extraction_status: 'אושר', validation_passed: true, auto_approved: true });
    check('q7_response_truth_is_manual_false_false_on_downgrade',
      {
        downgraded: { downgraded: true, status: 'ממתין לאימות', passed: false, approved: false, has_reason: true },
        verified: { downgraded: false, status: 'אושר', passed: true, approved: true }
      },
      {
        downgraded: { downgraded: truthDowngraded.downgraded, status: truthDowngraded.extraction_status, passed: truthDowngraded.validation_passed, approved: truthDowngraded.auto_approved, has_reason: !!truthDowngraded.review_reason_he },
        verified: { downgraded: truthVerified.downgraded, status: truthVerified.extraction_status, passed: truthVerified.validation_passed, approved: truthVerified.auto_approved }
      });

    const failed = cases.filter((c) => !c.passed);
    return Response.json({
      success: true,
      dry_run: true,
      read_only: true,
      db_free: true,
      llm_free: true,
      version: LINET_ASSISTED_RECOVERY_VERSION,
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      cases
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});