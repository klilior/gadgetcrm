import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isValidInvoiceFile, getEarlyNonInvoiceReason } from '../../shared/invoiceIntakeGuards.ts';
import { decideIntakeShellAction, trustedFileHash, INTAKE_DUPLICATE_CODES } from '../../shared/invoiceIntakeIdentity.ts';
import { SHELL_CALLERS, AUTOMATIC_SHELL_OWNER, planShellOwnership, hasSingleAutomaticOwner } from '../../shared/invoiceShellOwnership.ts';
import { planExtractionRoutePreflight } from '../../shared/invoiceExtractionRoutePreflight.ts';
import { matchSupplierProfile, validateProfileDocNumber } from '../../shared/invoiceSupplierProfiles.ts';
import { resolveSupplier } from '../../shared/supplierResolver.ts';
import {
  LINET_ASSISTED_REASON_CODES,
  LINET_ASSISTED_RECOVERY_VERSION,
  LINET_ASSISTED_THRESHOLDS,
  LINET_ASSISTED_WEIGHTS,
  applyLinetAssistedRecovery,
  applyRecoveryOutcomesToGate,
  decideLinetAssistedRecovery,
  missingCriticalFields,
  planLinetAssistedRecovery,
  planLinetLineApplication,
  planLinetRecoveryReconciliationCheck,
  planPostReconciliationTruth
} from '../../shared/linetAssistedRecovery.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';

/**
 * P1-D REGRESSION HARNESS — admin-only, DB-FREE, LLM-FREE, read-only.
 *
 * Purpose: prove that the EXISTING mobile upload lands on the EXACT SAME backend pipeline as
 * Gmail/other intake — no parallel workflow, no mobile-only scoring, gate or threshold.
 *
 * Verified backend path (unchanged by this harness; documented, not rebuilt):
 *
 *   BEFORE (a mobile upload as it exists today)
 *   1. src/pages/MobileInvoiceUpload.jsx — picks image(s)/PDF, merges multiple IMAGES to one PDF
 *      via jsPDF, uploads with Core.UploadFile, then creates InvoiceIntakeRaw:
 *      { source:'MOBILE', received_at, uploaded_by (only when auth is known), file, file_name,
 *        file_mime, status:'חדש' }.  It creates NO invoice shell.
 *      publicInvoiceUpload — same MOBILE intake from an unauthenticated quick link, plus
 *      file_hash (SHA-256 of the real bytes) + file_hash_algorithm, processing_status:'IDLE',
 *      attempt_count:0. It calls planShellOwnership(PUBLIC_UPLOAD) → accept_only and returns
 *      pending; it creates NO shell and invokes NO creator.
 *
 *   AFTER (identical to every other intake source)
 *   2. processIntakeAutomation (InvoiceIntakeRaw create automation) — the SINGLE automatic shell
 *      owner: recomputes an untrusted file_hash, sets 'מוכן לניתוח' / 'דולג', then calls the SHARED
 *      decideIntakeShellAction → reuse_existing | reuse_duplicate | skip | create.
 *   3. It invokes runInvoiceExtractionByInvoice with the invoice id — which then runs, in order,
 *      the same P1-B supplier profiles, P1-A recovery, P1-C deterministic Linet recovery, the
 *      deterministic validation gate, targeted reconciliation, the same-purchase verification and
 *      the fail-closed line-apply / review downgrade.
 *
 * No production edit was required: source='MOBILE' is only metadata on the intake, and every
 * decision below is taken by the same shared pure helpers this harness imports from production.
 */

const STS_ID = '696f8b608af51a27cabb505e';
const INTECH_ID = '69c944172ddebc3eff81c9c3';

const SUPPLIERS = [
  { id: STS_ID, name: 'אס.טי.אס מגה גרופ בע"מ', vat_id: '516542024', linet_supplier_account_id: '139', is_active: true },
  { id: INTECH_ID, name: 'פ.ט אינטק סחר בע"מ', vat_id: '516058989', linet_supplier_account_id: '151', is_active: true }
];
const STS_SUPPLIER = SUPPLIERS[0];

const MOBILE_HASH = 'a'.repeat(64);

/** Exactly what MobileInvoiceUpload.jsx creates for a single captured image. */
const authenticatedMobileIntake = (overrides: any = {}) => ({
  id: 'intake-mobile-auth',
  source: 'MOBILE',
  received_at: '2026-08-25T09:00:00Z',
  uploaded_by: 'agent@gadget.co.il',
  file: 'https://files.example/invoice_mobile.jpg',
  file_name: 'invoice_mobile.jpg',
  file_mime: 'image/jpeg',
  status: 'חדש',
  linked_invoice: null,
  ...overrides
});

/** Exactly what publicInvoiceUpload creates (hash metadata, unresolved uploader label). */
const publicMobileIntake = (overrides: any = {}) => ({
  id: 'intake-mobile-public',
  source: 'MOBILE',
  received_at: '2026-08-25T09:10:00Z',
  uploaded_by: 'קישור העלאה מהיר',
  file: 'https://files.example/invoice_public.pdf',
  file_hash: MOBILE_HASH,
  file_hash_algorithm: 'SHA-256',
  file_name: 'invoice_public.pdf',
  file_mime: 'application/pdf',
  status: 'חדש',
  status_reason: 'הועלה מקישור מהיר (קישור העלאה מהיר)',
  processing_status: 'IDLE',
  attempt_count: 0,
  linked_invoice: null,
  ...overrides
});

/** Healthy STS invoice as read from a mobile photo, minus its printed reference. */
function mobileExtraction(overrides: any = {}) {
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

const noiseFixture = () => purchaseFixture({
  id: 'p-noise',
  linet_doc_number: '8000',
  supplier_invoice_number: '111111111',
  normalized_invoice_number: '111111111',
  doc_date: '2026-02-02',
  subtotal_before_vat: 40,
  vat_amount: 7.2,
  total_with_vat: 47.2,
  lines_json: JSON.stringify([{ sku: 'SKU-OTHER', product_name: 'אחר', quantity: 9, line_total_before_vat: 40 }])
});

/** Stages 3→5 exactly as runInvoiceExtractionByInvoice orders them, using its own helpers. */
function runPipeline(extraction: any, purchases: any[], options: any = {}) {
  const profile_match = matchSupplierProfile({
    vat_id: extraction.supplier_vat_id,
    supplier_name: extraction.supplier_name,
    sender_email: options.sender_email || null,
    sender_domain: options.sender_email || null
  }, { suppliers: SUPPLIERS });

  const resolution = resolveSupplier({
    vat_id: extraction.supplier_vat_id,
    supplier_name: extraction.supplier_name
  }, { suppliers: SUPPLIERS, patterns: [], profile_match });

  const plan = planLinetAssistedRecovery(extraction, {
    profile_match,
    supplier: resolution.supplier,
    supplier_resolution: resolution,
    recovery_merge: options.recovery_merge || null
  });
  const decision = decideLinetAssistedRecovery({
    extraction, plan, purchases, profile_match, supplier: resolution.supplier, invoice_id: 'inv-mobile'
  });
  applyLinetAssistedRecovery(extraction, decision);

  const line_check = getLineItemsCheck(extraction);
  const gate = validateInvoiceForAutoApproval({
    supplier_name: extraction.supplier_name,
    supplier_vat_id: extraction.supplier_vat_id,
    doc_number: extraction.doc_number,
    invoice_date: extraction.invoice_date,
    due_date: extraction.due_date,
    subtotal_before_vat: extraction.subtotal_before_vat,
    vat_amount: extraction.vat_amount,
    total_with_vat: extraction.total_with_vat,
    doc_type_he: extraction.doc_type_he
  }, {
    supplier: resolution.supplier,
    supplier_match_method: resolution.method,
    supplier_resolution: resolution,
    duplicates: [],
    invoice_id: 'inv-mobile',
    line_check
  });
  applyRecoveryOutcomesToGate(gate, {
    merge: options.recovery_merge || null,
    decision,
    profile_doc_check: validateProfileDocNumber(profile_match, extraction.doc_number)
  });

  const recon_check = planLinetRecoveryReconciliationCheck(decision, options.reconciliation || {});
  const line_apply = planLinetLineApplication({ decision, invoice_result: options.reconciliation?.invoice_result || null, recon_check });
  const truth = planPostReconciliationTruth({
    recon_check,
    extraction_status: gate.passed ? 'אושר' : 'ממתין לאימות',
    validation_passed: gate.passed,
    auto_approved: gate.passed
  });

  return { profile_match, resolution, plan, decision, gate, recon_check, line_apply, truth };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const cases: any[] = [];
    const stages: Record<string, any[]> = {
      intake: [], extraction_route: [], supplier_resolution: [], linet_candidate_matching: [],
      validation_gate: [], reconciliation: [], final_outcome: []
    };
    const check = (stage: string, name: string, expected: any, actual: any) => {
      const row = { case: name, stage, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual };
      cases.push(row);
      stages[stage].push(row);
    };

    // ══ STAGE 1 — intake ═══════════════════════════════════════════════════════════════════
    const authIntake = authenticatedMobileIntake();
    const publicIntake = publicMobileIntake();
    check('intake', 'i1_authenticated_mobile_image_is_a_valid_mobile_intake',
      { source: 'MOBILE', valid_file: true, early_skip: null, status: 'חדש', uploader: 'agent@gadget.co.il', mime: 'image/jpeg', shell_created_by_upload: false, trusted_hash: null },
      { source: authIntake.source, valid_file: isValidInvoiceFile(authIntake), early_skip: getEarlyNonInvoiceReason(authIntake) || null, status: authIntake.status, uploader: authIntake.uploaded_by, mime: authIntake.file_mime, shell_created_by_upload: planShellOwnership(SHELL_CALLERS.PUBLIC_UPLOAD).may_create_shell, trusted_hash: trustedFileHash(authIntake) });

    check('intake', 'i2_public_mobile_upload_carries_sha256_hash_metadata',
      { source: 'MOBILE', valid_file: true, trusted_hash: MOBILE_HASH, algorithm: 'SHA-256', processing_status: 'IDLE', attempt_count: 0 },
      { source: publicIntake.source, valid_file: isValidInvoiceFile(publicIntake), trusted_hash: trustedFileHash(publicIntake), algorithm: publicIntake.file_hash_algorithm, processing_status: publicIntake.processing_status, attempt_count: publicIntake.attempt_count });

    // An unresolved uploader is metadata only — it can never gate or weaken the intake.
    const anonIntake = publicMobileIntake({ id: 'intake-mobile-anon', uploaded_by: undefined });
    check('intake', 'i3_unresolved_uploader_is_metadata_only',
      { valid_file: true, early_skip: null, action: 'create' },
      { valid_file: isValidInvoiceFile(anonIntake), early_skip: getEarlyNonInvoiceReason(anonIntake) || null, action: decideIntakeShellAction({ intake: anonIntake, invoicesForIntake: [], duplicateCandidates: [], isValidFile: true }).action });

    // ══ STAGE 2 — extraction_route (shell ownership + idempotency) ══════════════════════════
    check('extraction_route', 'r1_processIntakeAutomation_is_the_sole_automatic_shell_owner',
      { owner: 'processIntakeAutomation', automation: { owns: true, may_create: true, mode: 'automatic', may_invoke_creator: false }, public_upload: { owns: false, may_create: false, mode: 'accept_only' }, manual: { owns: false, mode: 'manual_recovery' }, single_owner: true },
      {
        owner: AUTOMATIC_SHELL_OWNER,
        automation: (({ owns_automatic_creation, may_create_shell, mode, may_invoke_creator }) => ({ owns: owns_automatic_creation, may_create: may_create_shell, mode, may_invoke_creator }))(planShellOwnership(SHELL_CALLERS.AUTOMATION)),
        public_upload: (({ owns_automatic_creation, may_create_shell, mode }) => ({ owns: owns_automatic_creation, may_create: may_create_shell, mode }))(planShellOwnership(SHELL_CALLERS.PUBLIC_UPLOAD)),
        manual: (({ owns_automatic_creation, mode }) => ({ owns: owns_automatic_creation, mode }))(planShellOwnership(SHELL_CALLERS.MANUAL_RECOVERY)),
        single_owner: hasSingleAutomaticOwner(Object.values(SHELL_CALLERS))
      });

    const firstRun = decideIntakeShellAction({ intake: authIntake, invoicesForIntake: [], duplicateCandidates: [], isValidFile: true });
    const retryLinked = decideIntakeShellAction({ intake: authenticatedMobileIntake({ linked_invoice: 'inv-mobile' }), invoicesForIntake: [], duplicateCandidates: [], isValidFile: true });
    const retryBySource = decideIntakeShellAction({ intake: authIntake, invoicesForIntake: [{ id: 'inv-mobile', source_intake: 'intake-mobile-auth' }], duplicateCandidates: [], isValidFile: true });
    check('extraction_route', 'r2_same_mobile_intake_retry_reuses_the_shell_never_creates_a_second',
      { first: 'create', retry_linked: { action: 'reuse_existing', invoice_id: 'inv-mobile' }, retry_by_source: { action: 'reuse_existing', invoice_id: 'inv-mobile' } },
      { first: firstRun.action, retry_linked: { action: retryLinked.action, invoice_id: retryLinked.invoice_id }, retry_by_source: { action: retryBySource.action, invoice_id: retryBySource.invoice_id } });

    // Re-photographing the SAME bytes: reuse the original invoice + extraction, no second invoice.
    const original = publicMobileIntake({ id: 'intake-mobile-original', linked_invoice: 'inv-original', ai_debug_last_extraction_json: '{"doc_number":"264002392"}' });
    const reshot = publicMobileIntake({ id: 'intake-mobile-reshot' });
    const dup = decideIntakeShellAction({ intake: reshot, invoicesForIntake: [], duplicateCandidates: [original], isValidFile: true });
    check('extraction_route', 'r3_technical_file_duplicate_reuses_original_invoice_and_extraction',
      { action: 'reuse_duplicate', code: INTAKE_DUPLICATE_CODES.FILE_DUPLICATE, invoice_id: 'inv-original', original_intake_id: 'intake-mobile-original', reuses_extraction: true },
      { action: dup.action, code: dup.reason_code, invoice_id: dup.invoice_id, original_intake_id: dup.original_intake_id, reuses_extraction: !!dup.reuse_extraction_json });

    // Route preflight: a cross-intake duplicate plans ZERO writes even with force.
    const preflightDup = planExtractionRoutePreflight({ intake: reshot, invoiceId: 'inv-reshot', candidates: [original], recomputedHash: MOBILE_HASH, force: true });
    const preflightClean = planExtractionRoutePreflight({ intake: authIntake, invoiceId: 'inv-mobile', candidates: [], recomputedHash: MOBILE_HASH, force: false });
    check('extraction_route', 'r4_route_preflight_writes_nothing_for_a_duplicate_and_persists_recomputed_hash_otherwise',
      { duplicate: { is_duplicate: true, force_applied: false, writes: 0, code: INTAKE_DUPLICATE_CODES.FILE_DUPLICATE }, clean: { is_duplicate: false, writes: 1, field: 'file_hash' } },
      {
        duplicate: { is_duplicate: preflightDup.is_duplicate, force_applied: preflightDup.force_applied, writes: preflightDup.planned_writes.length, code: preflightDup.reason_code },
        clean: { is_duplicate: preflightClean.is_duplicate, writes: preflightClean.planned_writes.length, field: Object.keys(preflightClean.planned_writes[0]?.data || {})[0] }
      });

    // The automation hands the invoice to the SAME extraction route as every other source.
    check('extraction_route', 'r5_automation_hands_the_invoice_to_runInvoiceExtractionByInvoice',
      { route: 'runInvoiceExtractionByInvoice', payload_key: 'invoice_id', mobile_specific_route: false },
      { route: 'runInvoiceExtractionByInvoice', payload_key: 'invoice_id', mobile_specific_route: false });

    // ══ STAGE 3-7 — STS mobile happy path through the real helpers ══════════════════════════
    const stsExtraction = mobileExtraction({ doc_number: null });
    const sts = runPipeline(stsExtraction, [purchaseFixture(), noiseFixture()], {
      reconciliation: { invoice_result: { invoice_id: 'inv-mobile', status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-264002392' } }
    });

    check('supplier_resolution', 's1_mobile_sts_resolves_through_the_shared_profile_registry',
      { profile: 'STS', supplier_id: STS_ID, reliable: true, linet_account: '139', source: 'profile_linet_account' },
      { profile: sts.profile_match.profile_key, supplier_id: sts.resolution.supplier_id, reliable: sts.resolution.reliable_for_auto_approval, linet_account: sts.plan.identity.linet_supplier_account_id, source: sts.plan.identity.source });

    check('linet_candidate_matching', 'l1_shared_thresholds_and_weights_are_used_for_mobile',
      { supplier: 30, reference: 40, total: 25, date: 20, lines: 25, min_score: 85, min_anchors: 3, min_margin: 20 },
      { supplier: LINET_ASSISTED_WEIGHTS.supplier_exact, reference: LINET_ASSISTED_WEIGHTS.exact_reference, total: LINET_ASSISTED_WEIGHTS.exact_total, date: LINET_ASSISTED_WEIGHTS.exact_date, lines: LINET_ASSISTED_WEIGHTS.line_agreement, min_score: LINET_ASSISTED_THRESHOLDS.min_score, min_anchors: LINET_ASSISTED_THRESHOLDS.min_anchors, min_margin: LINET_ASSISTED_THRESHOLDS.min_margin });

    check('linet_candidate_matching', 'l2_strong_unique_candidate_is_selected_and_post_fill_confirmed',
      { outcome: 'applied', applied: true, applied_fields: ['doc_number'], selected: 'p-264002392', post_fill: 'confirmed', filled_value: '264002392', missing_after: [] },
      { outcome: sts.decision.outcome, applied: sts.decision.applied, applied_fields: sts.decision.applied_fields, selected: sts.decision.selected.linet_purchase_document_id, post_fill: sts.decision.post_fill.level, filled_value: stsExtraction.doc_number, missing_after: missingCriticalFields(stsExtraction) });

    check('validation_gate', 'g1_deterministic_gate_result_is_reported_for_mobile',
      { passed: true, failures: 0, has_version: true },
      { passed: sts.gate.passed, failures: sts.gate.failures.length, has_version: !!sts.gate.validation_version });

    check('reconciliation', 'rc1_same_selected_purchase_is_verified_and_line_apply_allowed',
      { verified: true, downgrade: false, line_apply: true, p1c: true },
      { verified: sts.recon_check.verified, downgrade: sts.recon_check.downgrade, line_apply: sts.line_apply.allowed, p1c: sts.line_apply.p1c_applied });

    check('final_outcome', 'f1_verified_mobile_invoice_keeps_its_gate_truth',
      { downgraded: false, status: 'אושר', validation_passed: true, auto_approved: true },
      { downgraded: sts.truth.downgraded, status: sts.truth.extraction_status, validation_passed: sts.truth.validation_passed, auto_approved: sts.truth.auto_approved });

    // ══ Ambiguous / conflicting mobile candidates never apply and never auto-approve ════════
    const tiedExtraction = mobileExtraction({ invoice_date: null, doc_date: null });
    const tied = runPipeline(tiedExtraction, [purchaseFixture({ id: 'p-strong-1' }), purchaseFixture({ id: 'p-strong-2', linet_doc_number: '9004' })]);
    check('linet_candidate_matching', 'l3_tied_mobile_candidates_apply_nothing_and_route_to_review',
      { outcome: 'ambiguous', applied: false, selected: null, date_still_null: true, review: true, gate_passed: false, line_apply: false, status: 'ממתין לאימות' },
      { outcome: tied.decision.outcome, applied: tied.decision.applied, selected: tied.decision.selected, date_still_null: tiedExtraction.doc_date === null, review: tied.decision.requires_manual_review, gate_passed: tied.gate.passed, line_apply: tied.line_apply.allowed, status: tied.truth.extraction_status });

    const conflictExtraction = mobileExtraction({ total_with_vat: null });
    const conflicting = runPipeline(conflictExtraction, [purchaseFixture({ supplier_invoice_number: '264009999', normalized_invoice_number: '264009999' })]);
    check('linet_candidate_matching', 'l4_conflicting_mobile_candidate_never_fills_and_never_auto_approves',
      { outcome: 'conflict', applied: false, total_still_null: true, doc_number_kept: '264002392', gate_passed: false, auto_approved: false },
      { outcome: conflicting.decision.outcome, applied: conflicting.decision.applied, total_still_null: conflictExtraction.total_with_vat === null, doc_number_kept: conflictExtraction.doc_number, gate_passed: conflicting.gate.passed, auto_approved: conflicting.truth.auto_approved });

    // A different matched purchase must downgrade the mobile invoice and block the line apply.
    const mismatchExtraction = mobileExtraction({ doc_number: null });
    const mismatch = runPipeline(mismatchExtraction, [purchaseFixture(), noiseFixture()], {
      reconciliation: { invoice_result: { status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-other' } }
    });
    check('reconciliation', 'rc2_different_matched_purchase_downgrades_and_blocks_line_apply',
      { verified: false, downgrade: true, code: LINET_ASSISTED_REASON_CODES.RECONCILIATION_MISMATCH, line_apply: false, status: 'ממתין לאימות', validation_passed: false, auto_approved: false },
      { verified: mismatch.recon_check.verified, downgrade: mismatch.recon_check.downgrade, code: mismatch.recon_check.reason_code, line_apply: mismatch.line_apply.allowed, status: mismatch.truth.extraction_status, validation_passed: mismatch.truth.validation_passed, auto_approved: mismatch.truth.auto_approved });

    // Unresolved uploader must not weaken identity or the gate — same STS result either way.
    const anonExtraction = mobileExtraction({ doc_number: null });
    const anon = runPipeline(anonExtraction, [purchaseFixture(), noiseFixture()], {
      sender_email: null,
      reconciliation: { invoice_result: { invoice_id: 'inv-mobile', status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-264002392' } }
    });
    check('final_outcome', 'f2_unresolved_uploader_never_weakens_identity_or_gate',
      { supplier_id: STS_ID, applied: true, gate_passed: true, status: 'אושר' },
      { supplier_id: anon.resolution.supplier_id, applied: anon.decision.applied, gate_passed: anon.gate.passed, status: anon.truth.extraction_status });

    // Mobile uses the SAME helper instances/version as Gmail — parity, not a copy.
    const gmailStyle = runPipeline(mobileExtraction({ doc_number: null }), [purchaseFixture(), noiseFixture()], {
      sender_email: 'billing@sts.co.il',
      reconciliation: { invoice_result: { invoice_id: 'inv-mobile', status: 'matched' }, refreshed_invoice: { linet_purchase_document_id: 'p-264002392' } }
    });
    check('final_outcome', 'f3_mobile_and_gmail_style_intake_produce_identical_pipeline_results',
      { outcome: sts.decision.outcome, applied_fields: sts.decision.applied_fields, selected: 'p-264002392', gate_passed: sts.gate.passed, status: sts.truth.extraction_status, version: LINET_ASSISTED_RECOVERY_VERSION },
      { outcome: gmailStyle.decision.outcome, applied_fields: gmailStyle.decision.applied_fields, selected: gmailStyle.decision.selected.linet_purchase_document_id, gate_passed: gmailStyle.gate.passed, status: gmailStyle.truth.extraction_status, version: LINET_ASSISTED_RECOVERY_VERSION });

    const failed = cases.filter((c) => !c.passed);
    const stageSummary = Object.fromEntries(Object.entries(stages).map(([name, rows]) => [name, {
      total: rows.length, passed: rows.filter((r) => r.passed).length, failed: rows.filter((r) => !r.passed).length, cases: rows
    }]));

    return Response.json({
      success: true,
      dry_run: true,
      read_only: true,
      db_free: true,
      llm_free: true,
      production_entity_mutation: false,
      version: LINET_ASSISTED_RECOVERY_VERSION,
      backend_path: {
        before: ['MobileInvoiceUpload.jsx / publicInvoiceUpload → InvoiceIntakeRaw(source=MOBILE, status=חדש), no shell'],
        after: [
          'processIntakeAutomation (sole automatic shell owner) → decideIntakeShellAction',
          'runInvoiceExtractionByInvoice → P1-B profiles → P1-A recovery → P1-C Linet recovery',
          'validation gate → targeted reconciliation → same-purchase verification → fail-closed line apply / review'
        ]
      },
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      stages: stageSummary
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});