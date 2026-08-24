/**
 * D1 — pure ordering/side-effect plan for runInvoiceExtractionByInvoice.
 *
 * The route must decide technical identity BEFORE it writes anything: no finalized-status reset,
 * no debug fields, no skip status, no hash persistence. This helper is DB-free and returns the
 * planned writes so the ordering itself is testable.
 *
 * Invariant: a cross-intake technical duplicate ⇒ planned_writes is EMPTY, even with force.
 * force may only affect NON-duplicate work; it can never bypass technical identity safety.
 */

import { findFileHashDuplicate, findGmailDuplicate, isSha256Hex, pickReusableOriginal, trustedFileHash, FILE_HASH_ALGORITHM } from './invoiceIntakeIdentity.ts';

export function planExtractionRoutePreflight({ intake, invoiceId, candidates, recomputedHash, force }) {
  // Recomputed bytes hash is applied IN MEMORY only; it is persisted after the duplicate ruling.
  const probe = isSha256Hex(recomputedHash)
    ? { ...intake, file_hash: String(recomputedHash).trim().toLowerCase() }
    : intake;
  const hashToPersist = trustedFileHash(probe) !== trustedFileHash(intake) ? trustedFileHash(probe) : null;

  const duplicate = findFileHashDuplicate(candidates, probe, intake?.id) || findGmailDuplicate(candidates, probe, intake?.id);
  const pool = (candidates || []).filter((item) => item && item.id !== intake?.id);
  const original = duplicate ? (pickReusableOriginal(pool, intake?.id) || duplicate.intake) : null;

  // Same-intake idempotency: an invoice already belonging to THIS intake is not a duplicate.
  const isCrossIntakeDuplicate = !!(original?.linked_invoice && original.linked_invoice !== invoiceId && original.id !== intake?.id);

  if (isCrossIntakeDuplicate) {
    return {
      is_duplicate: true,
      force_applied: false,
      reason_code: duplicate.reason_code,
      original_intake_id: original.id,
      original_invoice_id: original.linked_invoice,
      planned_writes: []
    };
  }

  return {
    is_duplicate: false,
    force_applied: force === true,
    reason_code: null,
    original_intake_id: null,
    original_invoice_id: null,
    planned_writes: hashToPersist
      ? [{ entity: 'InvoiceIntakeRaw', id: intake?.id, data: { file_hash: hashToPersist, file_hash_algorithm: FILE_HASH_ALGORITHM } }]
      : []
  };
}