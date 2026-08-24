import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { decideIntakeShellAction, INTAKE_DUPLICATE_CODES } from '../../shared/invoiceIntakeIdentity.ts';
import { BUSINESS_DUPLICATE_CODE } from '../../shared/invoiceBusinessDuplicate.ts';
import {
  NON_ATTEMPT_REASONS,
  PROCESSING_STATUS,
  classifyExtractionFailure,
  planAttemptFailure,
  planAttemptStart,
  planAttemptSuccess,
  planNonAttempt,
  planRouteFailureTarget,
  RETRY_READY_STATUS
} from '../../shared/invoiceRetryLifecycle.ts';
import { ROOT_DOCUMENT_INDEX, planMultiDocumentTargets } from '../../shared/invoiceMultiDocumentIndex.ts';
import { SHELL_CALLERS, hasSingleAutomaticOwner, planShellOwnership } from '../../shared/invoiceShellOwnership.ts';
import { planSupplierPricePurchase } from '../../shared/supplierPriceRetry.ts';

/**
 * D2b1 regression harness — admin only, strictly READ-ONLY and DB-FREE.
 * Every fixture runs pure planning functions on synthetic input: no entity reads, no writes,
 * no live function invocations, no backfill.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const fixtures = [];
    const HASH = 'a'.repeat(64);

    // 1. Retry of an intake that is already linked → reuse, never a second shell.
    const linkedIntake = { id: 'intake-1', file: 'f.pdf', status: 'מוכן לניתוח', linked_invoice: 'inv-1', file_hash: HASH };
    const linkedRetry = decideIntakeShellAction({ intake: linkedIntake, invoicesForIntake: [], duplicateCandidates: [linkedIntake], isValidFile: true });
    fixtures.push({
      name: 'linked_intake_retry_reuses_existing_zero_create',
      pass: linkedRetry.action === 'reuse_existing' && linkedRetry.invoice_id === 'inv-1',
      detail: linkedRetry
    });

    // 2. Retry where only the invoice points back via source_intake → reuse, never create.
    const unlinkedIntake = { id: 'intake-2', file: 'f.pdf', status: 'מוכן לניתוח', file_hash: HASH };
    const sourceRetry = decideIntakeShellAction({
      intake: unlinkedIntake,
      invoicesForIntake: [{ id: 'inv-2', source_intake: 'intake-2' }],
      duplicateCandidates: [unlinkedIntake],
      isValidFile: true
    });
    fixtures.push({
      name: 'source_intake_invoice_retry_reuses_existing_zero_create',
      pass: sourceRetry.action === 'reuse_existing' && sourceRetry.invoice_id === 'inv-2',
      detail: sourceRetry
    });

    // 3. Exactly one automatic shell-creation owner; public upload never invokes a competing creator.
    const publicPlan = planShellOwnership(SHELL_CALLERS.PUBLIC_UPLOAD);
    const automationPlan = planShellOwnership(SHELL_CALLERS.AUTOMATION);
    const manualPlan = planShellOwnership(SHELL_CALLERS.MANUAL_RECOVERY);
    fixtures.push({
      name: 'public_upload_and_automation_cannot_both_own_automatic_creation',
      pass: hasSingleAutomaticOwner([SHELL_CALLERS.PUBLIC_UPLOAD, SHELL_CALLERS.AUTOMATION, SHELL_CALLERS.MANUAL_RECOVERY]) &&
        automationPlan.owns_automatic_creation === true &&
        publicPlan.owns_automatic_creation === false && publicPlan.may_create_shell === false && publicPlan.may_invoke_creator === false &&
        manualPlan.owns_automatic_creation === false && manualPlan.mode === 'manual_recovery',
      detail: { publicPlan, automationPlan, manualPlan }
    });

    // 4. Non-AI paths never increment the attempt counter.
    const nonAttemptPlans = Object.values(NON_ATTEMPT_REASONS).map((reason) => planNonAttempt(reason));
    fixtures.push({
      name: 'non_ai_preflight_skip_already_populated_attempt_delta_zero',
      pass: nonAttemptPlans.every((plan) => plan.attempt_delta === 0 && plan.is_attempt === false && Object.keys(plan.writes).length === 0),
      detail: nonAttemptPlans.map((p) => p.reason)
    });

    // 5. An actual AI attempt start increments once and marks PROCESSING.
    const first = planAttemptStart({ id: 'intake-3', attempt_count: 0 }, '2026-08-24T10:00:00.000Z');
    const second = planAttemptStart({ id: 'intake-3', attempt_count: first.writes.attempt_count }, '2026-08-24T10:05:00.000Z');
    fixtures.push({
      name: 'ai_attempt_start_delta_one_and_processing',
      pass: first.attempt_delta === 1 && first.writes.attempt_count === 1 &&
        first.writes.processing_status === PROCESSING_STATUS.PROCESSING &&
        first.writes.last_attempt_at === '2026-08-24T10:00:00.000Z' &&
        second.writes.attempt_count === 2 && !('last_error' in first.writes) &&
        !('file' in first.writes) && !('linked_invoice' in first.writes),
      detail: { first: first.writes, second: second.writes }
    });

    // 6. Success / retryable / terminal transitions.
    const success = planAttemptSuccess();
    const retryable = planAttemptFailure(new Error('429 Rate limit exceeded'));
    const pdfRetryable = planAttemptFailure(new Error('Unsupported file type: .pdf'));
    const terminal = planAttemptFailure(new Error('Invalid extraction response'));
    fixtures.push({
      name: 'success_retryable_and_terminal_transitions',
      pass: success.writes.processing_status === PROCESSING_STATUS.SUCCEEDED && success.writes.last_error === null &&
        retryable.writes.processing_status === PROCESSING_STATUS.RETRYABLE &&
        pdfRetryable.writes.processing_status === PROCESSING_STATUS.RETRYABLE &&
        terminal.writes.processing_status === PROCESSING_STATUS.FAILED &&
        classifyExtractionFailure(new Error('תגובת AI לא תקינה או ריקה')) === PROCESSING_STATUS.FAILED &&
        [success, retryable, terminal].every((plan) => plan.attempt_delta === 0) &&
        typeof retryable.writes.last_error === 'string' && retryable.writes.last_error.length > 0,
      detail: { success: success.writes, retryable: retryable.writes, pdfRetryable: pdfRetryable.writes, terminal: terminal.writes }
    });

    // 7. last_error only clears on success — never overwritten by a plain re-attempt.
    fixtures.push({
      name: 'last_error_clears_only_on_success',
      pass: !('last_error' in planAttemptStart({ attempt_count: 1 }).writes) &&
        planAttemptSuccess().writes.last_error === null &&
        planNonAttempt(NON_ATTEMPT_REASONS.ALREADY_POPULATED_GATE).writes.last_error === undefined,
      detail: 'attempt start and non-attempts leave last_error untouched'
    });

    // 8. Price side effects: same-invoice retry adds no purchase; a different invoice does.
    const priceRecord = { id: 'spp-1', purchase_count: 3, last_invoice_id: 'inv-9', last_price_before_vat: 100 };
    const sameInvoice = planSupplierPricePurchase({ oldRecord: priceRecord, invoiceId: 'inv-9' });
    const newInvoice = planSupplierPricePurchase({ oldRecord: priceRecord, invoiceId: 'inv-10' });
    const brandNew = planSupplierPricePurchase({ oldRecord: null, invoiceId: 'inv-11' });
    fixtures.push({
      name: 'same_invoice_price_retry_purchase_count_delta_zero_new_invoice_delta_one',
      pass: sameInvoice.is_same_invoice_retry === true && sameInvoice.purchase_count_delta === 0 && sameInvoice.purchase_count === 3 &&
        newInvoice.purchase_count_delta === 1 && newInvoice.purchase_count === 4 &&
        brandNew.action === 'create' && brandNew.purchase_count === 1 && brandNew.purchase_count_delta === 1,
      detail: { sameInvoice, newInvoice, brandNew }
    });

    // 9. Technical and business duplicate codes stay distinct; no Linet/matched_duplicate anywhere.
    const original = { id: 'intake-orig', file: 'f.pdf', file_hash: HASH, linked_invoice: 'inv-orig', ai_debug_last_extraction_json: '{}' };
    const dupIntake = { id: 'intake-dup', file: 'f.pdf', file_hash: HASH, status: 'מוכן לניתוח' };
    const technical = decideIntakeShellAction({ intake: dupIntake, invoicesForIntake: [], duplicateCandidates: [original, dupIntake], isValidFile: true });
    const allText = JSON.stringify({ technical, nonAttemptPlans, first, success, retryable, terminal, sameInvoice, publicPlan, automationPlan });
    fixtures.push({
      name: 'duplicate_codes_distinct_and_no_linet_matched_duplicate_state',
      pass: technical.action === 'reuse_duplicate' && technical.reason_code === INTAKE_DUPLICATE_CODES.FILE_DUPLICATE &&
        technical.reason_code !== BUSINESS_DUPLICATE_CODE &&
        !allText.includes('matched_duplicate') && !allText.includes('linet') && !allText.includes('LINET'),
      detail: { technical_reason_code: technical.reason_code, business_code: BUSINESS_DUPLICATE_CODE }
    });

    // 10. Consumed-body-safe failure target keeps the ORIGINAL intake_id and stays retry-ready.
    const transientTarget = planRouteFailureTarget({ intakeId: 'intake-7', error: new Error('502 upstream timeout') });
    const terminalTarget = planRouteFailureTarget({ intakeId: 'intake-7', error: new Error('Invalid extraction response') });
    const noIdTarget = planRouteFailureTarget({ intakeId: null, error: new Error('boom') });
    fixtures.push({
      name: 'route_failure_target_retains_original_intake_id',
      pass: transientTarget.intake_id === 'intake-7' && transientTarget.can_persist === true &&
        terminalTarget.intake_id === 'intake-7' && noIdTarget.can_persist === false && noIdTarget.intake_id === null,
      detail: { transientTarget, noIdTarget }
    });
    fixtures.push({
      name: 'transient_route_failure_stays_ready_and_retryable',
      pass: transientTarget.writes.status === RETRY_READY_STATUS && RETRY_READY_STATUS === 'מוכן לניתוח' &&
        transientTarget.writes.processing_status === PROCESSING_STATUS.RETRYABLE &&
        transientTarget.writes.status !== 'דולג' && transientTarget.attempt_delta === 0 &&
        terminalTarget.writes.status === RETRY_READY_STATUS && terminalTarget.writes.processing_status === PROCESSING_STATUS.FAILED,
      detail: { transient: transientTarget.writes, terminal: terminalTarget.writes }
    });

    // 11. First run of a 3-document intake: root + two creates.
    const root = { id: 'inv-root', source_intake: 'intake-8' };
    const firstRun = planMultiDocumentTargets({ intakeId: 'intake-8', rootInvoice: root, invoiceCount: 3, existingInvoices: [root] });
    fixtures.push({
      name: 'first_run_three_documents_root_plus_two_creates',
      pass: firstRun.creates === 2 && firstRun.reuses === 0 &&
        firstRun.targets[0].action === 'root' && firstRun.targets[0].invoice_id === 'inv-root' &&
        firstRun.targets[0].needs_index_write === true && firstRun.targets[0].index === ROOT_DOCUMENT_INDEX &&
        firstRun.targets[1].action === 'create' && firstRun.targets[2].action === 'create',
      detail: firstRun.targets
    });

    // 12. Retry of the same intake/count: three reuses of the same ids, zero creates.
    const indexedRoot = { id: 'inv-root', source_intake: 'intake-8', source_document_index: 1 };
    const retryRun = planMultiDocumentTargets({
      intakeId: 'intake-8',
      rootInvoice: indexedRoot,
      invoiceCount: 3,
      existingInvoices: [indexedRoot, { id: 'inv-c2', source_intake: 'intake-8', source_document_index: 2 }, { id: 'inv-c3', source_intake: 'intake-8', source_document_index: 3 }]
    });
    fixtures.push({
      name: 'retry_three_documents_zero_creates_same_invoice_ids',
      pass: retryRun.creates === 0 && retryRun.reuses === 2 &&
        retryRun.targets[0].action === 'root' && retryRun.targets[0].needs_index_write === false &&
        retryRun.targets[1].invoice_id === 'inv-c2' && retryRun.targets[2].invoice_id === 'inv-c3',
      detail: retryRun.targets
    });

    // 13. Duplicate index rows and index-less rows can never be reused twice / at all.
    const messy = planMultiDocumentTargets({
      intakeId: 'intake-9',
      rootInvoice: { id: 'inv-r9', source_intake: 'intake-9', source_document_index: 1 },
      invoiceCount: 3,
      existingInvoices: [
        { id: 'inv-dup-a', source_intake: 'intake-9', source_document_index: 2 },
        { id: 'inv-dup-b', source_intake: 'intake-9', source_document_index: 2 },
        { id: 'inv-noidx', source_intake: 'intake-9' },
        { id: 'inv-other', source_intake: 'intake-OTHER', source_document_index: 3 }
      ]
    });
    fixtures.push({
      name: 'duplicate_or_missing_index_candidates_never_reused_twice',
      pass: messy.targets[1].action === 'reuse' && messy.targets[1].invoice_id === 'inv-dup-a' &&
        messy.targets[2].action === 'create' &&
        messy.reused_invoice_ids.length === new Set(messy.reused_invoice_ids).size &&
        !messy.reused_invoice_ids.includes('inv-dup-b') && !messy.reused_invoice_ids.includes('inv-noidx') &&
        !messy.reused_invoice_ids.includes('inv-other'),
      detail: messy
    });

    // 14. Missing-file / not-ready / no-linked guards: attempt delta 0, no writes.
    const guardPlans = [NON_ATTEMPT_REASONS.MISSING_FILE_SKIP, NON_ATTEMPT_REASONS.INTAKE_NOT_READY, NON_ATTEMPT_REASONS.NO_LINKED_INVOICE, NON_ATTEMPT_REASONS.INTAKE_NOT_FOUND].map((r) => planNonAttempt(r));
    fixtures.push({
      name: 'missing_file_not_ready_no_linked_attempt_delta_zero',
      pass: guardPlans.every((plan) => plan.attempt_delta === 0 && plan.is_attempt === false && Object.keys(plan.writes).length === 0) &&
        guardPlans.map((p) => p.reason).join(',') === 'MISSING_FILE_SKIP,INTAKE_NOT_READY,NO_LINKED_INVOICE,INTAKE_NOT_FOUND',
      detail: guardPlans.map((p) => p.reason)
    });

    const passed = fixtures.filter((f) => f.pass).length;
    return Response.json({ success: true, read_only: true, db_free: true, all_passed: passed === fixtures.length, passed, total: fixtures.length, fixtures });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});