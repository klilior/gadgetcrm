/**
 * D1 — technical identity + idempotency for invoice intake.
 *
 * Pure, DB-free decision logic. Two identity axes only:
 *   1. file_hash = lowercase 64-hex SHA-256 of the actual FILE BYTES (nothing else).
 *      Anything that is not 64-hex is a legacy pseudo-hash and is NEVER trusted as a
 *      technical duplicate key.
 *   2. Exact Gmail identity: gmail_attachment_id first, else gmail_message_id.
 *      Exact equality only — no regex, no substring.
 *
 * Technical duplicates are coded FILE_DUPLICATE / GMAIL_ATTACHMENT_DUPLICATE /
 * GMAIL_MESSAGE_DUPLICATE. They are never a Linet duplicate and never matched_duplicate.
 * No business duplicate, retry counters, or field provenance here — that is D2.
 */

export const FILE_HASH_ALGORITHM = 'SHA-256';

export const INTAKE_DUPLICATE_CODES = {
  FILE_DUPLICATE: 'FILE_DUPLICATE',
  GMAIL_ATTACHMENT_DUPLICATE: 'GMAIL_ATTACHMENT_DUPLICATE',
  GMAIL_MESSAGE_DUPLICATE: 'GMAIL_MESSAGE_DUPLICATE'
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Pure: true only for a lowercase 64-hex digest. */
export function isSha256Hex(value) {
  return typeof value === 'string' && SHA256_HEX.test(value.trim().toLowerCase());
}

/** The stored hash, only when it is a trustworthy SHA-256 of file bytes. */
export function trustedFileHash(intake) {
  const raw = String(intake?.file_hash || '').trim().toLowerCase();
  return isSha256Hex(raw) ? raw : null;
}

/** A legacy (non-64-hex) value that must be recomputed from bytes before dedupe. */
export function needsFileHashRecompute(intake) {
  return !!intake?.file && !trustedFileHash(intake);
}

/**
 * Exact Gmail identity of an intake. Legacy combined `message__attachment` values are read
 * as a FALLBACK only; new writes always populate the separate fields.
 */
export function gmailIdentity(intake) {
  const attachment = String(intake?.gmail_attachment_id || '').trim();
  const messageRaw = String(intake?.gmail_message_id || '').trim();
  if (attachment) return { attachment_id: attachment, message_id: messageRaw.split('__')[0] || null, legacy: false };
  if (messageRaw.includes('__')) {
    const [message, ...rest] = messageRaw.split('__');
    return { attachment_id: rest.join('__') || null, message_id: message || null, legacy: true };
  }
  return { attachment_id: null, message_id: messageRaw || null, legacy: false };
}

/**
 * Exact-equality Gmail dedupe against candidate intakes.
 * Semantics: INCOMING attachment id first; ELSE incoming message id. When the incoming has no
 * attachment, a candidate matches on the same parsed message id whether or not that candidate
 * carries its own attachment id (separate fields or legacy combined form).
 */
export function findGmailDuplicate(candidates, incoming, currentId) {
  const wanted = gmailIdentity(incoming);
  const others = (candidates || []).filter((item) => item && item.id !== currentId);
  if (wanted.attachment_id) {
    const hit = others.find((item) => gmailIdentity(item).attachment_id === wanted.attachment_id);
    return hit ? { intake: hit, reason_code: INTAKE_DUPLICATE_CODES.GMAIL_ATTACHMENT_DUPLICATE } : null;
  }
  if (wanted.message_id) {
    const hit = others.find((item) => gmailIdentity(item).message_id === wanted.message_id);
    return hit ? { intake: hit, reason_code: INTAKE_DUPLICATE_CODES.GMAIL_MESSAGE_DUPLICATE } : null;
  }
  return null;
}

/** File-bytes dedupe. Only trusted SHA-256 on BOTH sides can be a technical duplicate key. */
export function findFileHashDuplicate(candidates, incoming, currentId) {
  const hash = trustedFileHash(incoming);
  if (!hash) return null;
  const hit = (candidates || []).find((item) => item && item.id !== currentId && trustedFileHash(item) === hash);
  return hit ? { intake: hit, reason_code: INTAKE_DUPLICATE_CODES.FILE_DUPLICATE } : null;
}

/** Prefer an original that already carries a usable extraction, then any linked invoice. */
export function pickReusableOriginal(matches, currentId) {
  const others = (matches || []).filter((item) => item && item.id !== currentId);
  return others.find((item) => item.linked_invoice && item.ai_debug_last_extraction_json) ||
    others.find((item) => item.linked_invoice) || others[0] || null;
}

/**
 * Single decision function shared by processIntake and processIntakeAutomation, so a
 * sequential retry of the same intake can never produce a second invoice shell.
 *
 * @returns {{action: 'skip'|'reuse_existing'|'reuse_duplicate'|'create', invoice_id: string|null, reason_code: string|null, reason: string|null, original_intake_id: string|null, reuse_extraction_json: string|null}}
 */
export function decideIntakeShellAction({ intake, invoicesForIntake, duplicateCandidates, isValidFile }) {
  const intakeId = intake?.id || null;

  // 1. Same intake, already linked → return the existing invoice, always.
  if (intake?.linked_invoice) {
    return { action: 'reuse_existing', invoice_id: intake.linked_invoice, reason_code: null, reason: 'החשבונית כבר מקושרת לקליטה זו.', original_intake_id: intakeId, reuse_extraction_json: null };
  }

  // 2. Same intake, invoice already points back via source_intake → reuse it, never create.
  const bySourceIntake = (invoicesForIntake || []).find((invoice) => invoice && invoice.source_intake === intakeId);
  if (bySourceIntake?.id) {
    return { action: 'reuse_existing', invoice_id: bySourceIntake.id, reason_code: null, reason: 'קיימת חשבונית המקושרת לקליטה זו דרך source_intake.', original_intake_id: intakeId, reuse_extraction_json: null };
  }

  // 3. Technical duplicate: reuse the ORIGINAL intake's invoice. No extra shell, no rejection.
  const duplicate = findGmailDuplicate(duplicateCandidates, intake, intakeId) || findFileHashDuplicate(duplicateCandidates, intake, intakeId);
  if (duplicate) {
    const pool = (duplicateCandidates || []).filter((item) => {
      if (!item || item.id === intakeId) return false;
      if (duplicate.reason_code === INTAKE_DUPLICATE_CODES.FILE_DUPLICATE) return trustedFileHash(item) === trustedFileHash(intake);
      return item.id === duplicate.intake.id;
    });
    const original = pickReusableOriginal(pool, intakeId) || duplicate.intake;
    if (original?.linked_invoice) {
      return {
        action: 'reuse_duplicate',
        invoice_id: original.linked_invoice,
        reason_code: duplicate.reason_code,
        reason: duplicate.reason_code === INTAKE_DUPLICATE_CODES.FILE_DUPLICATE
          ? 'כפילות טכנית לפי SHA-256 של בייטי הקובץ; נעשה שימוש בחשבונית ובחילוץ הקיימים.'
          : 'כפילות טכנית לפי זהות Gmail מדויקת; נעשה שימוש בחשבונית ובחילוץ הקיימים.',
        original_intake_id: original.id,
        reuse_extraction_json: original.ai_debug_last_extraction_json || null
      };
    }
  }

  // 4. Nothing to reuse → create exactly once, and only for a valid, non-skipped file.
  if (!isValidFile || intake?.status === 'דולג' || intake?.status === 'כפילות') {
    return { action: 'skip', invoice_id: null, reason_code: null, reason: intake?.status_reason || 'אין קובץ תקין לעיבוד.', original_intake_id: intakeId, reuse_extraction_json: null };
  }
  return { action: 'create', invoice_id: null, reason_code: null, reason: null, original_intake_id: intakeId, reuse_extraction_json: null };
}