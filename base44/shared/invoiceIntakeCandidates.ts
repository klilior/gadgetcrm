/**
 * D1 candidate loading — the ONLY place that reads intake rows for technical dedupe.
 * Exact equality queries only: no regex, no substring, no $like.
 *
 * Legacy combined ids (`message__attachment`) are discoverable without regex:
 *   - attachment + message present → also query the exact combined value.
 *   - message only → bounded read of GMAIL intakes (max 1000) so gmailIdentity() can parse
 *     legacy combined rows and match by exact parsed message id.
 */

import { gmailIdentity, trustedFileHash } from './invoiceIntakeIdentity.ts';

const LEGACY_SCAN_LIMIT = 1000;

/** Bounded, read-only fetch of the exact-identity duplicate candidates for one intake. */
export async function loadIntakeDuplicateCandidates(base44, intake) {
  const entity = base44.asServiceRole.entities.InvoiceIntakeRaw;
  const candidates = [];

  const hash = trustedFileHash(intake);
  if (hash) candidates.push(...await entity.filter({ file_hash: hash }, 'id', LEGACY_SCAN_LIMIT));

  const { attachment_id: attachmentId, message_id: messageId } = gmailIdentity(intake);

  if (attachmentId) {
    candidates.push(...await entity.filter({ gmail_attachment_id: attachmentId }, 'id', 50));
    if (messageId) {
      // Legacy combined form stored on gmail_message_id — exact value, not a pattern.
      candidates.push(...await entity.filter({ gmail_message_id: `${messageId}__${attachmentId}` }, 'id', 50));
    }
  }

  if (messageId) {
    candidates.push(...await entity.filter({ gmail_message_id: messageId }, 'id', 50));
    if (!attachmentId) {
      // Message-only incoming: legacy rows hide the message inside a combined id, so scan a
      // bounded GMAIL window and let gmailIdentity() parse them for exact comparison.
      candidates.push(...await entity.filter({ source: 'GMAIL' }, '-received_at', LEGACY_SCAN_LIMIT));
    }
  }

  return [...new Map(candidates.filter(Boolean).map((item) => [item.id, item])).values()];
}