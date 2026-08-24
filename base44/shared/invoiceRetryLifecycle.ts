/**
 * D2b1 — controlled retry lifecycle for invoice intake processing.
 *
 * Pure, DB-free planning only: every function returns the writes a caller SHOULD apply,
 * and performs no entity mutation itself.
 *
 * Attempt accounting rule (the whole point of this module):
 *   attempt_count increments ONLY when an actual AI extraction attempt begins.
 *   Deterministic re-runs — technical/business duplicate preflight, missing-file skip,
 *   early non-invoice skip, an already-populated gate re-run, or returning an existing
 *   linked invoice — are NOT attempts and must leave the counter untouched.
 *
 * No field provenance here (that is D2b2), and nothing in this module may express a Linet
 * state or a matched_duplicate.
 */

export const PROCESSING_STATUS = {
  IDLE: 'IDLE',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  RETRYABLE: 'RETRYABLE'
};

/** Stable, non-attempt reasons. Present for reporting only — never increments. */
export const NON_ATTEMPT_REASONS = {
  TECHNICAL_DUPLICATE_PREFLIGHT: 'TECHNICAL_DUPLICATE_PREFLIGHT',
  BUSINESS_DUPLICATE_PREFLIGHT: 'BUSINESS_DUPLICATE_PREFLIGHT',
  MISSING_FILE_SKIP: 'MISSING_FILE_SKIP',
  EARLY_NON_INVOICE_SKIP: 'EARLY_NON_INVOICE_SKIP',
  ALREADY_POPULATED_GATE: 'ALREADY_POPULATED_GATE',
  REUSE_EXISTING_INVOICE: 'REUSE_EXISTING_INVOICE',
  FINALIZED_INVOICE: 'FINALIZED_INVOICE',
  INTAKE_NOT_READY: 'INTAKE_NOT_READY',
  NO_LINKED_INVOICE: 'NO_LINKED_INVOICE',
  INTAKE_NOT_FOUND: 'INTAKE_NOT_FOUND'
};

const MAX_ERROR_LENGTH = 500;

/** Terminal = the extraction returned something structurally unusable; retrying cannot help. */
const TERMINAL_PATTERNS = [
  'Invalid extraction response',
  'תגובת AI לא תקינה'
];

export function classifyExtractionFailure(error) {
  const message = String(error?.message || error || '').trim();
  return TERMINAL_PATTERNS.some((pattern) => message.includes(pattern))
    ? PROCESSING_STATUS.FAILED
    : PROCESSING_STATUS.RETRYABLE;
}

/**
 * An actual AI extraction attempt is starting: the ONLY place attempt_count moves.
 * The same intake and the same invoice are preserved across retries — nothing here
 * touches file, linked_invoice or duplicate codes.
 */
export function planAttemptStart(intake, at = new Date().toISOString()) {
  const current = Number(intake?.attempt_count) || 0;
  return {
    is_attempt: true,
    attempt_delta: 1,
    reason: null,
    writes: {
      attempt_count: current + 1,
      last_attempt_at: at,
      processing_status: PROCESSING_STATUS.PROCESSING
    }
  };
}

/** Any deterministic re-run / preflight / skip path: reportable, but never an attempt. */
export function planNonAttempt(reason) {
  return { is_attempt: false, attempt_delta: 0, reason: reason || null, writes: {} };
}

/** Completed extraction, or an intentional non-invoice classification. Clears last_error. */
export function planAttemptSuccess() {
  return {
    is_attempt: false,
    attempt_delta: 0,
    reason: null,
    writes: { processing_status: PROCESSING_STATUS.SUCCEEDED, last_error: null }
  };
}

/**
 * Failure outcome. Transient extraction/PDF errors → RETRYABLE (safe to run again on the
 * same intake/invoice); a structurally invalid response → FAILED. last_error is only ever
 * set here; it is cleared exclusively by planAttemptSuccess.
 */
export function planAttemptFailure(error) {
  const status = classifyExtractionFailure(error);
  return {
    is_attempt: false,
    attempt_delta: 0,
    reason: null,
    writes: {
      processing_status: status,
      last_error: String(error?.message || error || 'שגיאה לא ידועה').slice(0, MAX_ERROR_LENGTH)
    }
  };
}

/** Legacy intake status a failed route leaves behind. */
export const RETRY_READY_STATUS = 'מוכן לניתוח';

/**
 * Route-level failure target. The caller MUST have captured intake_id before the request body
 * was consumed — this plan simply carries that exact id through, so the failure always lands on
 * the original intake. A transient failure stays 'מוכן לניתוח' so a retry is actually possible;
 * a terminal failure also stays ready for manual recovery but is marked FAILED.
 */
export function planRouteFailureTarget({ intakeId, error }) {
  const failure = planAttemptFailure(error);
  const retryable = failure.writes.processing_status === PROCESSING_STATUS.RETRYABLE;
  return {
    intake_id: intakeId || null,
    can_persist: Boolean(intakeId),
    retryable,
    attempt_delta: 0,
    writes: {
      status: RETRY_READY_STATUS,
      status_reason: retryable
        ? 'שגיאת ניתוח זמנית. הקליטה נשארה מוכנה לניתוח לנסיון חוזר.'
        : 'שגיאת ניתוח מסמך. נדרש טיפול ידני.',
      ...failure.writes
    }
  };
}