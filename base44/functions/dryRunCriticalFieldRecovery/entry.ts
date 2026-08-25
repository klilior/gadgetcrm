import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  CRITICAL_RECOVERY_VERSION,
  RECOVERY_REASON_CODES,
  planCriticalFieldRecovery,
  mergeCriticalFieldRecovery,
  applyCriticalFieldRecovery,
  buildRecoveryPrompt
} from '../../shared/invoiceCriticalFieldRecovery.ts';
import { applyDocumentClassificationGuard } from '../../shared/invoiceDocumentClassification.ts';
import { applyRecoveryProvenance, buildRecoveryEvents, parseProvenance, applyExtractionProvenance } from '../../shared/invoiceProvenance.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';
import { isFinalPayableLabel } from '../../shared/invoiceMonetaryAudit.ts';

/**
 * P1-A regression harness — PURE, DB-FREE, LLM-FREE (admins only).
 * Proves the second pass is requested ONLY for deterministically failed critical fields, and that
 * the merge is fail-closed: no silent overwrite, evidence-gated acceptance, conflict/unresolved →
 * manual review, and no recovered value can approve anything.
 */

const NOW = '2026-06-01T00:00:00Z';

const healthy = () => ({
  classification: 'TAX_INVOICE',
  doc_type_he: 'חשבונית מס',
  supplier_name: 'עופר בע"מ',
  supplier_vat_id: '514778392',
  doc_number: 'INV-100',
  invoice_date: '2026-05-01',
  doc_date: '2026-05-01',
  due_date: '2026-06-30',
  subtotal_before_vat: 100,
  vat_amount: 18,
  total_with_vat: 118
});

const field = (f: string, over: any = {}) => ({ field: f, found: true, confidence: 88, ...over });

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

  const cases: any[] = [];
  const check = (name: string, expected: any, actual: any) =>
    cases.push({ case: name, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual });

  // ── 1. Healthy extraction → no second pass at all ───────────────────────
  const healthyPlan = planCriticalFieldRecovery(healthy(), { now: NOW });
  check('f1_healthy_extraction_requests_nothing',
    { needed: false, request_fields: [] },
    { needed: healthyPlan.needed, request_fields: healthyPlan.request_fields });

  // ── 2. Missing doc number → only doc_number requested ───────────────────
  const noNumberPlan = planCriticalFieldRecovery({ ...healthy(), doc_number: null }, { now: NOW });
  check('f2_missing_doc_number_requests_only_doc_number',
    { needed: true, request_fields: ['doc_number'] },
    { needed: noNumberPlan.needed, request_fields: noNumberPlan.request_fields });

  // ── 3. Missing invoice date with a valid due date ───────────────────────
  // The due date here is itself a plausible past date, so the rejection can only come from the
  // due-date LABEL rule and not from a plausibility failure.
  const noDate = { ...healthy(), invoice_date: null, doc_date: null, due_date: '2026-05-30' };
  const noDatePlan = planCriticalFieldRecovery(noDate, { now: NOW });
  check('f3a_missing_invoice_date_requests_only_invoice_date',
    { request_fields: ['invoice_date'] },
    { request_fields: noDatePlan.request_fields });

  const dueLabelMerge = mergeCriticalFieldRecovery({
    extraction: noDate, plan: noDatePlan, now: NOW,
    second: { fields: [field('invoice_date', { normalized_value: '2026-05-30', printed_label: 'מועד תשלום', evidence_text: 'מועד תשלום: 30/05/2026' })] }
  });
  check('f3b_due_date_label_never_becomes_invoice_date',
    { selected: null, reason_code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, review: true, applied: [] },
    { selected: dueLabelMerge.decisions[0].selected_value, reason_code: dueLabelMerge.decisions[0].reason_code, review: dueLabelMerge.requires_manual_review, applied: dueLabelMerge.applied_fields });

  const dateOkMerge = mergeCriticalFieldRecovery({
    extraction: noDate, plan: noDatePlan, now: NOW,
    second: { fields: [field('invoice_date', { normalized_value: '2026-05-14', printed_label: 'תאריך החשבונית', evidence_text: 'תאריך החשבונית 14/05/2026' })] }
  });
  check('f3c_labelled_document_date_is_recovered',
    { value: '2026-05-14', code: RECOVERY_REASON_CODES.RECOVERED, applied: ['invoice_date'], review: false },
    { value: dateOkMerge.decisions[0].selected_value, code: dateOkMerge.decisions[0].reason_code, applied: dateOkMerge.applied_fields, review: dateOkMerge.requires_manual_review });

  // ── 4. Missing total: turnover / balance evidence rejected ─────────────
  const noTotal = { ...healthy(), total_with_vat: null, subtotal_before_vat: null, vat_amount: null };
  const noTotalPlan = planCriticalFieldRecovery(noTotal, { now: NOW });
  check('f4a_missing_total_requests_only_total',
    { request_fields: ['total_with_vat'] },
    { request_fields: noTotalPlan.request_fields });

  const turnoverMerge = mergeCriticalFieldRecovery({
    extraction: noTotal, plan: noTotalPlan, now: NOW,
    second: { fields: [field('total_with_vat', { normalized_value: 98450, printed_label: 'מחזור עסקאות', evidence_text: 'סה״כ מחזור עסקאות 98,450' })] }
  });
  check('f4b_turnover_label_is_rejected_as_total',
    { selected: null, code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, review: true },
    { selected: turnoverMerge.decisions[0].selected_value, code: turnoverMerge.decisions[0].reason_code, review: turnoverMerge.requires_manual_review });

  const balanceMerge = mergeCriticalFieldRecovery({
    extraction: noTotal, plan: noTotalPlan, now: NOW,
    second: { fields: [field('total_with_vat', { normalized_value: 5000, printed_label: 'יתרה קודמת' })] }
  });
  check('f4c_previous_balance_label_is_rejected_as_total',
    { selected: null, applied: [] },
    { selected: balanceMerge.decisions[0].selected_value, applied: balanceMerge.applied_fields });

  const payableMerge = mergeCriticalFieldRecovery({
    extraction: noTotal, plan: noTotalPlan, now: NOW,
    second: { fields: [field('total_with_vat', { normalized_value: 118, printed_label: 'סה״כ לתשלום', evidence_text: 'סה״כ לתשלום 118.00 ₪' })] }
  });
  check('f4d_explicit_payable_label_is_recovered',
    { value: 118, code: RECOVERY_REASON_CODES.RECOVERED },
    { value: payableMerge.decisions[0].selected_value, code: payableMerge.decisions[0].reason_code });

  // Arithmetic safety: a printed breakdown must still close on the recovered total.
  const badArithmetic = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), total_with_vat: null }, plan: planCriticalFieldRecovery({ ...healthy(), total_with_vat: null }, { now: NOW }), now: NOW,
    second: { fields: [field('total_with_vat', { normalized_value: 990, printed_label: 'סה״כ לתשלום' })] }
  });
  check('f4e_recovered_total_must_close_with_printed_breakdown',
    { selected: null, code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED },
    { selected: badArithmetic.decisions[0].selected_value, code: badArithmetic.decisions[0].reason_code });

  // ── 5. Missing supplier identity → both identity candidates ────────────
  const noSupplier = { ...healthy(), supplier_name: 'null', supplier_vat_id: 'null' };
  const noSupplierPlan = planCriticalFieldRecovery(noSupplier, { now: NOW });
  check('f5_missing_supplier_requests_name_and_vat',
    { request_fields: ['supplier_name', 'supplier_vat_id'] },
    { request_fields: noSupplierPlan.request_fields });

  const supplierMerge = mergeCriticalFieldRecovery({
    extraction: noSupplier, plan: noSupplierPlan, now: NOW,
    second: { fields: [
      field('supplier_name', { normalized_value: 'עופר בע"מ', printed_label: 'שם הספק' }),
      field('supplier_vat_id', { normalized_value: '514778392', printed_label: 'ח.פ' })
    ] }
  });
  check('f5b_supplier_identity_evidence_is_recovered_as_evidence_only',
    { applied: ['supplier_name', 'supplier_vat_id'], review: false },
    { applied: supplierMerge.applied_fields, review: supplierMerge.requires_manual_review });

  // ── 6. Agreement → eligible, first-pass value preserved ────────────────
  const agree = mergeCriticalFieldRecovery({
    extraction: healthy(), plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: 'INV-100', printed_label: 'מספר חשבונית' })] }
  });
  check('f6_agreement_keeps_first_pass_value',
    { value: 'INV-100', source: 'FIRST_PASS', code: RECOVERY_REASON_CODES.AGREEMENT, review: false, applied: [] },
    { value: agree.decisions[0].selected_value, source: agree.decisions[0].selected_source, code: agree.decisions[0].reason_code, review: agree.requires_manual_review, applied: agree.applied_fields });

  // ── 7. First missing + direct labelled evidence → eligible ─────────────
  const recovered = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), doc_number: null }, plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: '2640023', printed_label: 'מספר חשבונית', evidence_text: 'מספר חשבונית: 2640023' })] }
  });
  check('f7_labelled_doc_number_is_recovered',
    { value: '2640023', source: 'SECOND_PASS', code: RECOVERY_REASON_CODES.RECOVERED, review: false },
    { value: recovered.decisions[0].selected_value, source: recovered.decisions[0].selected_source, code: recovered.decisions[0].reason_code, review: recovered.requires_manual_review });

  // ── 8. Valid disagreement → conflict, nothing selected ─────────────────
  const conflict = mergeCriticalFieldRecovery({
    extraction: healthy(), plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: 'INV-999', printed_label: 'מספר חשבונית', confidence: 99 })] }
  });
  check('f8_valid_disagreement_is_conflict_and_manual_review',
    { selected: null, code: RECOVERY_REASON_CODES.CONFLICT, conflicts: ['doc_number'], review: true, applied: [], both_kept: true },
    { selected: conflict.decisions[0].selected_value, code: conflict.decisions[0].reason_code, conflicts: conflict.conflict_fields, review: conflict.requires_manual_review, applied: conflict.applied_fields, both_kept: conflict.decisions[0].first_pass.value === 'INV-100' && conflict.decisions[0].second_pass.value === 'INV-999' });

  // ── 9. Valid value, no field-appropriate evidence → unresolved ─────────
  const noEvidence = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), doc_number: null }, plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: '2640023', printed_label: null, evidence_text: null, confidence: 100 })] }
  });
  check('f9a_no_evidence_stays_unresolved',
    { selected: null, code: RECOVERY_REASON_CODES.EVIDENCE_MISSING, review: true },
    { selected: noEvidence.decisions[0].selected_value, code: noEvidence.decisions[0].reason_code, review: noEvidence.requires_manual_review });

  const wrongLabel = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), doc_number: null }, plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: '0501234567', printed_label: 'טלפון' })] }
  });
  check('f9b_field_inappropriate_label_stays_unresolved',
    { selected: null, code: RECOVERY_REASON_CODES.EVIDENCE_MISSING },
    { selected: wrongLabel.decisions[0].selected_value, code: wrongLabel.decisions[0].reason_code });

  // ── 10. Sentinels stay missing; confidence never decides ───────────────
  const sentinelMerge = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), supplier_vat_id: 'null', doc_number: '-' }, plan: { request_fields: ['doc_number', 'supplier_vat_id'] }, now: NOW,
    second: { fields: [
      field('doc_number', { normalized_value: 'N/A', printed_label: 'מספר חשבונית', confidence: 100 }),
      field('supplier_vat_id', { normalized_value: '/', printed_label: 'ח.פ', confidence: 100 })
    ] }
  });
  check('f10a_sentinel_values_remain_missing',
    { selected: [null, null], unresolved: ['doc_number', 'supplier_vat_id'], review: true },
    { selected: sentinelMerge.decisions.map((d: any) => d.selected_value), unresolved: sentinelMerge.unresolved_fields, review: sentinelMerge.requires_manual_review });

  const lowConf = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), doc_number: null }, plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: '2640023', printed_label: 'מספר חשבונית', confidence: 1 })] }
  });
  const highConfNoEvidence = mergeCriticalFieldRecovery({
    extraction: { ...healthy(), doc_number: null }, plan: { request_fields: ['doc_number'] }, now: NOW,
    second: { fields: [field('doc_number', { normalized_value: '2640023', printed_label: 'סכום', confidence: 100 })] }
  });
  check('f10b_confidence_never_changes_eligibility',
    { low_conf_accepted: true, high_conf_rejected: true },
    { low_conf_accepted: lowConf.applied_fields.includes('doc_number'), high_conf_rejected: !highConfNoEvidence.applied_fields.length });

  // ── 11. Classification OTHER can never be revived by recovery ──────────
  const receipt: any = { classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', document_title: 'קבלה', supplier_name: null, supplier_vat_id: null, doc_number: null, invoice_date: null, total_with_vat: null };
  applyDocumentClassificationGuard(receipt);
  const receiptPlan = planCriticalFieldRecovery(receipt, { now: NOW });
  const receiptMerge = mergeCriticalFieldRecovery({ extraction: receipt, plan: receiptPlan, now: NOW, second: { fields: [field('doc_number', { normalized_value: '777', printed_label: 'מספר חשבונית' })] } });
  applyCriticalFieldRecovery(receipt, receiptMerge);
  check('f11_other_document_never_recovers_or_upgrades',
    { needed: false, request_fields: [], classification: 'OTHER', doc_type_he: null, doc_number: null, should_skip: true },
    { needed: receiptPlan.needed, request_fields: receiptPlan.request_fields, classification: receipt.classification, doc_type_he: receipt.doc_type_he, doc_number: receipt.doc_number, should_skip: receipt.should_skip });

  // ── 12. Existing gate / line / duplicate semantics untouched ───────────
  const recoveredExtraction: any = { ...healthy(), doc_number: null };
  const recoveredPlan = planCriticalFieldRecovery(recoveredExtraction, { now: NOW });
  const recoveredMerge = mergeCriticalFieldRecovery({ extraction: recoveredExtraction, plan: recoveredPlan, now: NOW, second: { fields: [field('doc_number', { normalized_value: '2640023', printed_label: 'מספר חשבונית' })] } });
  applyCriticalFieldRecovery(recoveredExtraction, recoveredMerge);
  const unresolvedGate = validateInvoiceForAutoApproval({
    supplier_name: recoveredExtraction.supplier_name, supplier_vat_id: recoveredExtraction.supplier_vat_id,
    doc_number: recoveredExtraction.doc_number, invoice_date: recoveredExtraction.invoice_date,
    subtotal_before_vat: 100, vat_amount: 18, total_with_vat: 118, doc_type_he: 'חשבונית מס'
  }, { supplier: null, supplier_match_method: 'none', supplier_resolution: { reliable_for_auto_approval: false, reason_code: 'SUPPLIER_UNRESOLVED', reason: 'לא נמצאה התאמה' }, duplicates: [], invoice_id: 'inv-1', now: NOW });
  check('f12a_recovered_field_alone_never_approves',
    { doc_number: '2640023', gate_passed: false, supplier_failure: true },
    { doc_number: recoveredExtraction.doc_number, gate_passed: unresolvedGate.passed, supplier_failure: unresolvedGate.failures.some((f: string) => f.includes('SUPPLIER_UNRESOLVED')) });

  const resolvedGate = validateInvoiceForAutoApproval({
    supplier_name: 'עופר בע"מ', supplier_vat_id: '514778392', doc_number: recoveredExtraction.doc_number,
    invoice_date: '2026-05-01', subtotal_before_vat: 100, vat_amount: 18, total_with_vat: 118, doc_type_he: 'חשבונית מס'
  }, { supplier: { id: 'sup-1' }, supplier_match_method: 'vat_id', supplier_resolution: { method: 'vat_id', reliable_for_auto_approval: true }, duplicates: [{ id: 'inv-old', doc_number: '2640023', extraction_status: 'אושר' }], invoice_id: 'inv-1', now: NOW });
  check('f12b_duplicate_and_line_semantics_unchanged',
    { duplicate_blocks: true, line_check_applicable: false },
    { duplicate_blocks: resolvedGate.failures.some((f: string) => f.includes('כפילות')), line_check_applicable: getLineItemsCheck(recoveredExtraction).applicable });

  // ── Provenance: original + first + second + selected all preserved ─────
  const base = applyExtractionProvenance({ existingJson: null, values: { supplier: 'sup-1', doc_number: null, doc_date: '2026-05-01', total_with_vat: 118 }, supplierName: 'עופר בע"מ', at: NOW });
  const withRecovery = applyRecoveryProvenance({ existingJson: base.json, merge: conflict, at: NOW });
  const state = parseProvenance(withRecovery.json);
  check('p1_provenance_keeps_original_ai_and_both_candidates',
    { original_doc_number: null, ai_present: true, first: 'INV-100', second: 'INV-999', selected: null, code: RECOVERY_REASON_CODES.CONFLICT, no_text_keys: true },
    {
      original_doc_number: state.original.fields.doc_number, ai_present: !!state.ai,
      first: state.recovery.fields.doc_number.first.value, second: state.recovery.fields.doc_number.second.value,
      selected: state.recovery.fields.doc_number.selected.value, code: state.recovery.fields.doc_number.reason_code,
      no_text_keys: !JSON.stringify(state.recovery).includes('evidence_text') && !JSON.stringify(state.recovery).includes('line_items')
    });

  const events = buildRecoveryEvents(recoveredMerge, NOW).map((e: any) => e.type);
  check('p2_compact_events_recorded',
    ['RECOVERY_ATTEMPTED', 'RECOVERY_APPLIED'],
    events);
  check('p3_conflict_events_recorded',
    ['RECOVERY_ATTEMPTED', 'RECOVERY_CONFLICT'],
    buildRecoveryEvents(conflict, NOW).map((e: any) => e.type));

  // ── Prompt narrowness ─────────────────────────────────────────────────
  // ── Final-payable label predicate (gap 1) ──────────────────────────────
  const totalPlan = { request_fields: ['total_with_vat'] };
  const noTotalOnly = { ...healthy(), total_with_vat: null, subtotal_before_vat: null, vat_amount: null };
  const labelCase = (label: string) => mergeCriticalFieldRecovery({
    extraction: noTotalOnly, plan: totalPlan, now: NOW,
    second: { fields: [field('total_with_vat', { normalized_value: 118, printed_label: label })] }
  });
  check('g1a_before_vat_labels_are_rejected_as_total',
    { subtotal_he: false, subtotal_en: false, before_vat_en: false, vat_only: false, excl_vat: false },
    {
      subtotal_he: labelCase('סה״כ לפני מע״מ').applied_fields.includes('total_with_vat'),
      subtotal_en: labelCase('Subtotal').applied_fields.includes('total_with_vat'),
      before_vat_en: labelCase('Total before VAT').applied_fields.includes('total_with_vat'),
      vat_only: labelCase('מע״מ 18%').applied_fields.includes('total_with_vat'),
      excl_vat: labelCase('Total excluding tax').applied_fields.includes('total_with_vat')
    });
  check('g1b_before_vat_rejection_uses_final_payable_reason_code',
    { code: RECOVERY_REASON_CODES.EVIDENCE_REJECTED, review: true },
    { code: labelCase('סה״כ לפני מע״מ').decisions[0].reason_code, review: labelCase('Subtotal').requires_manual_review });
  check('g1c_final_payable_labels_are_accepted',
    { incl_vat_he: true, payable_he: true, amount_due: true, grand_total: true },
    {
      incl_vat_he: labelCase('סה״כ כולל מע״מ').applied_fields.includes('total_with_vat'),
      payable_he: labelCase('סה״כ לתשלום').applied_fields.includes('total_with_vat'),
      amount_due: labelCase('Amount Due').applied_fields.includes('total_with_vat'),
      grand_total: labelCase('Grand Total').applied_fields.includes('total_with_vat')
    });
  check('g1d_predicate_is_pure_and_authoritative',
    { rejected: [false, false, false, false, false, false, false], accepted: [true, true, true] },
    {
      rejected: ['סה״כ לפני מע״מ', 'Subtotal', 'VAT', 'מחזור עסקאות', 'יתרה קודמת', 'סיכום חשבון', 'מסגרת אשראי'].map((l) => isFinalPayableLabel(l)),
      accepted: ['סה״כ כולל מע״מ', 'סה״כ לתשלום', 'Grand Total'].map((l) => isFinalPayableLabel(l))
    });

  // ── Multi-invoice isolation (gap 2) ───────────────────────────────────
  const scopedPrompt = buildRecoveryPrompt(['doc_number', 'total_with_vat'], { index: 2, supplier_hint: 'עופר בע"מ', doc_number_hint: '2640023', page_hint: 'page 3', text: 'invoice #2 of 3 in this file' });
  const unscopedPrompt = buildRecoveryPrompt(['doc_number']);
  check('g2_scoped_prompt_forbids_cross_invoice_evidence',
    { has_scope_block: true, has_index: true, has_supplier: true, has_doc_hint: true, has_page: true, forbids_cross: true, refuses_with_found_false: true, unscoped_has_no_scope_block: true },
    {
      has_scope_block: scopedPrompt.includes('TARGET SCOPE (MANDATORY)'),
      has_index: scopedPrompt.includes('invoice #2'),
      has_supplier: scopedPrompt.includes('supplier: עופר בע"מ'),
      has_doc_hint: scopedPrompt.includes('document number: 2640023'),
      has_page: scopedPrompt.includes('location: page 3'),
      forbids_cross: scopedPrompt.includes('Cross-invoice evidence is forbidden'),
      refuses_with_found_false: scopedPrompt.includes('MUST be refused: set found = false'),
      unscoped_has_no_scope_block: !unscopedPrompt.includes('TARGET SCOPE (MANDATORY)')
    });

  const prompt = buildRecoveryPrompt(['doc_number']);
  check('p4_prompt_is_narrow_and_never_asks_for_lines',
    { has_doc_number: true, has_total: false, mentions_no_lines: true },
    { has_doc_number: prompt.includes('- doc_number'), has_total: prompt.includes('- total_with_vat'), mentions_no_lines: prompt.includes('DO NOT extract line items') });

  const passed = cases.filter((c) => c.passed).length;
  return Response.json({ success: true, dry_run: true, read_only: true, db_free: true, llm_free: true, version: CRITICAL_RECOVERY_VERSION, total: cases.length, passed, failed: cases.length - passed, cases });
});