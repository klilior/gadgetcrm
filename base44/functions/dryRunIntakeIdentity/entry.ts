import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { planExtractionRoutePreflight } from '../../shared/invoiceExtractionRoutePreflight.ts';
import { decideIntakeShellAction, findFileHashDuplicate, findGmailDuplicate, gmailIdentity, isSha256Hex, needsFileHashRecompute, pickReusableOriginal, trustedFileHash } from '../../shared/invoiceIntakeIdentity.ts';

/**
 * ADMIN-ONLY, STRICTLY READ-ONLY regression harness for D1 intake identity/idempotency.
 * Runs on synthetic fixtures only. It never reads or writes any entity, never downloads a
 * production file, and never invokes extraction/reconciliation/sync.
 */

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const bytesA = 'PDF-BYTES-A';
    const bytesB = 'PDF-BYTES-B';
    const [hashA1, hashA2, hashB] = await Promise.all([sha256Hex(bytesA), sha256Hex(bytesA), sha256Hex(bytesB)]);
    const legacyHash = hashA1.substring(0, 32);

    const fixtures = [];

    fixtures.push({ name: 'same_bytes_same_sha256', pass: hashA1 === hashA2 && isSha256Hex(hashA1), detail: { hashA1, hashA2 } });
    fixtures.push({ name: 'different_bytes_different_sha256', pass: hashA1 !== hashB && isSha256Hex(hashB), detail: { hashA1, hashB } });
    fixtures.push({
      name: 'legacy_32char_pseudo_hash_not_trusted',
      pass: !isSha256Hex(legacyHash) && trustedFileHash({ file_hash: legacyHash }) === null,
      detail: { legacyHash, length: legacyHash.length, trusted: trustedFileHash({ file_hash: legacyHash }) }
    });
    fixtures.push({
      name: 'legacy_pseudo_hash_never_dedupes',
      pass: decideIntakeShellAction({
        intake: { id: 'i2', file: 'u2', file_hash: legacyHash, status: 'מוכן לניתוח' },
        invoicesForIntake: [],
        duplicateCandidates: [{ id: 'i1', file_hash: legacyHash, linked_invoice: 'inv1' }],
        isValidFile: true
      }).action === 'create',
      detail: 'a legacy value shared by two intakes must NOT become a technical duplicate key'
    });

    const originalGmail = { id: 'i1', gmail_message_id: 'msg-1', gmail_attachment_id: 'ATT-12345', linked_invoice: 'inv1', ai_debug_last_extraction_json: '{"ok":true}' };
    const repeatExact = findGmailDuplicate([originalGmail], { gmail_message_id: 'msg-1', gmail_attachment_id: 'ATT-12345' }, null);
    fixtures.push({
      name: 'exact_attachment_repeat_returns_reuse',
      pass: repeatExact?.intake?.id === 'i1' && repeatExact?.reason_code === 'GMAIL_ATTACHMENT_DUPLICATE',
      detail: repeatExact ? { intake_id: repeatExact.intake.id, reason_code: repeatExact.reason_code } : null
    });
    const substringHit = findGmailDuplicate([originalGmail], { gmail_message_id: 'msg-1', gmail_attachment_id: 'ATT-123' }, null);
    fixtures.push({
      name: 'similar_substring_attachment_does_not_dedupe',
      pass: substringHit === null,
      detail: { probed: 'ATT-123 vs stored ATT-12345', result: substringHit }
    });
    fixtures.push({
      name: 'legacy_combined_id_read_as_fallback',
      pass: gmailIdentity({ gmail_message_id: 'msg-9__ATT-999' }).attachment_id === 'ATT-999' && gmailIdentity({ gmail_message_id: 'msg-9__ATT-999' }).message_id === 'msg-9',
      detail: gmailIdentity({ gmail_message_id: 'msg-9__ATT-999' })
    });

    // Incoming message-only: matches by exact parsed message id whether the candidate stores the
    // attachment separately or inside a legacy combined id.
    const separateIdCandidate = { id: 'i5', gmail_message_id: 'msg-5', gmail_attachment_id: 'ATT-55555', linked_invoice: 'inv5' };
    const messageOnlyVsSeparate = findGmailDuplicate([separateIdCandidate], { gmail_message_id: 'msg-5' }, null);
    fixtures.push({
      name: 'incoming_message_only_matches_candidate_with_separate_attachment',
      pass: messageOnlyVsSeparate?.intake?.id === 'i5' && messageOnlyVsSeparate?.reason_code === 'GMAIL_MESSAGE_DUPLICATE',
      detail: messageOnlyVsSeparate ? { intake_id: messageOnlyVsSeparate.intake.id, reason_code: messageOnlyVsSeparate.reason_code } : null
    });

    const legacyCombinedCandidate = { id: 'i6', gmail_message_id: 'msg-6__ATT-66666', linked_invoice: 'inv6' };
    const messageOnlyVsLegacy = findGmailDuplicate([legacyCombinedCandidate], { gmail_message_id: 'msg-6' }, null);
    fixtures.push({
      name: 'incoming_message_only_matches_legacy_combined_candidate',
      pass: messageOnlyVsLegacy?.intake?.id === 'i6' && messageOnlyVsLegacy?.reason_code === 'GMAIL_MESSAGE_DUPLICATE',
      detail: messageOnlyVsLegacy ? { intake_id: messageOnlyVsLegacy.intake.id, reason_code: messageOnlyVsLegacy.reason_code } : null
    });

    fixtures.push({
      name: 'incoming_message_only_different_message_does_not_match',
      pass: findGmailDuplicate([separateIdCandidate, legacyCombinedCandidate], { gmail_message_id: 'msg-7' }, null) === null,
      detail: { probed: 'msg-7 vs stored msg-5 / msg-6__ATT-66666' }
    });

    const gmailDupDecision = decideIntakeShellAction({
      intake: { id: 'i2', file: 'u2', gmail_message_id: 'msg-1', gmail_attachment_id: 'ATT-12345', status: 'מוכן לניתוח' },
      invoicesForIntake: [],
      duplicateCandidates: [originalGmail],
      isValidFile: true
    });
    fixtures.push({
      name: 'gmail_attachment_duplicate_reuses_original_invoice_no_new_shell',
      pass: gmailDupDecision.action === 'reuse_duplicate' && gmailDupDecision.invoice_id === 'inv1' && gmailDupDecision.reason_code === 'GMAIL_ATTACHMENT_DUPLICATE' && gmailDupDecision.reuse_extraction_json === '{"ok":true}',
      detail: gmailDupDecision
    });

    const fileDupDecision = decideIntakeShellAction({
      intake: { id: 'i2', file: 'u2', file_hash: hashA1, status: 'מוכן לניתוח' },
      invoicesForIntake: [],
      duplicateCandidates: [{ id: 'i1', file_hash: hashA2, linked_invoice: 'inv1', ai_debug_last_extraction_json: '{"ok":1}' }],
      isValidFile: true
    });
    fixtures.push({
      name: 'trusted_sha256_duplicate_reuses_original_invoice',
      pass: fileDupDecision.action === 'reuse_duplicate' && fileDupDecision.invoice_id === 'inv1' && fileDupDecision.reason_code === 'FILE_DUPLICATE',
      detail: fileDupDecision
    });

    // runInvoiceExtractionByInvoice preflight: legacy 32-char input must force a byte recompute and
    // must not dedupe; a trusted 64-hex pair selects the reusable original.
    fixtures.push({
      name: 'route_legacy_32char_hash_requires_recompute_and_no_dedupe',
      pass: needsFileHashRecompute({ file: 'u2', file_hash: legacyHash }) === true &&
        findFileHashDuplicate([{ id: 'i1', file_hash: legacyHash, linked_invoice: 'inv1' }], { id: 'i2', file_hash: legacyHash }, 'i2') === null,
      detail: { legacyHash, recompute_required: true, duplicate: null }
    });
    // Ordering proof: a cross-intake technical duplicate plans ZERO writes, force included.
    for (const force of [false, true]) {
      const plan = planExtractionRoutePreflight({
        intake: { id: 'i2', file: 'u2', file_hash: legacyHash, status: 'חדש' },
        invoiceId: 'inv2',
        candidates: [{ id: 'i1', file_hash: hashA2, linked_invoice: 'inv1', ai_debug_last_extraction_json: '{"ok":1}' }],
        recomputedHash: hashA1,
        force
      });
      fixtures.push({
        name: `route_cross_intake_duplicate_plans_zero_writes_force_${force}`,
        pass: plan.is_duplicate === true && plan.planned_writes.length === 0 && plan.force_applied === false &&
          plan.reason_code === 'FILE_DUPLICATE' && plan.original_invoice_id === 'inv1',
        detail: plan
      });
    }
    // No duplicate → the recomputed SHA-256 is the only planned write, persisted after the ruling.
    fixtures.push({
      name: 'route_no_duplicate_plans_only_hash_persistence',
      pass: (() => {
        const plan = planExtractionRoutePreflight({ intake: { id: 'i2', file: 'u2', file_hash: legacyHash }, invoiceId: 'inv2', candidates: [], recomputedHash: hashA1, force: true });
        return plan.is_duplicate === false && plan.force_applied === true && plan.planned_writes.length === 1 &&
          plan.planned_writes[0].data.file_hash === hashA1 && plan.planned_writes[0].data.file_hash_algorithm === 'SHA-256';
      })(),
      detail: 'hash + algorithm persisted once, only when no cross-intake duplicate exists'
    });
    // Same-intake idempotency: this intake\'s own invoice is not a technical duplicate.
    fixtures.push({
      name: 'route_same_intake_invoice_is_not_duplicate',
      pass: (() => {
        const plan = planExtractionRoutePreflight({ intake: { id: 'i2', file: 'u2', file_hash: hashA1 }, invoiceId: 'inv1', candidates: [{ id: 'i1', file_hash: hashA2, linked_invoice: 'inv1' }], recomputedHash: null, force: false });
        return plan.is_duplicate === false && plan.planned_writes.length === 0;
      })(),
      detail: 'linked_invoice === current invoice → normal flow continues, no writes planned here'
    });
    fixtures.push({
      name: 'route_trusted_64hex_selects_original_invoice',
      pass: (() => {
        const candidates = [{ id: 'i1', file_hash: hashA2, linked_invoice: 'inv1', ai_debug_last_extraction_json: '{"ok":1}' }];
        const incoming = { id: 'i2', file: 'u2', file_hash: hashA1 };
        const dup = findFileHashDuplicate(candidates, incoming, 'i2');
        const original = pickReusableOriginal(candidates, 'i2');
        return needsFileHashRecompute(incoming) === false && dup?.reason_code === 'FILE_DUPLICATE' && original?.linked_invoice === 'inv1';
      })(),
      detail: { recompute_required: false, reason_code: 'FILE_DUPLICATE', original_invoice_id: 'inv1' }
    });

    const linkedDecision = decideIntakeShellAction({
      intake: { id: 'i1', file: 'u1', file_hash: hashA1, linked_invoice: 'inv1', status: 'מוכן לניתוח' },
      invoicesForIntake: [],
      duplicateCandidates: [],
      isValidFile: true
    });
    fixtures.push({
      name: 'same_intake_with_linked_invoice_returns_existing',
      pass: linkedDecision.action === 'reuse_existing' && linkedDecision.invoice_id === 'inv1',
      detail: linkedDecision
    });

    const sourceIntakeDecision = decideIntakeShellAction({
      intake: { id: 'i1', file: 'u1', file_hash: hashA1, status: 'מוכן לניתוח' },
      invoicesForIntake: [{ id: 'inv7', source_intake: 'i1' }],
      duplicateCandidates: [],
      isValidFile: true
    });
    fixtures.push({
      name: 'same_intake_with_source_intake_invoice_returns_existing',
      pass: sourceIntakeDecision.action === 'reuse_existing' && sourceIntakeDecision.invoice_id === 'inv7',
      detail: sourceIntakeDecision
    });

    const freshDecision = decideIntakeShellAction({
      intake: { id: 'i9', file: 'u9', file_hash: hashB, status: 'מוכן לניתוח' },
      invoicesForIntake: [],
      duplicateCandidates: [],
      isValidFile: true
    });
    fixtures.push({
      name: 'new_valid_intake_alone_yields_create',
      pass: freshDecision.action === 'create' && freshDecision.invoice_id === null,
      detail: freshDecision
    });

    const skipDecision = decideIntakeShellAction({
      intake: { id: 'i10', status: 'דולג', status_reason: 'אין קובץ תקין לעיבוד.' },
      invoicesForIntake: [],
      duplicateCandidates: [],
      isValidFile: false
    });
    fixtures.push({ name: 'invalid_file_yields_skip_no_shell', pass: skipDecision.action === 'skip' && skipDecision.invoice_id === null, detail: skipDecision });

    return Response.json({
      success: true,
      read_only: true,
      all_passed: fixtures.every((item) => item.pass),
      passed: fixtures.filter((item) => item.pass).length,
      total: fixtures.length,
      fixtures
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});