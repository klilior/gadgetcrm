import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isSentinelValue, cleanEvidence } from '../../shared/invoiceSentinelValues.ts';
import { resolveSupplier, isValidVatIdentifier, normalizeVatId } from '../../shared/supplierResolver.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';

/**
 * D3b regression harness — PURE, DB-FREE, LLM-FREE (admins only).
 * Proves sentinel VAT evidence can never resolve a supplier by vat_id, and that line-arithmetic
 * blocking only fires on semantically comparable operands.
 */

const SUPPLIERS = [
  { id: 'sup-cloudways', name: 'Cloudways', vat_id: 'null' },          // legacy record with a bad stored id
  { id: 'sup-ofer', name: 'עופר בע"מ', vat_id: '514778392' },
  { id: 'sup-slash', name: 'ספק לוכסן', vat_id: '/' },
  { id: 'sup-anthropic', name: 'Anthropic', aliases: 'null | Anthropic PBC' }
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

  const cases: any[] = [];
  const check = (name: string, expected: any, actual: any) => {
    cases.push({ case: name, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual });
  };

  // ── 1. Sentinel vocabulary ──────────────────────────────────────────────
  const sentinels = ['', '  ', 'null', 'NULL', ' Null ', 'undefined', 'N/A', 'n / a', 'na', '-', '—', '/', '...', 'לא ידוע', 'לא ניתן לקרוא', 'unknown'];
  check('s1_all_sentinels_are_missing', sentinels.map(() => true), sentinels.map((v) => isSentinelValue(v)));
  const real = ['514778392', 'Cloudways', 'IE9825613N', '0', 'A-1'];
  check('s2_real_values_are_not_sentinels', real.map(() => false), real.map((v) => isSentinelValue(v)));
  check('s3_clean_evidence_blanks_sentinels', ['', '', 'עופר בע"מ'], [cleanEvidence('null'), cleanEvidence(' / '), cleanEvidence('  עופר בע"מ ')]);

  // ── 2. VAT identifier validity ──────────────────────────────────────────
  check('s4_sentinel_is_not_a_vat_identifier',
    { null_str: false, slash: false, dash: false, short: false, valid9: true, foreign: true },
    { null_str: isValidVatIdentifier('null'), slash: isValidVatIdentifier('/'), dash: isValidVatIdentifier('-'), short: isValidVatIdentifier('12'), valid9: isValidVatIdentifier('514778392'), foreign: isValidVatIdentifier('IE9825613N') });
  check('s5_sentinel_normalizes_to_empty', ['', '', '514778392'], [normalizeVatId('null'), normalizeVatId('/'), normalizeVatId('514778392')]);

  // ── 3. Resolution safety (the exact Ofer / Anthropic bug) ───────────────
  const ofer = resolveSupplier({ vat_id: 'null', supplier_name: 'עופר בע"מ' }, { suppliers: SUPPLIERS });
  check('r1_ofer_sentinel_vat_never_matches_cloudways',
    { method_is_vat: false, supplier_id: 'sup-ofer', method: 'exact_name' },
    { method_is_vat: ofer.method === 'vat_id', supplier_id: ofer.supplier_id, method: ofer.method });

  const anthropic = resolveSupplier({ vat_id: 'null', supplier_name: 'Anthropic PBC' }, { suppliers: SUPPLIERS });
  check('r2_anthropic_sentinel_vat_resolves_by_alias_not_vat',
    { method_is_vat: false, supplier_id: 'sup-anthropic' },
    { method_is_vat: anthropic.method === 'vat_id', supplier_id: anthropic.supplier_id });

  const slash = resolveSupplier({ vat_id: '/', supplier_name: 'ספק לא מזוהה' }, { suppliers: SUPPLIERS });
  check('r3_slash_vat_cannot_resolve_anything',
    { supplier_id: null, method: 'none', reliable: false },
    { supplier_id: slash.supplier_id, method: slash.method, reliable: slash.reliable_for_auto_approval });

  const sentinelAlias = resolveSupplier({ vat_id: 'null' }, { suppliers: SUPPLIERS });
  check('r4_sentinel_alias_on_stored_record_is_not_comparable',
    { supplier_id: null, method: 'none' },
    { supplier_id: sentinelAlias.supplier_id, method: sentinelAlias.method });

  const validVat = resolveSupplier({ vat_id: '514778392', supplier_name: 'שם שגוי לגמרי' }, { suppliers: SUPPLIERS });
  check('r5_valid_9_digit_vat_still_resolves_strongly',
    { method: 'vat_id', supplier_id: 'sup-ofer', reliable: true },
    { method: validVat.method, supplier_id: validVat.supplier_id, reliable: validVat.reliable_for_auto_approval });

  // ── 4. Gate supplier-name contract ──────────────────────────────────────
  const header = { doc_number: 'INV-77', invoice_date: '2026-05-01', doc_type_he: 'חשבונית מס', subtotal_before_vat: 100, vat_amount: 18, total_with_vat: 118 };
  const ctx = (resolution: any) => ({ supplier: resolution.supplier, supplier_match_method: resolution.method, supplier_resolution: resolution, duplicates: [], invoice_id: 'inv-x', now: '2026-06-01T00:00:00Z' });

  const blankNameVat = validateInvoiceForAutoApproval({ ...header, supplier_name: 'null', supplier_vat_id: '514778392' }, ctx(validVat));
  check('g1_blank_name_with_valid_vat_is_warning_not_failure',
    { passed: true, supplier_validated: true, has_warning: true },
    { passed: blankNameVat.passed, supplier_validated: blankNameVat.validated_fields.includes('supplier'), has_warning: blankNameVat.warnings.some((w: string) => w.includes('ח.פ')) });

  const weakName = validateInvoiceForAutoApproval({ ...header, supplier_name: 'עופר בע"מ', supplier_vat_id: null }, ctx(ofer));
  check('g2_name_only_resolution_still_fails',
    { passed: false, weak_failure: true },
    { passed: weakName.passed, weak_failure: weakName.failures.some((f: string) => f.includes('SUPPLIER_WEAK_EVIDENCE')) });

  const blankNameWeak = validateInvoiceForAutoApproval({ ...header, supplier_name: 'null', supplier_vat_id: 'null' }, ctx(ofer));
  check('g3_blank_name_without_strong_identity_still_fails',
    { passed: false },
    { passed: blankNameWeak.passed });

  // ── 5. Line-check applicability ─────────────────────────────────────────
  const applicableMismatch = getLineItemsCheck({
    doc_type_he: 'חשבונית מס',
    subtotal_before_vat: 300,
    line_items: [{ line_number: 1, product_name: 'מטען מקורי', quantity: 3, unit_price_before_vat: 50, line_total_before_vat: 300 }]
  });
  check('l1_comparable_line_contradiction_stays_critical',
    { codes: ['LINE_TOTAL_MISMATCH'], failures: 1 },
    { codes: applicableMismatch.reason_codes, failures: applicableMismatch.failures.length });

  const serviceLine = getLineItemsCheck({
    doc_type_he: 'חשבונית מס',
    subtotal_before_vat: 118,
    line_items: [{ line_number: 1, product_name: 'שירות חודשי כולל מע"מ', quantity: 1, unit_price_before_vat: 140, line_total_before_vat: 118, unit_price_includes_vat: true }]
  });
  check('l2_service_vat_inclusive_line_warns_only',
    { failures: 0, codes: ['LINE_BASE_NOT_COMPARABLE'], warned: true },
    { failures: serviceLine.failures.length, codes: serviceLine.reason_codes, warned: serviceLine.warnings.length > 0 });

  const discountLine = getLineItemsCheck({
    doc_type_he: 'חשבונית מס',
    subtotal_before_vat: 90,
    line_items: [{ line_number: 1, product_name: 'כיסוי סיליקון', quantity: 1, unit_price_before_vat: 100, line_total_before_vat: 90, discount_percent: 10 }]
  });
  check('l3_discount_line_is_not_a_deterministic_mismatch',
    { failures: 0, codes: ['LINE_BASE_NOT_COMPARABLE'] },
    { failures: discountLine.failures.length, codes: discountLine.reason_codes });

  const creditNegative = getLineItemsCheck({
    doc_type_he: 'חשבונית זיכוי',
    subtotal_before_vat: -200,
    line_items: [{ line_number: 1, product_name: 'החזרת מוצר', quantity: -2, unit_price_before_vat: 100, line_total_before_vat: -200 }]
  });
  check('l4_credit_note_negative_quantity_is_valid',
    { failures: 0, hasBadQuantity: false, hasMismatch: false },
    { failures: creditNegative.failures.length, hasBadQuantity: creditNegative.hasBadQuantity, hasMismatch: creditNegative.hasMismatch });

  const creditOppositeSigns = getLineItemsCheck({
    doc_type_he: 'חשבונית זיכוי',
    subtotal_before_vat: -500,
    line_items: [
      { line_number: 1, product_name: 'מכשיר', quantity: 1, unit_price_before_vat: 300, line_total_before_vat: 300 },
      { line_number: 2, product_name: 'אביזר', quantity: 2, unit_price_before_vat: 100, line_total_before_vat: 200 }
    ]
  });
  check('l5_credit_note_sign_presentation_not_a_sum_mismatch',
    { hasMismatch: false, failures: 0 },
    { hasMismatch: creditOppositeSigns.hasMismatch, failures: creditOppositeSigns.failures.length });

  const zeroQty = getLineItemsCheck({
    doc_type_he: 'חשבונית מס',
    subtotal_before_vat: 100,
    line_items: [{ line_number: 1, product_name: 'מוצר', quantity: 0, unit_price_before_vat: 100, line_total_before_vat: 100 }]
  });
  check('l6_missing_or_zero_quantity_still_fails',
    { codes_include_invalid: true, passed_lines: false },
    { codes_include_invalid: zeroQty.reason_codes.includes('LINE_QUANTITY_INVALID'), passed_lines: zeroQty.failures.length === 0 });

  const noLines = getLineItemsCheck({ doc_type_he: 'חשבונית מס', subtotal_before_vat: 100, line_items: [] });
  check('l7_summary_invoice_without_lines_not_applicable',
    { applicable: false, failures: 0 },
    { applicable: noLines.applicable, failures: noLines.failures.length });

  const gateWithWarnOnly = validateInvoiceForAutoApproval({ ...header, supplier_name: 'עופר בע"מ', supplier_vat_id: '514778392' }, { ...ctx(validVat), line_check: serviceLine });
  check('l8_non_applicable_line_warning_does_not_block_gate',
    { passed: true },
    { passed: gateWithWarnOnly.passed });

  const gateWithRealMismatch = validateInvoiceForAutoApproval({ ...header, supplier_name: 'עופר בע"מ', supplier_vat_id: '514778392' }, { ...ctx(validVat), line_check: applicableMismatch });
  check('l9_applicable_line_mismatch_blocks_gate',
    { passed: false },
    { passed: gateWithRealMismatch.passed });

  const passed = cases.filter((c) => c.passed).length;
  return Response.json({ success: true, dry_run: true, read_only: true, db_free: true, total: cases.length, passed, failed: cases.length - passed, cases });
});