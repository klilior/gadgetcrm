import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { planMonetaryAudit, buildSkippedAuditProvenance, MONETARY_AUDIT_GATE_VERSION } from '../../shared/invoiceMonetaryAuditGate.ts';
import { isFinalPayableLabel } from '../../shared/invoiceMonetaryAudit.ts';

/**
 * Read-only regression harness for the deterministic monetary-audit gate.
 * Verifies the gate skips the second pass ONLY for self-proving first-pass amounts, and
 * fail-closes (needs_audit = true) in every doubtful case. No DB writes, no LLM calls.
 */

const base = {
  classification: 'TAX_INVOICE',
  subtotal_before_vat: 1000,
  vat_amount: 180,
  total_with_vat: 1180,
  total_printed_label: 'סה״כ לתשלום',
  has_transactions_table: false
};

const plan = (patch: any) => planMonetaryAudit({ ...base, ...patch }, isFinalPayableLabel);

Deno.serve(async (req) => {
  createClientFromRequest(req);

  const results: any[] = [];
  const check = (name: string, actual: any, expected: any) => {
    results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  };

  // 1. Clean, label-backed, arithmetically closed invoice → audit skipped.
  const clean = plan({});
  check('clean invoice skips audit', clean.needs_audit, false);
  check('clean invoice reason', clean.reason_code, 'FIRST_PASS_SELF_PROVING');

  // 2. Credit note with the same evidence → also skipped (sign convention safe).
  check('credit note skips audit', plan({ classification: 'CREDIT_NOTE', subtotal_before_vat: -1000, vat_amount: -180, total_with_vat: -1180 }).needs_audit, false);

  // 3. Zero-rated document → skipped.
  check('zero rated skips audit', plan({ vat_amount: 0, total_with_vat: 1000 }).needs_audit, false);

  // 4. Anything that is not a plain invoice / credit note → audited.
  check('OTHER is audited', plan({ classification: 'OTHER' }).reason_code, 'NON_SIMPLE_DOCUMENT');
  check('missing classification is audited', plan({ classification: undefined }).reason_code, 'NON_SIMPLE_DOCUMENT');

  // 5. Partial breakdown → audited (a lone total is never trusted).
  check('missing subtotal is audited', plan({ subtotal_before_vat: undefined }).reason_code, 'INCOMPLETE_BREAKDOWN');
  check('missing vat is audited', plan({ vat_amount: null }).reason_code, 'INCOMPLETE_BREAKDOWN');
  check('missing total is audited', plan({ total_with_vat: undefined }).reason_code, 'INCOMPLETE_BREAKDOWN');

  // 6. Transactions / activity table present → always audited (turnover risk).
  check('transactions table is audited', plan({ has_transactions_table: true }).reason_code, 'TRANSACTIONS_TABLE');

  // 7. The printed label must positively state "payable".
  check('missing label is audited', plan({ total_printed_label: null }).reason_code, 'NO_PAYABLE_LABEL');
  check('empty label is audited', plan({ total_printed_label: '   ' }).reason_code, 'NO_PAYABLE_LABEL');
  check('turnover label is audited', plan({ total_printed_label: 'סה״כ מחזור' }).reason_code, 'NO_PAYABLE_LABEL');
  check('previous balance label is audited', plan({ total_printed_label: 'יתרה קודמת' }).reason_code, 'NO_PAYABLE_LABEL');
  check('before vat label is audited', plan({ total_printed_label: 'סה״כ לפני מע״מ' }).reason_code, 'NO_PAYABLE_LABEL');

  // 8. Arithmetic must close, within rounding tolerance only.
  check('arithmetic mismatch is audited', plan({ total_with_vat: 1200 }).reason_code, 'ARITHMETIC_MISMATCH');
  check('rounding drift still skips', plan({ total_with_vat: 1180.01 }).needs_audit, false);

  // 9. The VAT share must be a recognised statutory rate.
  check('implausible vat rate is audited', plan({ vat_amount: 300, total_with_vat: 1300 }).reason_code, 'IMPLAUSIBLE_VAT_RATE');
  check('historic 17% skips', plan({ vat_amount: 170, total_with_vat: 1170 }).needs_audit, false);
  check('vat without base is audited', plan({ subtotal_before_vat: 0, vat_amount: 180, total_with_vat: 180 }).reason_code, 'IMPLAUSIBLE_VAT_RATE');

  // 10. Skip provenance keeps the audit trail explicit and non-ambiguous.
  const prov = buildSkippedAuditProvenance({ ...base }, clean, 'monetary-audit-1.0.0');
  check('provenance marks skip', prov.audit_skipped, true);
  check('provenance not ambiguous', prov.ambiguous, false);
  check('provenance keeps printed label', prov.total_evidence_label, 'סה״כ לתשלום');

  const failures = results.filter((r) => !r.pass);
  return Response.json({
    gate_version: MONETARY_AUDIT_GATE_VERSION,
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results
  });
});