import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  SUPPLIER_PROFILES_VERSION,
  PROFILE_REASON_CODES,
  matchSupplierProfile,
  validateProfileDocNumber,
  normalizeProfileReference,
  profileRecoveryHints,
  isPublicEmailDomain,
  getProfile
} from '../../shared/invoiceSupplierProfiles.ts';
import { planCriticalFieldRecovery, mergeCriticalFieldRecovery, buildRecoveryPrompt, RECOVERY_REASON_CODES } from '../../shared/invoiceCriticalFieldRecovery.ts';
import { resolveSupplier } from '../../shared/supplierResolver.ts';

/**
 * P1-B regression harness — PURE, DB-FREE, LLM-FREE (admins only).
 * Proves the curated profile registry only ever matches on strong exact evidence, fails closed on
 * conflict/ambiguity/missing rows, never creates or renames a supplier, never repairs a document
 * number by pattern similarity, and never weakens P1-A or the deterministic gate.
 */

const NOW = '2026-06-01T00:00:00Z';

// Synthetic stand-ins for the real Suppliers rows (ids only are real).
const STS_ID = '696f8b608af51a27cabb505e';
const INTECH_ID = '69c944172ddebc3eff81c9c3';
const ALPHONE_ID = '6a12f0860a0eb61e7a5c5e45';

const suppliers = () => ([
  { id: STS_ID, name: 'אס.טי.אס מגה גרופ בע"מ', vat_id: '516542024', linet_supplier_account_id: '139', is_active: true },
  { id: INTECH_ID, name: 'פ.ט אינטק סחר בע"מ', vat_id: '516058989', linet_supplier_account_id: '151', is_active: true },
  { id: ALPHONE_ID, name: 'אולפון יבוא סחר בעמ', vat_id: '515893683', is_active: true },
  { id: 'other-1', name: 'ספק אחר בע"מ', vat_id: '511111118', is_active: true }
]);

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

  const cases: any[] = [];
  const check = (name: string, expected: any, actual: any) =>
    cases.push({ case: name, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual });
  const rows = suppliers();
  const match = (evidence: any, list: any[] = rows) => matchSupplierProfile(evidence, { suppliers: list });

  // ── STS ─────────────────────────────────────────────────────────────────
  const stsByVat = match({ vat_id: '516542024' });
  check('sts1_vat_resolves_to_canonical_and_account_139',
    { profile_key: 'STS', supplier_id: STS_ID, method: 'profile_vat_id', linet: '139', reliable: true, code: PROFILE_REASON_CODES.MATCHED },
    { profile_key: stsByVat.profile_key, supplier_id: stsByVat.supplier_id, method: stsByVat.method, linet: stsByVat.linet_supplier_account_id, reliable: stsByVat.reliable_for_auto_approval, code: stsByVat.reason_code });

  check('sts2_curated_aliases_resolve_uniquely',
    ['STS', 'STS', 'STS', 'STS', 'STS'],
    ['אס.טי.אס מגה גרופ', 'אס טי טס מגה גרופ', 'STS MEGAGROUP', 'Mega Group', 'STS'].map((n) => match({ supplier_name: n }).profile_key));

  check('sts3_linet_account_139_is_strong_evidence',
    { profile_key: 'STS', method: 'profile_linet_account' },
    { profile_key: match({ linet_supplier_id: '139' }).profile_key, method: match({ linet_supplier_id: '139' }).method });

  const stsRef = normalizeProfileReference(stsByVat, 'IN264002392');
  const stsRefWrongShape = normalizeProfileReference(stsByVat, 'IN26400239');
  const noProfileRef = normalizeProfileReference(match({ vat_id: '511111118' }), 'IN264002392');
  const otherProfileRef = normalizeProfileReference(match({ vat_id: '516058989' }), 'IN264002392');
  check('sts4_contextual_reference_normalization_only_inside_sts_context',
    {
      sts: { applied: true, normalized: '264002392', printed_original: 'IN264002392' },
      wrong_shape: { applied: false, normalized: 'IN26400239' },
      no_profile: { applied: false, normalized: 'IN264002392' },
      other_profile: { applied: false, normalized: 'IN264002392' }
    },
    {
      sts: { applied: stsRef.applied, normalized: stsRef.normalized, printed_original: stsRef.printed_original },
      wrong_shape: { applied: stsRefWrongShape.applied, normalized: stsRefWrongShape.normalized },
      no_profile: { applied: noProfileRef.applied, normalized: noProfileRef.normalized },
      other_profile: { applied: otherProfileRef.applied, normalized: otherProfileRef.normalized }
    });

  check('sts5_bare_and_prefixed_references_are_both_valid_ik_loose',
    { in9: true, bare9: true, ik: true, in10: false },
    {
      in9: validateProfileDocNumber(stsByVat, 'IN264002392').valid,
      bare9: validateProfileDocNumber(stsByVat, '264002392').valid,
      ik: validateProfileDocNumber(stsByVat, 'IK2640023').valid,
      in10: validateProfileDocNumber(stsByVat, 'IN2640023921').valid
    });

  check('sts6_gadget_team_sender_is_not_supplier_evidence',
    { by_email: PROFILE_REASON_CODES.NO_EVIDENCE, by_domain: PROFILE_REASON_CODES.NO_EVIDENCE, gmail_public: true },
    {
      by_email: match({ sender_email: 'gadget.team4u@gmail.com' }).reason_code,
      by_domain: match({ sender_domain: 'gmail.com' }).reason_code,
      gmail_public: isPublicEmailDomain('gadget.team4u@gmail.com')
    });

  // ── INTECH ──────────────────────────────────────────────────────────────
  const intechByVat = match({ vat_id: '516058989' });
  const intechByAlias = match({ supplier_name: 'LITECH' });
  check('int1_vat_and_exact_litech_alias_resolve_to_canonical',
    { vat: { key: 'INTECH', id: INTECH_ID, linet: '151' }, alias: { key: 'INTECH', id: INTECH_ID, method: 'profile_alias' } },
    { vat: { key: intechByVat.profile_key, id: intechByVat.supplier_id, linet: intechByVat.linet_supplier_account_id }, alias: { key: intechByAlias.profile_key, id: intechByAlias.supplier_id, method: intechByAlias.method } });

  const intechValid = validateProfileDocNumber(intechByVat, 'IN264002281');
  const intechInvalid = validateProfileDocNumber(intechByVat, 'IN2640002281');
  check('int2_in9_valid_in10_profile_implausible',
    { valid: { applicable: true, valid: true }, invalid: { applicable: true, valid: false, code: PROFILE_REASON_CODES.DOC_NUMBER_IMPLAUSIBLE } },
    { valid: { applicable: intechValid.applicable, valid: intechValid.valid }, invalid: { applicable: intechInvalid.applicable, valid: intechInvalid.valid, code: intechInvalid.reason_code } });

  const healthyIntech = { classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', supplier_name: 'פ.ט אינטק סחר', supplier_vat_id: '516058989', doc_number: 'IN2640002281', invoice_date: '2026-05-01', doc_date: '2026-05-01', subtotal_before_vat: 100, vat_amount: 18, total_with_vat: 118 };
  const intechPlan = planCriticalFieldRecovery(healthyIntech, { now: NOW, profile_match: intechByVat });
  const intechPlanNoProfile = planCriticalFieldRecovery(healthyIntech, { now: NOW });
  check('int3_profile_implausible_number_requests_doc_number_only',
    { with_profile: { needed: true, fields: ['doc_number'] }, without_profile: { needed: false, fields: [] } },
    { with_profile: { needed: intechPlan.needed, fields: intechPlan.request_fields }, without_profile: { needed: intechPlanNoProfile.needed, fields: intechPlanNoProfile.request_fields } });

  check('int3b_plan_carries_compact_profile_validation_context',
    { applicable: true, first_valid: false, profile_key: 'INTECH', code: PROFILE_REASON_CODES.DOC_NUMBER_IMPLAUSIBLE, no_profile_applicable: false },
    { applicable: intechPlan.profile_doc_number.applicable, first_valid: intechPlan.profile_doc_number.first_valid, profile_key: intechPlan.profile_doc_number.profile_key, code: intechPlan.profile_doc_number.reason_code, no_profile_applicable: intechPlanNoProfile.profile_doc_number.applicable });

  // No second reading at all → the profile-invalid first value may NOT be kept as FIRST_PASS_VALID.
  const intechNoSecond = mergeCriticalFieldRecovery({ extraction: healthyIntech, plan: intechPlan, now: NOW, second: null });
  check('int3c_missing_second_pass_leaves_profile_invalid_number_unresolved',
    { code: RECOVERY_REASON_CODES.UNRESOLVED, selected: null, applied: [], unresolved: ['doc_number'], review: true, extraction_untouched: 'IN2640002281' },
    { code: intechNoSecond.decisions[0].reason_code, selected: intechNoSecond.decisions[0].selected_value, applied: intechNoSecond.applied_fields, unresolved: intechNoSecond.unresolved_fields, review: intechNoSecond.requires_manual_review, extraction_untouched: healthyIntech.doc_number });

  // Second pass reads the SAME profile-invalid number → agreement must NOT resolve it.
  const intechSameBad = mergeCriticalFieldRecovery({
    extraction: healthyIntech, plan: intechPlan, now: NOW,
    second: { fields: [{ field: 'doc_number', found: true, normalized_value: 'IN2640002281', printed_label: 'מספר חשבונית', confidence: 99 }] }
  });
  check('int3d_same_profile_invalid_second_reading_is_not_agreement',
    { code: RECOVERY_REASON_CODES.UNRESOLVED, selected: null, applied: [], review: true, both_candidates_kept: ['IN2640002281', 'IN2640002281'] },
    { code: intechSameBad.decisions[0].reason_code, selected: intechSameBad.decisions[0].selected_value, applied: intechSameBad.applied_fields, review: intechSameBad.requires_manual_review, both_candidates_kept: [intechSameBad.decisions[0].first_pass.value, intechSameBad.decisions[0].second_pass.value] });

  // A different but STILL profile-invalid second reading also fails closed.
  const intechOtherBad = mergeCriticalFieldRecovery({
    extraction: healthyIntech, plan: intechPlan, now: NOW,
    second: { fields: [{ field: 'doc_number', found: true, normalized_value: 'IN26400022', printed_label: 'מספר חשבונית' }] }
  });
  check('int3e_different_profile_invalid_second_reading_also_unresolved',
    { code: RECOVERY_REASON_CODES.UNRESOLVED, selected: null, review: true },
    { code: intechOtherBad.decisions[0].reason_code, selected: intechOtherBad.decisions[0].selected_value, review: intechOtherBad.requires_manual_review });

  // A conflicting but VALID second reading must stay a conflict — never a digit-deletion repair.
  const intechConflict = mergeCriticalFieldRecovery({
    extraction: healthyIntech, plan: intechPlan, now: NOW,
    second: { fields: [{ field: 'doc_number', found: true, normalized_value: 'IN264002281', printed_label: 'מספר חשבונית', confidence: 99 }] }
  });
  check('int4_no_autocorrection_by_pattern_similarity',
    { code: RECOVERY_REASON_CODES.CONFLICT, applied: [], review: true, first_kept: 'IN2640002281', second_kept: 'IN264002281', extraction_untouched: 'IN2640002281' },
    { code: intechConflict.decisions[0].reason_code, applied: intechConflict.applied_fields, review: intechConflict.requires_manual_review, first_kept: intechConflict.decisions[0].first_pass.value, second_kept: intechConflict.decisions[0].second_pass.value, extraction_untouched: healthyIntech.doc_number });

  // P1-A due-date policy is untouched by profile date hints.
  const intechNoDate = { ...healthyIntech, doc_number: 'IN264002281', invoice_date: null, doc_date: null, due_date: '2026-05-30' };
  const intechDatePlan = planCriticalFieldRecovery(intechNoDate, { now: NOW, profile_match: intechByVat });
  const intechDueMerge = mergeCriticalFieldRecovery({
    extraction: intechNoDate, plan: intechDatePlan, now: NOW,
    second: { fields: [{ field: 'invoice_date', found: true, normalized_value: '2026-05-30', printed_label: 'מועד תשלום', evidence_text: 'מועד תשלום 30/05/2026' }] }
  });
  check('int5_profile_hints_never_turn_due_date_into_invoice_date',
    { requested: ['invoice_date'], selected: null, code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, review: true },
    { requested: intechDatePlan.request_fields, selected: intechDueMerge.decisions[0].selected_value, code: intechDueMerge.decisions[0].reason_code, review: intechDueMerge.requires_manual_review });

  const hintedPrompt = buildRecoveryPrompt(['doc_number', 'invoice_date'], undefined, profileRecoveryHints(intechByVat));
  const plainPrompt = buildRecoveryPrompt(['doc_number', 'invoice_date']);
  check('int6_hints_are_where_to_look_only_and_forbid_digit_changes',
    { has_hint_block: true, forbids_digit_change: true, keeps_due_rule: true, plain_prompt_has_no_hints: true },
    {
      has_hint_block: hintedPrompt.includes('SUPPLIER LABEL HINTS'),
      forbids_digit_change: hintedPrompt.includes('NEVER add, delete or change a digit'),
      keeps_due_rule: hintedPrompt.includes('A due date is NEVER the invoice date.'),
      plain_prompt_has_no_hints: !plainPrompt.includes('SUPPLIER LABEL HINTS')
    });

  // ── Alphone ─────────────────────────────────────────────────────────────
  const alpByVat = match({ vat_id: '515893683' });
  const alpByAlias = match({ supplier_name: 'alliphone' });
  const alpByEmail = match({ sender_email: 'allphonedocs@gmail.com' });
  check('alp1_vat_alias_and_exact_email_each_resolve_to_canonical',
    { vat: ALPHONE_ID, alias: ALPHONE_ID, email: ALPHONE_ID, email_method: 'profile_trusted_sender_email' },
    { vat: alpByVat.supplier_id, alias: alpByAlias.supplier_id, email: alpByEmail.supplier_id, email_method: alpByEmail.method });

  check('alp2_public_gmail_domain_and_forwarder_are_never_evidence',
    { domain_only: PROFILE_REASON_CODES.NO_EVIDENCE, forwarder: PROFILE_REASON_CODES.NO_EVIDENCE, other_gmail_address: PROFILE_REASON_CODES.NO_EVIDENCE },
    {
      domain_only: match({ sender_domain: 'gmail.com' }).reason_code,
      forwarder: match({ sender_email: 'gadget.team4u@gmail.com' }).reason_code,
      other_gmail_address: match({ sender_email: 'someone.else@gmail.com' }).reason_code
    });

  check('alp3_linet_account_stays_null_and_is_not_invented',
    { profile_value: null, match_value: null, account_151_is_intech: 'INTECH' },
    { profile_value: getProfile('ALPHONE').linet_supplier_account_id, match_value: alpByVat.linet_supplier_account_id, account_151_is_intech: match({ linet_supplier_id: '151' }).profile_key });

  check('alp4_reference_shapes_in_and_cr',
    { in9: true, cr9: true, ik: false, bare9: false },
    {
      in9: validateProfileDocNumber(alpByVat, 'IN264002392').valid,
      cr9: validateProfileDocNumber(alpByVat, 'CR264002392').valid,
      ik: validateProfileDocNumber(alpByVat, 'IK264002392').valid,
      bare9: validateProfileDocNumber(alpByVat, '264002392').valid
    });

  // ── Fail-closed behaviour ───────────────────────────────────────────────
  const conflict = match({ vat_id: '516542024', sender_email: 'allphonedocs@gmail.com' });
  check('fc1_conflicting_strong_signals_fail_closed',
    { matched: false, supplier_id: null, code: PROFILE_REASON_CODES.CONFLICT, candidates: ['STS', 'ALPHONE'], reliable: false },
    { matched: conflict.matched, supplier_id: conflict.supplier_id, code: conflict.reason_code, candidates: conflict.conflict_candidates.map((c: any) => c.profile_key), reliable: conflict.reliable_for_auto_approval });

  // An alias curated on two profiles must never pick a winner.
  const stsProfile = getProfile('STS');
  const alpProfile = getProfile('ALPHONE');
  stsProfile.aliases.push('COLLIDING ALIAS');
  alpProfile.aliases.push('COLLIDING ALIAS');
  const ambiguous = match({ supplier_name: 'COLLIDING ALIAS' });
  stsProfile.aliases.pop();
  alpProfile.aliases.pop();
  check('fc2_alias_collision_is_ambiguous_not_a_guess',
    { matched: false, supplier_id: null, code: PROFILE_REASON_CODES.AMBIGUOUS },
    { matched: ambiguous.matched, supplier_id: ambiguous.supplier_id, code: ambiguous.reason_code });

  const missingRow = match({ vat_id: '516542024' }, rows.filter((s) => s.id !== STS_ID));
  const inactiveRow = match({ vat_id: '516542024' }, rows.map((s) => (s.id === STS_ID ? { ...s, is_active: false } : s)));
  const redirected = match({ vat_id: '516542024' }, [
    { id: STS_ID, name: 'STS legacy', vat_id: '516542024', is_active: false, canonical_supplier_id: 'sts-canonical' },
    { id: 'sts-canonical', name: 'אס.טי.אס מגה גרופ בע"מ', vat_id: '516542024', is_active: true }
  ]);
  check('fc3_missing_or_inactive_canonical_row_fails_unless_valid_redirect',
    { missing: { matched: false, code: PROFILE_REASON_CODES.SUPPLIER_MISSING }, inactive: { matched: false, code: PROFILE_REASON_CODES.SUPPLIER_INACTIVE }, redirect: { matched: true, id: 'sts-canonical' } },
    { missing: { matched: missingRow.matched, code: missingRow.reason_code }, inactive: { matched: inactiveRow.matched, code: inactiveRow.reason_code }, redirect: { matched: redirected.matched, id: redirected.supplier_id } });

  check('fc4_invoice_number_or_title_pattern_alone_never_selects_a_profile',
    { by_number: PROFILE_REASON_CODES.NO_EVIDENCE, by_title: PROFILE_REASON_CODES.NO_EVIDENCE, doc_check_not_applicable: false },
    {
      by_number: match({ supplier_name: null, doc_number: 'IN264002392' } as any).reason_code,
      by_title: match({ supplier_name: 'חשבונית מס' }).reason_code,
      doc_check_not_applicable: validateProfileDocNumber(match({ supplier_name: 'חשבונית מס' }), 'IN264002392').applicable
    });

  check('fc5_our_own_buyer_id_and_unknown_vat_never_match',
    { buyer: PROFILE_REASON_CODES.NO_EVIDENCE, unknown: PROFILE_REASON_CODES.NO_EVIDENCE, sentinel: PROFILE_REASON_CODES.NO_EVIDENCE },
    { buyer: match({ vat_id: '040638660' }).reason_code, unknown: match({ vat_id: '511111118' }).reason_code, sentinel: match({ vat_id: 'null' }).reason_code });

  // ── Resolver integration ────────────────────────────────────────────────
  const resolvedWithProfile = resolveSupplier(
    { supplier_name: 'LITECH' },
    { suppliers: rows, patterns: [], profile_match: intechByAlias }
  );
  const resolvedWithoutProfile = resolveSupplier({ supplier_name: 'LITECH' }, { suppliers: rows, patterns: [] });
  const resolvedWithConflict = resolveSupplier({ supplier_name: 'LITECH' }, { suppliers: rows, patterns: [], profile_match: conflict });
  check('ri1_reliable_profile_is_an_audited_resolution_method',
    {
      with_profile: { id: INTECH_ID, method: 'supplier_profile:INTECH', reliable: true },
      without_profile: { id: null, reliable: false },
      with_conflict: { id: null, reliable: false }
    },
    {
      with_profile: { id: resolvedWithProfile.supplier_id, method: resolvedWithProfile.method, reliable: resolvedWithProfile.reliable_for_auto_approval },
      without_profile: { id: resolvedWithoutProfile.supplier_id, reliable: resolvedWithoutProfile.reliable_for_auto_approval },
      with_conflict: { id: resolvedWithConflict.supplier_id, reliable: resolvedWithConflict.reliable_for_auto_approval }
    });

  // Item 1: a strong-profile FAILURE must stop the legacy chain, even with raw STS VAT present.
  const conflictWithRawVat = resolveSupplier(
    { vat_id: '516542024', supplier_name: 'אס.טי.אס מגה גרופ בע"מ' },
    { suppliers: rows, patterns: [], profile_match: match({ vat_id: '516542024', sender_email: 'allphonedocs@gmail.com' }) }
  );
  const rawVatNoProfile = resolveSupplier({ vat_id: '516542024' }, { suppliers: rows, patterns: [] });
  check('ri3_profile_conflict_blocks_raw_vat_fallthrough',
    { with_conflict: { id: null, reliable: false, code: 'SUPPLIER_PROFILE_FAILED', candidates: ['STS', 'ALPHONE'] }, without_profile: { id: STS_ID, reliable: true } },
    {
      with_conflict: { id: conflictWithRawVat.supplier_id, reliable: conflictWithRawVat.reliable_for_auto_approval, code: conflictWithRawVat.reason_code, candidates: (conflictWithRawVat.profile_match?.conflict_candidates || []).map((c: any) => c.profile_key) },
      without_profile: { id: rawVatNoProfile.supplier_id, reliable: rawVatNoProfile.reliable_for_auto_approval }
    });

  const ambiguousResolved = resolveSupplier({ vat_id: '516542024' }, { suppliers: rows, patterns: [], profile_match: ambiguous });
  const missingResolved = resolveSupplier({ vat_id: '516542024' }, { suppliers: rows, patterns: [], profile_match: missingRow });
  const inactiveResolved = resolveSupplier({ vat_id: '516542024' }, { suppliers: rows, patterns: [], profile_match: inactiveRow });
  const noEvidenceResolved = resolveSupplier({ vat_id: '516542024' }, { suppliers: rows, patterns: [], profile_match: match({ vat_id: '511111118' }) });
  check('ri4_ambiguous_missing_inactive_never_fall_through_but_no_evidence_does',
    { ambiguous: null, missing: null, inactive: null, no_evidence_uses_legacy: STS_ID },
    { ambiguous: ambiguousResolved.supplier_id, missing: missingResolved.supplier_id, inactive: inactiveResolved.supplier_id, no_evidence_uses_legacy: noEvidenceResolved.supplier_id });

  check('ri2_profile_never_creates_or_renames_a_supplier',
    { returns_existing_row_only: true, name_unchanged: 'פ.ט אינטק סחר בע"מ', rows_count: 4 },
    { returns_existing_row_only: rows.some((s) => s.id === resolvedWithProfile.supplier_id), name_unchanged: resolvedWithProfile.supplier?.name, rows_count: rows.length });

  const passed = cases.filter((c) => c.passed).length;
  return Response.json({ success: true, dry_run: true, read_only: true, db_free: true, llm_free: true, version: SUPPLIER_PROFILES_VERSION, total: cases.length, passed, failed: cases.length - passed, cases });
});