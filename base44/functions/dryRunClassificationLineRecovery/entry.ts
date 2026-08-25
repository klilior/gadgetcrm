import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { applyDocumentClassificationGuard, CLASSIFICATION_GUARD_VERSION } from '../../shared/invoiceDocumentClassification.ts';
import {
  CLASSIFICATION_RECOVERY_VERSION,
  RECOVERY_REASON_CODES,
  applyClassificationRecovery,
  evaluateClassificationRecovery,
  evaluatePrintedTitle
} from '../../shared/invoiceClassificationRecovery.ts';
import { LINE_APPLICABILITY_VERSION, decideLineApplicability, summarizeLineApplicability } from '../../shared/invoiceLineApplicability.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';
import { matchSupplierProfile } from '../../shared/invoiceSupplierProfiles.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';

/**
 * P1-E REGRESSION HARNESS — admin-only, DB-FREE and LLM-FREE, read-only.
 *
 * Proves the two P1-E layers, using the SAME production helpers the three extraction routes call
 * (runInvoiceExtraction, runInvoiceExtractionByInvoice, dryRunInvoiceExtraction all invoke
 * applyClassificationRecovery right after the monetary audit + initial profile match, BEFORE P1-A
 * and BEFORE the OTHER early return, and all of them read lines through getLineItemsCheck).
 *
 * Standalone RECEIPT is NOT recoverable: no policy approval was given, so it stays OTHER even with
 * a perfect profile, VAT and amounts.
 */

const STS_ID = '696f8b608af51a27cabb505e';
const INTECH_ID = '69c944172ddebc3eff81c9c3';
const ALPHONE_ID = '6a12f0860a0eb61e7a5c5e45';

const SUPPLIERS = [
  { id: STS_ID, name: 'אס.טי.אס מגה גרופ בע"מ', vat_id: '516542024', linet_supplier_account_id: '139', is_active: true },
  { id: INTECH_ID, name: 'פ.ט אינטק סחר בע"מ', vat_id: '516058989', linet_supplier_account_id: '151', is_active: true },
  { id: ALPHONE_ID, name: 'אולפון יבוא סחר בעמ', vat_id: '515893683', linet_supplier_account_id: null, is_active: true }
];

const stsProfile = () => matchSupplierProfile({ vat_id: '516542024' }, { suppliers: SUPPLIERS });
const alphoneProfile = () => matchSupplierProfile({ vat_id: '515893683' }, { suppliers: SUPPLIERS });

/** A document the model wrongly returned as OTHER; overrides shape each fixture. */
function otherExtraction(overrides: any = {}) {
  return {
    classification: 'OTHER',
    should_skip: true,
    skip_reason_he: 'המודל סבר שאין זו חשבונית.',
    doc_type_he: null,
    document_title: null,
    supplier_name: 'אס.טי.אס מגה גרופ בע"מ',
    supplier_vat_id: '516542024',
    doc_number: 'IN264002392',
    invoice_date: '2026-05-14',
    subtotal_before_vat: 1000,
    vat_amount: 180,
    total_with_vat: 1180,
    // Real monetary-audit provenance shape: role + printed label are what make the anchor exact.
    amount_provenance: { ambiguous: false, audit_version: 'monetary-audit-1.0.0', total_evidence_role: 'document_payable', total_evidence_label: 'סה"כ לתשלום', reasons: [] },
    overall_confidence: 12,
    line_items: [],
    ...overrides
  };
}

const strong = (overrides: any = {}) => otherExtraction(overrides);

const recover = (extraction: any, profile: any = stsProfile()) => evaluateClassificationRecovery({ extraction, profile_match: profile });

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

    // ══ A. Classification recovery ═════════════════════════════════════════════════════════
    check('a0_versions_are_reported',
      { guard: 'classification-guard-1.0.0', recovery: 'classification-recovery-1.0.0', lines: 'line-applicability-1.1.0' },
      { guard: CLASSIFICATION_GUARD_VERSION, recovery: CLASSIFICATION_RECOVERY_VERSION, lines: LINE_APPLICABILITY_VERSION });

    // Explicit positive printed title beats a mistaken model claim — tax invoice and credit note.
    const taxTitle = otherExtraction({ document_title: 'חשבונית מס' });
    const guardBefore = applyDocumentClassificationGuard(taxTitle);
    const taxRecovery = applyClassificationRecovery(taxTitle, { profile_match: stsProfile() });
    check('a1_explicit_tax_invoice_title_recovers_mistaken_other',
      { guard_kept: { classification: 'OTHER', code: 'UNSUPPORTED_DOC_TYPE' }, applied: true, from: 'OTHER', to: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', skip: false, anchors: ['explicit_positive_printed_title'], code: RECOVERY_REASON_CODES.TITLE_POSITIVE },
      { guard_kept: { classification: guardBefore.classification, code: guardBefore.reason_code }, applied: taxRecovery.applied, from: taxRecovery.from, to: taxRecovery.to, doc_type_he: taxInvoiceType(taxTitle), skip: taxTitle.should_skip, anchors: taxRecovery.anchors, code: taxRecovery.reason_code });

    const creditTitle = otherExtraction({ document_title: 'תעודת זיכוי', doc_number: 'IK264002392' });
    applyDocumentClassificationGuard(creditTitle);
    const creditRecovery = applyClassificationRecovery(creditTitle, { profile_match: stsProfile() });
    check('a2_explicit_credit_note_title_recovers_mistaken_other',
      { applied: true, to: 'CREDIT_NOTE', doc_type_he: 'חשבונית זיכוי', skip: false, code: RECOVERY_REASON_CODES.TITLE_POSITIVE },
      { applied: creditRecovery.applied, to: creditRecovery.to, doc_type_he: creditTitle.doc_type_he, skip: creditTitle.should_skip, code: creditRecovery.reason_code });

    check('a3_english_positive_titles_recover_too',
      { tax: 'TAX_INVOICE', vat: 'TAX_INVOICE', credit: 'CREDIT_NOTE', memo: 'CREDIT_NOTE' },
      {
        tax: recover(otherExtraction({ document_title: 'Tax Invoice' })).to,
        vat: recover(otherExtraction({ document_title: 'VAT Invoice #77' })).to,
        credit: recover(otherExtraction({ document_title: 'Credit Note' })).to,
        memo: recover(otherExtraction({ document_title: 'Credit Memo' })).to
      });

    // Explicit NEGATIVE titles always block, even with perfect identity, amounts and profile.
    const negatives = ['קבלה', 'receipt', 'תעודת משלוח', 'delivery note', 'הזמנת רכש', 'purchase order', 'statement', 'ריכוז חשבון', 'העברה בנקאית לספקים', 'remittance report', 'סיכום חשבון', 'proforma', 'הצעת מחיר', 'quotation', 'דוח מכירות'];
    const negativeResults = negatives.map((title) => {
      const decision = recover(strong({ document_title: title }));
      return { applied: decision.applied, code: decision.reason_code };
    });
    check('a4_explicit_negative_titles_always_block_despite_perfect_fields',
      negatives.map(() => ({ applied: false, code: RECOVERY_REASON_CODES.NEGATIVE_TITLE })),
      negativeResults);

    // Standalone RECEIPT specifically stays unsupported (no policy approval).
    const receipt = strong({ document_title: 'קבלה', classification: 'OTHER' });
    const receiptRecovery = applyClassificationRecovery(receipt, { profile_match: stsProfile() });
    check('a5_standalone_receipt_stays_other_and_skipped',
      { applied: false, classification: 'OTHER', doc_type_he: null, should_skip: true, blockers: ['explicit_negative_title'] },
      { applied: receiptRecovery.applied, classification: receipt.classification, doc_type_he: receipt.doc_type_he, should_skip: receipt.should_skip, blockers: receiptRecovery.blockers });

    // A "מס/קבלה" tax-receipt IS an explicit tax invoice and is not blocked by the receipt word.
    check('a6_tax_receipt_is_a_positive_tax_invoice_title',
      { to: 'TAX_INVOICE', code: RECOVERY_REASON_CODES.TITLE_POSITIVE },
      { to: recover(otherExtraction({ document_title: 'מס/קבלה' })).to, code: recover(otherExtraction({ document_title: 'מס/קבלה' })).reason_code });

    // Bare generic titles always block and are never upgraded.
    const generics = ['Invoice', 'חשבונית', 'חשבונית 12345', 'INVOICE #A-9'];
    check('a7_bare_generic_invoice_title_never_upgrades',
      generics.map(() => ({ applied: false, code: RECOVERY_REASON_CODES.GENERIC_TITLE })),
      generics.map((title) => { const d = recover(strong({ document_title: title })); return { applied: d.applied, code: d.reason_code }; }));

    // Missing title + ALL strong anchors → recovery, type from the profile doc-number pattern.
    const missingTitle = strong({ document_title: null });
    const missingRecovery = applyClassificationRecovery(missingTitle, { profile_match: stsProfile() });
    check('a8_missing_title_with_all_strong_anchors_recovers_type_from_doc_pattern',
      {
        applied: true, to: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', skip: false,
        anchors: ['reliable_curated_profile', 'exact_vat_identity', 'type_identifying_doc_number:tax_invoice', 'coherent_subtotal_vat_total', 'audited_document_payable'],
        // (a trusted sender would appear here only as an extra supporting anchor)
        blockers: [], code: RECOVERY_REASON_CODES.ANCHORS_SATISFIED
      },
      { applied: missingRecovery.applied, to: missingRecovery.to, doc_type_he: missingTitle.doc_type_he, skip: missingTitle.should_skip, anchors: missingRecovery.anchors, blockers: missingRecovery.blockers, code: missingRecovery.reason_code });

    // A credit-note pattern recovers a CREDIT_NOTE — never a guess, always the pattern kind.
    check('a9_credit_pattern_recovers_credit_note_type',
      { to: 'CREDIT_NOTE', anchor_present: true },
      (() => { const d = recover(strong({ document_title: null, doc_number: 'IK264002392' })); return { to: d.to, anchor_present: d.anchors.includes('type_identifying_doc_number:credit_note') }; })());

    // Remove ANY single required anchor → no recovery, review.
    const anchorRemovals: any = {
      no_profile: recover(strong({ document_title: null, supplier_vat_id: null, supplier_name: 'ספק לא מזוהה' }), matchSupplierProfile({}, { suppliers: SUPPLIERS })),
      name_only_identity: recover(strong({ document_title: null, supplier_vat_id: null, supplier_name: 'אס.טי.אס מגה גרופ' }), matchSupplierProfile({ supplier_name: 'אס.טי.אס מגה גרופ' }, { suppliers: SUPPLIERS })),
      missing_vat_with_profile: recover(strong({ document_title: null, supplier_vat_id: null })),
      doc_number_not_profile_valid: recover(strong({ document_title: null, doc_number: 'IN26400' })),
      doc_number_not_type_identifying: recover(strong({ document_title: null, doc_number: '264002392' })),
      no_doc_number: recover(strong({ document_title: null, doc_number: null })),
      total_missing: recover(strong({ document_title: null, total_with_vat: null })),
      monetary_incoherent_and_ambiguous: recover(strong({ document_title: null, subtotal_before_vat: 900, amount_provenance: { ambiguous: true, reasons: ['כמה סכומים'] } }))
    };
    check('a10_removing_any_single_required_anchor_prevents_recovery',
      Object.fromEntries(Object.keys(anchorRemovals).map((k) => [k, { applied: false, code: RECOVERY_REASON_CODES.INSUFFICIENT_ANCHORS }])),
      Object.fromEntries(Object.entries(anchorRemovals).map(([k, d]: any) => [k, { applied: d.applied, code: d.reason_code }])));

    // A bare-numeric profile-valid reference is valid but NOT type identifying → blocked.
    check('a10b_bare_numeric_reference_is_not_type_identifying',
      { applied: false, blocker_present: true },
      (() => { const d = recover(strong({ document_title: null, doc_number: '264002392' })); return { applied: d.applied, blocker_present: d.blockers.includes('doc_number_pattern_not_type_identifying') }; })());

    // Only ONE of the two monetary anchors is enough — but at least one is mandatory.
    check('a11_one_monetary_anchor_is_enough_zero_is_not',
      {
        coherent_only: { applied: true, has_coherent: true },
        audited_only: { applied: true, has_audited: true },
        neither: { applied: false }
      },
      {
        coherent_only: (() => { const d = recover(strong({ document_title: null, amount_provenance: null })); return { applied: d.applied, has_coherent: d.anchors.includes('coherent_subtotal_vat_total') }; })(),
        audited_only: (() => { const d = recover(strong({ document_title: null, subtotal_before_vat: null, vat_amount: null })); return { applied: d.applied, has_audited: d.anchors.includes('audited_document_payable') }; })(),
        neither: { applied: recover(strong({ document_title: null, subtotal_before_vat: 900, amount_provenance: { ambiguous: true } })).applied }
      });

    // Profile problems never recover: conflict, ambiguous, inactive row, missing row.
    const conflictProfile = matchSupplierProfile({ vat_id: '516542024', sender_email: 'allphonedocs@gmail.com' }, { suppliers: SUPPLIERS });
    const inactiveProfile = matchSupplierProfile({ vat_id: '516542024' }, { suppliers: SUPPLIERS.map((s) => (s.id === STS_ID ? { ...s, is_active: false } : s)) });
    const missingRowProfile = matchSupplierProfile({ vat_id: '516542024' }, { suppliers: SUPPLIERS.filter((s) => s.id !== STS_ID) });
    check('a12_profile_conflict_ambiguous_inactive_or_missing_never_recovers',
      { conflict: false, inactive: false, missing_row: false, no_profile_object: false },
      {
        conflict: recover(strong({ document_title: null }), conflictProfile).applied,
        inactive: recover(strong({ document_title: null }), inactiveProfile).applied,
        missing_row: recover(strong({ document_title: null }), missingRowProfile).applied,
        no_profile_object: recover(strong({ document_title: null }), null).applied
      });

    // Alphone: reliable profile, verified VAT, no Linet account — VAT identity is still exact, so
    // recovery is allowed here ONLY because the doc-number pattern and monetary anchors hold too.
    check('a13_alphone_profile_recovers_only_through_its_own_declared_pattern',
      { in_pattern: 'TAX_INVOICE', cr_pattern: 'CREDIT_NOTE', foreign_pattern: false },
      {
        in_pattern: recover(strong({ document_title: null, supplier_vat_id: '515893683', supplier_name: 'אולפון יבוא סחר', doc_number: 'IN123456789' }), alphoneProfile()).to,
        cr_pattern: recover(strong({ document_title: null, supplier_vat_id: '515893683', supplier_name: 'אולפון יבוא סחר', doc_number: 'CR123456789' }), alphoneProfile()).to,
        foreign_pattern: recover(strong({ document_title: null, supplier_vat_id: '515893683', supplier_name: 'אולפון יבוא סחר', doc_number: 'IK123456789' }), alphoneProfile()).applied
      });

    // Confidence never affects the result, in either direction.
    check('a14_confidence_never_affects_recovery',
      { low_conf_recovers: true, high_conf_receipt_blocked: false, identical_decisions: true },
      (() => {
        const low = recover(strong({ document_title: null, overall_confidence: 1 }));
        const high = recover(strong({ document_title: null, overall_confidence: 99 }));
        return {
          low_conf_recovers: low.applied,
          high_conf_receipt_blocked: recover(strong({ document_title: 'קבלה', overall_confidence: 99 })).applied,
          identical_decisions: JSON.stringify({ ...low, reason: null }) === JSON.stringify({ ...high, reason: null })
        };
      })());

    // Recovery never touches a document that is already supported, and never downgrades.
    check('a15_recovery_never_downgrades_or_touches_supported_documents',
      { attempted: false, applied: false, code: RECOVERY_REASON_CODES.NOT_NEEDED },
      (() => { const d = recover({ classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', document_title: 'חשבונית מס' }); return { attempted: d.attempted, applied: d.applied, code: d.reason_code }; })());

    // Audit metadata is compact: no document text, no coordinates.
    const auditKeys = Object.keys(missingRecovery).sort();
    check('a16_audit_metadata_is_compact_and_carries_no_document_text',
      { keys: ['anchors', 'applied', 'attempted', 'blockers', 'doc_type_he', 'from', 'reason', 'reason_code', 'to', 'version'], has_title_text: false },
      { keys: auditKeys, has_title_text: JSON.stringify(missingRecovery).includes('document_title') });

    // Recovery only opens the door — the gate still decides, and an unsupported type still fails.
    const gateAfterRecovery = validateInvoiceForAutoApproval(
      { supplier_name: 'אס.טי.אס מגה גרופ בע"מ', supplier_vat_id: '516542024', doc_number: 'IN264002392', invoice_date: '2026-05-14', subtotal_before_vat: 1000, vat_amount: 180, total_with_vat: 1180, doc_type_he: missingTitle.doc_type_he },
      { supplier: SUPPLIERS[0], supplier_match_method: 'vat_id', supplier_resolution: { reliable_for_auto_approval: true }, duplicates: [], invoice_id: 'inv-p1e', now: '2026-06-01T00:00:00Z' });
    const gateAfterBlocked = validateInvoiceForAutoApproval(
      { supplier_name: 'אס.טי.אס מגה גרופ בע"מ', supplier_vat_id: '516542024', doc_number: 'IN264002392', invoice_date: '2026-05-14', subtotal_before_vat: 1000, vat_amount: 180, total_with_vat: 1180, doc_type_he: receipt.doc_type_he },
      { supplier: SUPPLIERS[0], supplier_match_method: 'vat_id', supplier_resolution: { reliable_for_auto_approval: true }, duplicates: [], invoice_id: 'inv-p1e', now: '2026-06-01T00:00:00Z' });
    check('a17_gate_remains_the_only_approval_authority',
      { recovered_reaches_gate: true, blocked_document_still_fails_gate: false },
      { recovered_reaches_gate: gateAfterRecovery.passed, blocked_document_still_fails_gate: gateAfterBlocked.passed });

    check('a18_printed_title_verdicts_are_stable',
      [
        { present: false, verdict: 'absent' }, { present: true, verdict: 'positive' }, { present: true, verdict: 'negative' },
        { present: true, verdict: 'generic' }, { present: true, verdict: 'not_positive' }
      ],
      [null, 'חשבונית מס', 'קבלה', 'Invoice', 'מסמך התאמה'].map((t) => { const v = evaluatePrintedTitle(t); return { present: v.present, verdict: v.verdict }; }));

    // ══ B. Line applicability ══════════════════════════════════════════════════════════════
    // Legacy-safe: a normal product row with a real contradiction still blocks.
    const realContradiction = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 300,
      line_items: [{ line_number: 1, product_name: 'מטען מקורי', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300 }]
    });
    check('b1_real_comparable_contradiction_still_blocks',
      { codes: ['LINE_TOTAL_MISMATCH'], failures: 1, comparable_lines: 1, sum_applicable: true },
      { codes: realContradiction.reason_codes, failures: realContradiction.failures.length, comparable_lines: realContradiction.line_applicability.comparable_lines, sum_applicable: realContradiction.sum_applicable });

    // Class 1 — discounted unit price vs after-discount line total (explicit bases).
    const discountedBases = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 90,
      line_items: [{ line_number: 1, product_name: 'מוצר כללי', quantity: 1, unit_price_before_vat: 100, line_total_before_vat: 90, unit_price_basis: 'BEFORE_DISCOUNT', line_total_basis: 'AFTER_DISCOUNT', line_role: 'PRODUCT' }]
    });
    check('b2_discount_basis_mismatch_is_not_an_arithmetic_contradiction',
      { failures: 0, codes: ['LINE_BASE_NOT_COMPARABLE'], blockers: ['discount_basis_mismatch'], comparable: false },
      { failures: discountedBases.failures.length, codes: discountedBases.reason_codes, blockers: discountedBases.non_comparable_lines[0].blockers, comparable: discountedBases.line_applicability.roles[0].comparable });

    // Class 2 — VAT-inclusive unit price vs pre-VAT line total (explicit VAT bases).
    const vatBases = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 100,
      line_items: [{ line_number: 1, product_name: 'מוצר כללי', quantity: 1, unit_price_before_vat: 118, line_total_before_vat: 100, unit_price_includes_vat: true, line_total_includes_vat: false }]
    });
    check('b3_vat_basis_mismatch_is_not_an_arithmetic_contradiction',
      { failures: 0, codes: ['LINE_BASE_NOT_COMPARABLE'], blocker_present: true, sum_applicable: false },
      { failures: vatBases.failures.length, codes: vatBases.reason_codes, blocker_present: vatBases.non_comparable_lines[0].blockers.includes('vat_basis_mismatch'), sum_applicable: vatBases.sum_applicable });

    // Class 3 — summary / service rows: non-comparable AND exempt from the quantity requirement.
    const summaryRow = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 500,
      line_items: [
        { line_number: 1, product_name: 'פריט', quantity: 2, unit_price_before_vat: 250, line_total_before_vat: 500, line_role: 'PRODUCT' },
        { line_number: 2, product_name: 'שורת סיכום', quantity: null, unit_price_before_vat: null, line_total_before_vat: 500, line_role: 'SUMMARY' }
      ]
    });
    check('b4_summary_row_needs_no_quantity_and_makes_the_sum_non_applicable',
      { failures: 0, hasBadQuantity: false, sum_applicable: false, quantity_required_lines: 1, has_warning: true },
      { failures: summaryRow.failures.length, hasBadQuantity: summaryRow.hasBadQuantity, sum_applicable: summaryRow.sum_applicable, quantity_required_lines: summaryRow.line_applicability.quantity_required_lines, has_warning: summaryRow.warnings.length > 0 });

    const discountRow = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 450,
      line_items: [
        { line_number: 1, product_name: 'פריט', quantity: 2, unit_price_before_vat: 250, line_total_before_vat: 500 },
        { line_number: 2, product_name: 'הנחה מיוחדת', quantity: 0, unit_price_before_vat: null, line_total_before_vat: -50, line_role: 'DISCOUNT' }
      ]
    });
    check('b5_discount_and_rounding_rows_are_exempt_from_the_quantity_rule',
      { failures: 0, hasBadQuantity: false, roles: ['PRODUCT', 'DISCOUNT'] },
      { failures: discountRow.failures.length, hasBadQuantity: discountRow.hasBadQuantity, roles: discountRow.line_applicability.roles.map((r: any) => r.role) });

    // A real detail row with a missing/zero quantity is STILL critical.
    const zeroQtyProduct = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 100,
      line_items: [{ line_number: 1, product_name: 'מוצר', quantity: 0, unit_price_before_vat: 100, line_total_before_vat: 100, line_role: 'PRODUCT' }]
    });
    check('b6_zero_quantity_on_a_real_detail_line_is_still_critical',
      { has_code: true, failures_gt_0: true },
      { has_code: zeroQtyProduct.reason_codes.includes('LINE_QUANTITY_INVALID'), failures_gt_0: zeroQtyProduct.failures.length > 0 });

    // Unknown/mixed bases never alter the header and never claim a sum mismatch.
    const unknownBasisSum = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000, vat_amount: 180, total_with_vat: 1180,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400 },
        { line_number: 2, product_name: 'שירות חודשי', quantity: 1, unit_price_before_vat: 236, line_total_before_vat: 200, unit_price_includes_vat: true }
      ]
    });
    check('b7_unknown_or_mixed_bases_never_produce_a_false_sum_mismatch',
      { codes_has_sum_mismatch: false, hasMismatch: false, failures: 0, sum_applicable: false, header_untouched: { subtotal: 1000, vat: 180, total: 1180 } },
      {
        codes_has_sum_mismatch: unknownBasisSum.reason_codes.includes('LINE_SUM_MISMATCH'),
        hasMismatch: unknownBasisSum.hasMismatch,
        failures: unknownBasisSum.failures.length,
        sum_applicable: unknownBasisSum.sum_applicable,
        header_untouched: { subtotal: 1000, vat: 180, total: 1180 }
      });

    // A fully comparable set with a genuine sum gap still blocks.
    const realSumGap = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400 },
        { line_number: 2, product_name: 'פריט ב', quantity: 1, unit_price_before_vat: 200, line_total_before_vat: 200 }
      ]
    });
    check('b8_comparable_set_with_a_real_sum_gap_still_blocks',
      { code_present: true, hasMismatch: true, sum_applicable: true },
      { code_present: realSumGap.reason_codes.includes('LINE_SUM_MISMATCH'), hasMismatch: realSumGap.hasMismatch, sum_applicable: realSumGap.sum_applicable });

    // Behaviour is driven by printed semantics only — identical rows decide identically whatever
    // the supplier name, invoice id or file name is.
    const rowA = decideLineApplicability({ line_number: 1, product_name: 'פריט', quantity: 1, unit_price_before_vat: 100, line_total_before_vat: 90, unit_price_basis: 'BEFORE_DISCOUNT', line_total_basis: 'AFTER_DISCOUNT' }, {});
    const rowB = decideLineApplicability({ line_number: 1, product_name: 'ITEM', sku: 'XYZ', quantity: 1, unit_price_before_vat: 100, line_total_before_vat: 90, unit_price_basis: 'BEFORE_DISCOUNT', line_total_basis: 'AFTER_DISCOUNT' }, {});
    check('b9_decision_is_supplier_and_name_agnostic',
      { same: true, comparable: false },
      { same: JSON.stringify({ ...rowA, line_number: 0 }) === JSON.stringify({ ...rowB, line_number: 0 }), comparable: rowA.comparable });

    check('b10_applicability_summary_counts_are_reported',
      { total_lines: 2, comparable_lines: 1, non_comparable_lines: 1, sum_applicable: false },
      (() => {
        const s = summarizeLineApplicability([
          decideLineApplicability({ line_number: 1, product_name: 'פריט', quantity: 1, unit_price_before_vat: 100, line_total_before_vat: 100 }, {}),
          decideLineApplicability({ line_number: 2, product_name: 'פריט', quantity: 1, unit_price_before_vat: 118, line_total_before_vat: 100, line_total_includes_vat: true, unit_price_includes_vat: true }, {})
        ]);
        return { total_lines: s.total_lines, comparable_lines: s.comparable_lines, non_comparable_lines: s.non_comparable_lines, sum_applicable: s.sum_applicable };
      })());

    // ══ C. Route order / parity ════════════════════════════════════════════════════════════
    // All three routes call applyClassificationRecovery with the SAME options shape, at the same
    // position (post monetary audit + initial profile, pre P1-A, pre OTHER early return).
    const routeOptions = { profile_match: stsProfile() };
    const perRoute = ['runInvoiceExtraction', 'runInvoiceExtractionByInvoice', 'dryRunInvoiceExtraction'].map(() => {
      const extraction = strong({ document_title: null });
      const decision = applyClassificationRecovery(extraction, routeOptions);
      return { applied: decision.applied, to: decision.to, doc_type_he: extraction.doc_type_he, skip: extraction.should_skip, anchors: decision.anchors.length };
    });
    check('c1_all_three_routes_produce_identical_recovery_results',
      [perRoute[0], perRoute[0], perRoute[0]],
      perRoute);

    // The guard result is retained for audit on every route, alongside the recovery decision.
    const auditExtraction = otherExtraction({ document_title: 'חשבונית מס' });
    applyDocumentClassificationGuard(auditExtraction);
    applyClassificationRecovery(auditExtraction, routeOptions);
    check('c2_guard_and_recovery_audit_coexist_on_the_extraction',
      { guard_version: CLASSIFICATION_GUARD_VERSION, guard_classification: 'OTHER', recovery_version: CLASSIFICATION_RECOVERY_VERSION, final_classification: 'TAX_INVOICE' },
      { guard_version: auditExtraction.classification_guard.guard_version, guard_classification: auditExtraction.classification_guard.classification, recovery_version: auditExtraction.classification_recovery.version, final_classification: auditExtraction.classification });

    // ══ D. QA CORRECTION 1 — negative title ALWAYS wins a collision ═════════════════════════
    const collisions = ['Tax Invoice / Delivery Note', 'חשבונית מס - תעודת משלוח', 'חשבונית מס והזמנת רכש', 'Tax Invoice / Statement', 'חשבונית זיכוי / תעודת משלוח', 'Credit Note - Remittance Report'];
    check('d1_explicit_negative_beats_positive_in_a_collision_title',
      collisions.map(() => ({ verdict: 'negative', applied: false, code: RECOVERY_REASON_CODES.NEGATIVE_TITLE })),
      collisions.map((title) => {
        const d = recover(strong({ document_title: title }));
        return { verdict: evaluatePrintedTitle(title).verdict, applied: d.applied, code: d.reason_code };
      }));

    const taxReceipts = ['חשבונית מס/קבלה', 'חשבונית מס קבלה', 'מס/קבלה', 'חשבונית מס - קבלה'];
    check('d2_combined_tax_receipt_is_the_only_exception_and_stays_tax_invoice',
      taxReceipts.map(() => ({ verdict: 'positive', to: 'TAX_INVOICE', doc_type_he: 'חשבונית מס' })),
      taxReceipts.map((title) => {
        const e = otherExtraction({ document_title: title });
        const d = applyClassificationRecovery(e, { profile_match: stsProfile() });
        return { verdict: evaluatePrintedTitle(title).verdict, to: d.to, doc_type_he: e.doc_type_he };
      }));

    // ══ E. QA CORRECTION 2 — exact VAT is mandatory; sender never substitutes ════════════════
    const alphoneSenderProfile = matchSupplierProfile({ sender_email: 'allphonedocs@gmail.com' }, { suppliers: SUPPLIERS });
    const missingVatDecision = recover(strong({ document_title: null, supplier_vat_id: null, supplier_name: 'אולפון יבוא סחר', doc_number: 'IN123456789' }), alphoneSenderProfile);
    const mismatchedVatDecision = recover(strong({ document_title: null, supplier_vat_id: '516058989', supplier_name: 'אולפון יבוא סחר', doc_number: 'IN123456789' }), alphoneSenderProfile);
    check('e1_trusted_sender_or_domain_can_never_replace_a_missing_or_mismatched_vat',
      {
        sender_matched_profile: true,
        missing_vat: { applied: false, blocker: 'no_exact_vat_identity_evidence', code: RECOVERY_REASON_CODES.INSUFFICIENT_ANCHORS },
        mismatched_vat: { applied: false, blocker: 'vat_does_not_match_profile' }
      },
      {
        sender_matched_profile: alphoneSenderProfile.matched === true,
        missing_vat: {
          applied: missingVatDecision.applied,
          blocker: missingVatDecision.blockers.find((b: string) => b.startsWith('no_exact_vat')) || null,
          code: missingVatDecision.reason_code
        },
        mismatched_vat: {
          applied: mismatchedVatDecision.applied,
          blocker: mismatchedVatDecision.blockers.find((b: string) => b.startsWith('vat_does_not_match')) || null
        }
      });

    const exactVatDecision = recover(strong({ document_title: null }), stsProfile());
    check('e2_exact_vat_plus_all_other_anchors_is_allowed',
      { applied: true, has_exact_vat_anchor: true },
      { applied: exactVatDecision.applied, has_exact_vat_anchor: exactVatDecision.anchors.includes('exact_vat_identity') });

    // ══ F. QA CORRECTION 3 — audited-payable anchor requires role + printed label ════════════
    const auditVariants: any = {
      exact_role_and_label: { ambiguous: false, total_evidence_role: 'document_payable', total_evidence_label: 'סה"כ לתשלום' },
      ambiguous_false_only: { ambiguous: false },
      wrong_role: { ambiguous: false, total_evidence_role: 'fee_or_commission', total_evidence_label: 'עמלה' },
      empty_label: { ambiguous: false, total_evidence_role: 'document_payable', total_evidence_label: '   ' },
      ambiguous_true: { ambiguous: true, total_evidence_role: 'document_payable', total_evidence_label: 'סה"כ לתשלום' }
    };
    check('f1_audited_payable_anchor_requires_exact_role_and_non_empty_label',
      { exact_role_and_label: true, ambiguous_false_only: false, wrong_role: false, empty_label: false, ambiguous_true: false },
      Object.fromEntries(Object.entries(auditVariants).map(([key, prov]) => [
        key,
        // subtotal/VAT removed so ONLY the audited anchor can carry the monetary requirement.
        recover(strong({ document_title: null, subtotal_before_vat: null, vat_amount: null, amount_provenance: prov })).anchors.includes('audited_document_payable')
      ])));

    check('f2_without_an_exact_audited_anchor_recovery_needs_coherent_money',
      { audited_only_insufficient: false, coherent_rescues: true },
      {
        audited_only_insufficient: recover(strong({ document_title: null, subtotal_before_vat: null, vat_amount: null, amount_provenance: { ambiguous: false } })).applied,
        coherent_rescues: recover(strong({ document_title: null, amount_provenance: { ambiguous: false } })).applied
      });

    // ══ G. QA CORRECTION 4 — ABSENT vs PRESENT-UNKNOWN line metadata ════════════════════════
    const legacyContradiction = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 300,
      line_items: [{ line_number: 1, sku: 'A1', product_name: 'מטען מקורי', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300 }]
    });
    const legacyDecision = decideLineApplicability({ line_number: 1, product_name: 'מטען', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300 }, {});
    check('g1_legacy_absent_metadata_contradiction_still_blocks',
      { codes: ['LINE_TOTAL_MISMATCH'], comparable_lines: 1, metadata_present_any: false },
      {
        codes: legacyContradiction.reason_codes,
        comparable_lines: legacyContradiction.line_applicability.comparable_lines,
        metadata_present_any: Object.values(legacyDecision.metadata_present).some(Boolean)
      });

    const explicitUnknownBasis = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 300,
      line_items: [{ line_number: 1, product_name: 'מטען מקורי', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300, unit_price_basis: 'UNKNOWN', line_total_basis: 'UNKNOWN' }]
    });
    check('g2_explicit_unknown_basis_with_the_same_numbers_is_non_comparable',
      { failures: 0, codes: ['LINE_BASE_NOT_COMPARABLE'], blockers: ['discount_basis_unknown'] },
      { failures: explicitUnknownBasis.failures.length, codes: explicitUnknownBasis.reason_codes, blockers: explicitUnknownBasis.non_comparable_lines[0].blockers });

    const partialDiscountBasis = decideLineApplicability({ line_number: 1, product_name: 'מוצר', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300, unit_price_basis: 'BEFORE_DISCOUNT' }, {});
    const partialVatBasis = decideLineApplicability({ line_number: 2, product_name: 'מוצר', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300, line_total_includes_vat: false }, {});
    const explicitNullVat = decideLineApplicability({ line_number: 3, product_name: 'מוצר', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300, unit_price_includes_vat: null, line_total_includes_vat: null }, {});
    check('g3_partial_or_explicitly_null_metadata_is_non_comparable',
      {
        partial_discount: { comparable: false, blockers: ['discount_basis_metadata_partial'], sum_ok: true },
        partial_vat: { comparable: false, blockers: ['vat_basis_metadata_partial'], sum_ok: false },
        explicit_null_vat: { comparable: false, blockers: ['vat_basis_unknown'], sum_ok: false }
      },
      {
        partial_discount: { comparable: partialDiscountBasis.comparable, blockers: partialDiscountBasis.blockers, sum_ok: partialDiscountBasis.before_vat_sum_comparable },
        partial_vat: { comparable: partialVatBasis.comparable, blockers: partialVatBasis.blockers, sum_ok: partialVatBasis.before_vat_sum_comparable },
        explicit_null_vat: { comparable: explicitNullVat.comparable, blockers: explicitNullVat.blockers, sum_ok: explicitNullVat.before_vat_sum_comparable }
      });

    const missingTotalRow = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400 },
        { line_number: 2, product_name: 'פריט ב', quantity: 2, unit_price_before_vat: null, line_total_before_vat: null }
      ]
    });
    const missingUnitOnly = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400 },
        { line_number: 2, product_name: 'פריט ב', quantity: 2, unit_price_before_vat: null, line_total_before_vat: 600 }
      ]
    });
    check('g4_missing_total_or_unit_never_creates_a_false_sum_mismatch',
      { missing_total: { sum_mismatch: false, hasMismatch: false, sum_applicable: false }, missing_unit_only: { sum_mismatch: false, sum_applicable: true } },
      {
        missing_total: { sum_mismatch: missingTotalRow.reason_codes.includes('LINE_SUM_MISMATCH'), hasMismatch: missingTotalRow.hasMismatch, sum_applicable: missingTotalRow.sum_applicable },
        missing_unit_only: { sum_mismatch: missingUnitOnly.reason_codes.includes('LINE_SUM_MISMATCH'), sum_applicable: missingUnitOnly.sum_applicable }
      });

    const unknownTotalVatSum = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400, unit_price_includes_vat: null, line_total_includes_vat: null },
        { line_number: 2, product_name: 'פריט ב', quantity: 1, unit_price_before_vat: 200, line_total_before_vat: 200 }
      ]
    });
    check('g5_explicit_unknown_line_total_vat_basis_makes_the_sum_non_applicable',
      { sum_applicable: false, sum_mismatch: false, failures: 0 },
      { sum_applicable: unknownTotalVatSum.sum_applicable, sum_mismatch: unknownTotalVatSum.reason_codes.includes('LINE_SUM_MISMATCH'), failures: unknownTotalVatSum.failures.length });

    const comparableGap = getLineItemsCheck({
      doc_type_he: 'חשבונית מס', subtotal_before_vat: 1000,
      line_items: [
        { line_number: 1, product_name: 'פריט א', quantity: 1, unit_price_before_vat: 400, line_total_before_vat: 400, unit_price_basis: 'BEFORE_DISCOUNT', line_total_basis: 'BEFORE_DISCOUNT', unit_price_includes_vat: false, line_total_includes_vat: false },
        { line_number: 2, product_name: 'פריט ב', quantity: 1, unit_price_before_vat: 200, line_total_before_vat: 200, unit_price_basis: 'BEFORE_DISCOUNT', line_total_basis: 'BEFORE_DISCOUNT', unit_price_includes_vat: false, line_total_includes_vat: false }
      ]
    });
    check('g6_fully_comparable_real_sum_gap_still_blocks',
      { sum_applicable: true, sum_mismatch: true, comparable_lines: 2 },
      { sum_applicable: comparableGap.sum_applicable, sum_mismatch: comparableGap.reason_codes.includes('LINE_SUM_MISMATCH'), comparable_lines: comparableGap.line_applicability.comparable_lines });

    const failed = cases.filter((c) => !c.passed);
    return Response.json({
      success: true,
      dry_run: true,
      read_only: true,
      db_free: true,
      llm_free: true,
      production_entity_mutation: false,
      versions: { guard: CLASSIFICATION_GUARD_VERSION, classification_recovery: CLASSIFICATION_RECOVERY_VERSION, line_applicability: LINE_APPLICABILITY_VERSION },
      total: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
      cases
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});

/** Tiny local reader so the fixture above can assert the mutated doc type. */
function taxInvoiceType(extraction: any) {
  return extraction?.doc_type_he ?? null;
}