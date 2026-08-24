import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { evaluateDocumentClassification, CLASSIFICATION_REASON_CODES } from '../../shared/invoiceDocumentClassification.ts';
import { selectPayableAmounts } from '../../shared/invoiceMonetaryAudit.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';

/**
 * D3a regression harness — PURE and DB-FREE (admins only).
 * No LLM call, no entity read or write, no reconciliation. It only feeds synthetic fixtures
 * through the deterministic classification guard, the monetary-audit selector and the gate.
 */

const line = (amount: number, printed_label: string, role: string, in_document_totals_block = true) =>
  ({ amount, printed_label, role, in_document_totals_block });

/** Standard invoice: explicit payable label, printed subtotal + VAT, model unsure. */
const standardInvoice = (total: number, sub: number, vat: number, label = 'סה"כ לתשלום', ambiguous = true) => ({
  document_kind: 'standard_invoice',
  ambiguous,
  ambiguity_reason: ambiguous ? 'מספר סכומים במסמך' : null,
  candidates: [line(total, label, 'document_payable'), line(sub, 'סה"כ לפני מע"מ', 'document_subtotal'), line(vat, 'מע"מ 18%', 'document_vat')]
});

/** Phoenix-shaped clearing statement: big turnover figures + this document's own charge block. */
const clearingStatement = (payable: number, turnover: number) => ({
  document_kind: 'clearing_or_commission_statement',
  ambiguous: false,
  candidates: [
    line(turnover, 'סה"כ עסקאות', 'transaction_turnover', false),
    line(turnover, 'סכום להעברה', 'settlement_transfer', false),
    line(payable, 'סה"כ לתשלום', 'document_payable'),
    line(Math.round((payable / 1.18) * 100) / 100, 'סה"כ לפני מע"מ', 'document_subtotal'),
    line(Math.round((payable - payable / 1.18) * 100) / 100, 'מע"מ 18%', 'document_vat')
  ]
});

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

  const cases: any[] = [];
  const check = (name: string, expected: any, actual: any) => {
    const passed = JSON.stringify(expected) === JSON.stringify(actual);
    cases.push({ case: name, passed, expected, actual });
  };

  // ── 1. Classification guard ─────────────────────────────────────────────
  const receipt = evaluateDocumentClassification({ classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', document_title: 'קבלה' });
  check('c1_receipt_stays_other',
    { classification: 'OTHER', should_skip: true, reason_code: CLASSIFICATION_REASON_CODES.NON_TAX_DOCUMENT, downgraded: true },
    { classification: receipt.classification, should_skip: receipt.should_skip, reason_code: receipt.reason_code, downgraded: receipt.downgraded });

  const deliveryNote = evaluateDocumentClassification({ classification: 'TAX_INVOICE', document_title: 'תעודת משלוח' });
  check('c2_delivery_note_stays_other',
    { classification: 'OTHER', reason_code: CLASSIFICATION_REASON_CODES.NON_TAX_DOCUMENT },
    { classification: deliveryNote.classification, reason_code: deliveryNote.reason_code });

  const genericInvoice = evaluateDocumentClassification({ classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', document_title: 'Invoice' });
  check('c3_generic_english_invoice_stays_other',
    { classification: 'OTHER', doc_type_he: null, reason_code: CLASSIFICATION_REASON_CODES.GENERIC_INVOICE_TITLE },
    { classification: genericInvoice.classification, doc_type_he: genericInvoice.doc_type_he, reason_code: genericInvoice.reason_code });

  const taxInvoice = evaluateDocumentClassification({ classification: 'TAX_INVOICE', document_title: 'Tax Invoice' });
  check('c4_explicit_tax_invoice_supported',
    { classification: 'TAX_INVOICE', doc_type_he: 'חשבונית מס', should_skip: false, reason_code: null },
    { classification: taxInvoice.classification, doc_type_he: taxInvoice.doc_type_he, should_skip: taxInvoice.should_skip, reason_code: taxInvoice.reason_code });

  const hebrewTaxInvoice = evaluateDocumentClassification({ classification: 'TAX_INVOICE', document_title: 'חשבונית מס 12345' });
  const creditNote = evaluateDocumentClassification({ classification: 'CREDIT_NOTE', document_title: 'חשבונית זיכוי' });
  check('c5_hebrew_tax_invoice_and_credit_note_supported',
    { tax: 'חשבונית מס', credit: 'חשבונית זיכוי' },
    { tax: hebrewTaxInvoice.doc_type_he, credit: creditNote.doc_type_he });

  // Unsupported type is a CRITICAL gate failure even with a readable number, date and total.
  const gateBase = {
    supplier_name: 'ספק לדוגמה',
    supplier_vat_id: '123456789',
    doc_number: 'INV-1001',
    invoice_date: '2026-05-01',
    subtotal_before_vat: 681.36,
    vat_amount: 122.64,
    total_with_vat: 804
  };
  const gateContext = {
    supplier: { id: 'sup-1', name: 'ספק לדוגמה' },
    supplier_match_method: 'vat_id',
    supplier_resolution: { reliable_for_auto_approval: true },
    duplicates: [],
    invoice_id: 'inv-1',
    now: '2026-06-01T00:00:00Z'
  };
  const unsupportedGate = validateInvoiceForAutoApproval({ ...gateBase, doc_type_he: null }, gateContext);
  check('c6_unsupported_doc_type_is_critical_gate_failure',
    { passed: false, has_code: true },
    { passed: unsupportedGate.passed, has_code: unsupportedGate.failures.some((f: string) => f.includes(CLASSIFICATION_REASON_CODES.UNSUPPORTED_DOC_TYPE)) });

  const supportedGate = validateInvoiceForAutoApproval({ ...gateBase, doc_type_he: 'חשבונית מס' }, gateContext);
  check('c7_supported_doc_type_passes_gate',
    { passed: true, validated: true },
    { passed: supportedGate.passed, validated: supportedGate.validated_fields.includes('doc_type') });

  // ── 2. Payable total selection ──────────────────────────────────────────
  const t804 = selectPayableAmounts(standardInvoice(804, 681.36, 122.64));
  check('t1_standard_804_explicit_label_over_model_ambiguity',
    { total: 804, subtotal: 681.36, vat: 122.64, ambiguous: false },
    { total: t804.total, subtotal: t804.subtotal, vat: t804.vat, ambiguous: t804.provenance.ambiguous });

  const t3832 = selectPayableAmounts({
    document_kind: 'standard_invoice',
    ambiguous: false,
    candidates: [
      line(3832.93, 'סה"כ כולל מע"מ', 'document_payable'),
      line(3832.93, 'יתרה', 'previous_balance', false),
      line(3248.25, 'סה"כ לפני מע"מ', 'document_subtotal'),
      line(584.68, 'מע"מ', 'document_vat')
    ]
  });
  check('t2_duplicate_numeric_value_is_not_ambiguity',
    { total: 3832.93, subtotal: 3248.25, ambiguous: false },
    { total: t3832.total, subtotal: t3832.subtotal, ambiguous: t3832.provenance.ambiguous });

  const t265 = selectPayableAmounts({
    document_kind: 'standard_invoice',
    ambiguous: true,
    ambiguity_reason: 'לא בטוח',
    candidates: [line(265.04, 'סכום כולל', 'document_payable')]
  });
  check('t3_standard_265_04_sum_total_label',
    { total: 265.04, subtotal: null, ambiguous: false },
    { total: t265.total, subtotal: t265.subtotal, ambiguous: t265.provenance.ambiguous });

  const tZero = selectPayableAmounts(standardInvoice(0, 0, 0, 'סה"כ לתשלום', false));
  check('t4_explicit_zero_is_valid',
    { total: 0, subtotal: 0, vat: 0, ambiguous: false },
    { total: tZero.total, subtotal: tZero.subtotal, vat: tZero.vat, ambiguous: tZero.provenance.ambiguous });

  const tCreditSigned = selectPayableAmounts({
    document_kind: 'credit_note',
    ambiguous: false,
    candidates: [line(-200, 'סה"כ לתשלום', 'document_payable'), line(-169.49, 'סה"כ לפני מע"מ', 'document_subtotal'), line(-30.51, 'מע"מ 18%', 'document_vat')]
  });
  check('t5_credit_note_signed_200',
    { total: -200, subtotal: -169.49, ambiguous: false },
    { total: tCreditSigned.total, subtotal: tCreditSigned.subtotal, ambiguous: tCreditSigned.provenance.ambiguous });

  const tCreditPositive = selectPayableAmounts({
    document_kind: 'credit_note',
    ambiguous: true,
    ambiguity_reason: 'זיכוי',
    candidates: [line(11500, 'סה"כ', 'document_payable'), line(9745.76, 'סה"כ לפני מע"מ', 'document_subtotal'), line(1754.24, 'מע"מ', 'document_vat')]
  });
  check('t6_credit_note_positive_presentation_11500',
    { total: 11500, subtotal: 9745.76, vat: 1754.24, ambiguous: false },
    { total: tCreditPositive.total, subtotal: tCreditPositive.subtotal, vat: tCreditPositive.vat, ambiguous: tCreditPositive.provenance.ambiguous });

  const t15100 = selectPayableAmounts({
    document_kind: 'standard_invoice',
    ambiguous: true,
    ambiguity_reason: 'כמה סכומים',
    candidates: [
      line(15100, 'סה"כ לתשלום', 'document_payable'),
      line(42000, 'סיכום חשבון', 'account_summary', false),
      line(38000, 'מסגרת אשראי', 'credit_limit', false)
    ]
  });
  check('t7_invoice_15100_not_account_summary',
    { total: 15100, ambiguous: false },
    { total: t15100.total, ambiguous: t15100.provenance.ambiguous });

  const tCoherent = selectPayableAmounts({
    document_kind: 'standard_invoice',
    ambiguous: false,
    candidates: [
      line(1450, 'סה"כ כולל מע"מ', 'document_payable'),
      line(20500, 'Total', 'document_payable', false),
      line(1228.81, 'סה"כ לפני מע"מ', 'document_subtotal'),
      line(221.19, 'מע"מ 18%', 'document_vat')
    ]
  });
  check('t8_subtotal_plus_vat_coherence_picks_1450',
    { total: 1450, subtotal: 1228.81, vat: 221.19, ambiguous: false },
    { total: tCoherent.total, subtotal: tCoherent.subtotal, vat: tCoherent.vat, ambiguous: tCoherent.provenance.ambiguous });

  // ── 3. Phoenix non-regression (5/5 exact) ───────────────────────────────
  const phoenixExpected = [966.75, 989.51, 385.52, 622.99, 597.13];
  const phoenixActual = phoenixExpected.map((payable, i) => selectPayableAmounts(clearingStatement(payable, 120000 + i * 5000)).total);
  check('p1_phoenix_five_exact_non_regression', phoenixExpected, phoenixActual);

  const phoenixTurnoverOnly = selectPayableAmounts({
    document_kind: 'clearing_or_commission_statement',
    ambiguous: true,
    ambiguity_reason: 'רק מחזור',
    candidates: [line(120000, 'סה"כ', 'transaction_turnover', false), line(98000, 'סכום להעברה', 'settlement_transfer', false)]
  });
  check('p2_turnover_only_statement_stays_ambiguous',
    { total: null, ambiguous: true },
    { total: phoenixTurnoverOnly.total, ambiguous: phoenixTurnoverOnly.provenance.ambiguous });

  const passed = cases.filter((c) => c.passed).length;
  return Response.json({ success: true, dry_run: true, read_only: true, db_free: true, total: cases.length, passed, failed: cases.length - passed, cases });
});