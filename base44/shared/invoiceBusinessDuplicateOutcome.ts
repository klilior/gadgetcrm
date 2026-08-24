/**
 * D2a — the single pure decision for what a BUSINESS_DUPLICATE does to an extraction route.
 *
 * A business duplicate NEVER rejects, never marks the intake as 'כפילות', never writes
 * duplicate_key, and never touches any Linet duplicate state. It only forces manual review:
 * a stable BUSINESS_DUPLICATE failure, validation_passed=false, auto_approved=false, and
 * extraction_status='ממתין לאימות' — then normal persistence continues.
 */

import { BUSINESS_DUPLICATE_CODE } from './invoiceBusinessDuplicate.ts';

export const FORBIDDEN_BUSINESS_DUPLICATE_WRITES = ['duplicate_key', 'linet_match_status', 'matched_duplicate', 'כפילות', 'נדחה'];

/**
 * Mutates the gate in place (idempotently) with the BUSINESS_DUPLICATE failure and returns the
 * route outcome. Safe to call when businessDuplicate is null.
 */
export function applyBusinessDuplicateToGate(gate, businessDuplicate, extractionIsClean) {
  if (businessDuplicate && !gate.failures.some((failure) => String(failure).includes(BUSINESS_DUPLICATE_CODE))) {
    gate.failures.push(businessDuplicate.failure_he);
    gate.passed = false;
  }
  const canAutoApprove = !!gate.passed && !businessDuplicate && extractionIsClean !== false;
  return {
    can_auto_approve: canAutoApprove,
    extraction_status: canAutoApprove ? 'אושר' : 'ממתין לאימות',
    auto_approved: canAutoApprove,
    validation_passed: !!gate.passed,
    reason_code: businessDuplicate ? BUSINESS_DUPLICATE_CODE : null,
    duplicate_of: businessDuplicate?.duplicate_invoice_id || null,
    // Explicitly nothing about rejection, intake duplicate status or Linet state.
    intake_status_change: null,
    duplicate_key: null,
    linet_state_change: null
  };
}