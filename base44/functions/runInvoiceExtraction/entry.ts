import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { validateInvoiceForAutoApproval, normalizeInvoiceNumber } from '../../shared/invoiceValidationGate.ts';
import { EXTRACT_PROMPT, EXTRACT_SCHEMA, roundMoney, getLineItemsCheck, normalizeExtractionDates } from '../../shared/invoiceExtraction.ts';
import { auditAndApplyAmounts } from '../../shared/invoiceMonetaryAudit.ts';
import { applyDocumentClassificationGuard } from '../../shared/invoiceDocumentClassification.ts';
import { resolveSupplier } from '../../shared/supplierResolver.ts';
import { buildInvoiceLineRecords, persistInvoiceLines, applyLinetLinesToInvoice } from '../../shared/invoiceLinePersistence.ts';
import { parseLinetLines, LINET_MATCH_RULE_VERSION } from '../../shared/linetInvoiceReconciliation.ts';
import { findBusinessDuplicate } from '../../shared/invoiceBusinessDuplicate.ts';
import { applyBusinessDuplicateToGate } from '../../shared/invoiceBusinessDuplicateOutcome.ts';
import { loadFamilyDuplicateCandidates } from '../../shared/invoiceBusinessDuplicateCandidates.ts';
import { NON_ATTEMPT_REASONS, planAttemptStart, planAttemptSuccess, planNonAttempt, planRouteFailureTarget } from '../../shared/invoiceRetryLifecycle.ts';
import { ROOT_DOCUMENT_INDEX, planMultiDocumentTargets } from '../../shared/invoiceMultiDocumentIndex.ts';
import { EVENT_TYPES, appendFailedAttemptPair, appendProcessingEvents, applyExtractionProvenance } from '../../shared/invoiceProvenance.ts';

const MULTI_INVOICE_DETECT_PROMPT = `SYSTEM / INSTRUCTION

You are a document analysis engine that detects how many separate invoices/credit notes exist in a scanned document.

INPUT
You will receive ONE document file (PDF/JPG/PNG) that may contain MULTIPLE invoices or credit notes scanned together.

GOAL
Count how many SEPARATE invoices or credit notes appear in this document.
Look for visual separations, different invoice numbers, different dates, different suppliers, page breaks between invoices.

OUTPUT SCHEMA (EXACT)
{
  "invoice_count": number,
  "invoices_detected": [
    {
      "index": number,
      "page_hint": string | null,
      "supplier_hint": string | null,
      "doc_number_hint": string | null
    }
  ],
  "is_single_invoice": boolean,
  "detection_confidence": number
}

RULES
- invoice_count: total number of separate invoices/credit notes detected
- If only 1 invoice found, is_single_invoice = true
- detection_confidence: 0-100
- For each invoice detected, provide hints about where it is and key identifiers`;

const MULTI_INVOICE_DETECT_SCHEMA = {
  type: 'object',
  properties: {
    invoice_count: { type: 'number' },
    invoices_detected: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          page_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          supplier_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          doc_number_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    },
    is_single_invoice: { type: 'boolean' },
    detection_confidence: { type: 'number' }
  },
  required: ['invoice_count', 'is_single_invoice', 'detection_confidence']
};

/**
 * Deterministic validation summary (no LLM). Approval itself is decided by the
 * shared validation gate — this only produces Hebrew review text and field checks.
 */
function buildDeterministicValidation(extraction) {
  const missing = ['supplier_name', 'doc_type_he', 'doc_number', 'invoice_date', 'total_with_vat'].filter((field) => {
    const value = extraction[field];
    return value === null || value === undefined || value === '' || value === 'null';
  });
  const lineCheck = getLineItemsCheck(extraction);
  const reviewReasons = [];
  if (missing.length) reviewReasons.push(`שדות חסרים: ${missing.join(', ')}`);
  // Use the concrete line failures so an arithmetic-only contradiction is described accurately.
  for (const failure of (lineCheck.failures || [])) reviewReasons.push(failure);
  const provenance = extraction.amount_provenance;
  if (provenance?.ambiguous) reviewReasons.push(`הסכומים אינם חד-משמעיים: ${(provenance.reasons || []).join(' | ') || 'אין תיוג מודפס ישיר.'}`);
  return {
    missing_critical_fields: missing,
    line_check: lineCheck,
    amount_provenance: provenance || null,
    review_reasons_he: reviewReasons,
    display_validation_he: reviewReasons.length ? `נדרשת בדיקה: ${reviewReasons.join('; ')}` : 'כל שדות החובה נקראו.'
  };
}

// Helper function to process a single invoice extraction
async function processSingleInvoice(base44, intake, invoice, extraction, invoiceIndex = null, context = {}) {
  if (extraction.classification === 'OTHER' || extraction.should_skip === true) {
    // Update intake as skipped
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
      status: 'דולג',
      status_reason: extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי ולכן דולג.'
    });
    // Mark the invoice as rejected
    await base44.asServiceRole.entities.Invoices.update(invoice.id, {
      extraction_status: 'נדחה',
      notes: `מסמך דולג: ${extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי'}`,
      ai_debug_last_extraction_json: JSON.stringify(extraction)
    });
    return { success: true, skipped: true, reason: 'OTHER', extraction };
  }

  // Deterministic validation only — no LLM decides status here.
  const validation = buildDeterministicValidation(extraction);

  // Supplier resolution ONLY — this route may never create, rename or update a supplier.
  const suppliers = await base44.asServiceRole.entities.Suppliers.list('-created_date', 1000);
  const supplierPatterns = await base44.asServiceRole.entities.SupplierPattern.filter({ is_active: true }, undefined, 1000);
  const resolution = resolveSupplier({
    vat_id: extraction.supplier_vat_id,
    supplier_name: extraction.supplier_name,
    supplier_name_normalized: extraction.supplier_name_normalized
  }, { suppliers, patterns: supplierPatterns });

  const supplierId = resolution.supplier_id;
  const supplierMatchMethod = resolution.method;
  if (!supplierId) {
    validation.review_reasons_he.unshift(`${resolution.reason_code}: ${resolution.reason}`);
  }

  // The deterministic gate is the ONLY thing that may approve an invoice here.
  // extraction.overall_confidence is telemetry and never part of this decision.
  const matchedSupplier = resolution.supplier;
  // D2a: candidates come from the whole canonical supplier family (redirects included),
  // so a legacy-linked historical invoice still blocks a canonical-linked new one.
  const family = supplierId ? await loadFamilyDuplicateCandidates(base44, supplierId, suppliers) : { family: null, candidates: [] };
  const duplicateCandidates = family.candidates;
  const businessDuplicate = findBusinessDuplicate({ docNumber: extraction.doc_number, invoiceId: invoice.id, candidates: duplicateCandidates });
  const gate = validateInvoiceForAutoApproval({
    supplier_name: extraction.supplier_name,
    supplier_vat_id: extraction.supplier_vat_id,
    doc_number: extraction.doc_number,
    invoice_date: extraction.invoice_date,
    due_date: extraction.due_date,
    subtotal_before_vat: extraction.subtotal_before_vat,
    vat_amount: extraction.vat_amount,
    total_with_vat: extraction.total_with_vat,
    doc_type_he: extraction.doc_type_he
  }, {
    supplier: matchedSupplier,
    supplier_match_method: supplierMatchMethod,
    supplier_resolution: resolution,
    duplicates: duplicateCandidates,
    invoice_id: invoice.id,
    line_check: validation.line_check
  });

  // Stable BUSINESS_DUPLICATE failure — manual review only, never rejection/כפילות/Linet state.
  const amountsAmbiguous = extraction.amount_provenance?.ambiguous === true;
  const duplicateOutcome = applyBusinessDuplicateToGate(gate, businessDuplicate, !amountsAmbiguous && validation.missing_critical_fields.length === 0);
  const canAutoApprove = duplicateOutcome.can_auto_approve;
  const finalStatus = duplicateOutcome.extraction_status;

  const indexNote = invoiceIndex !== null ? `[חשבונית ${invoiceIndex + 1} מתוך קובץ מרובה]\n` : '';
  const baseNotes = `${indexNote}${extraction.display_summary_he || ''}\n${validation.display_validation_he || ''}`.trim();
  const notes = canAutoApprove
    ? `${baseNotes}\nאושר אוטומטית לאחר מעבר כל בדיקות התקינות (${gate.validation_version}).`
    : `${baseNotes}\nנדרש אימות ידני: ${(gate.failures.length ? gate.failures : validation.review_reasons_he).join(' | ') || 'נדרשת בדיקה ידנית.'}`;

  // D2b2 audit trail. Read the LATEST row so a retry appends to real history instead of
  // overwriting it from a stale pre-attempt snapshot; written inside the single update below.
  const latest = (await base44.asServiceRole.entities.Invoices.filter({ id: invoice.id }, undefined, 1))?.[0] || invoice;
  const auditAt = new Date().toISOString();
  const provenance = applyExtractionProvenance({
    existingJson: latest.field_provenance_json,
    values: {
      supplier: supplierId ?? null,
      doc_number: extraction.doc_number ?? null,
      doc_date: extraction.invoice_date ?? null,
      subtotal_before_vat: roundMoney(extraction.subtotal_before_vat) ?? null,
      vat_amount: roundMoney(extraction.vat_amount) ?? null,
      total_with_vat: roundMoney(extraction.total_with_vat) ?? null
    },
    supplierName: extraction.supplier_name || null,
    reason: `gate ${gate.validation_version}`,
    at: auditAt
  });
  const history = appendProcessingEvents(latest.processing_events_json, [
    { type: EVENT_TYPES.ATTEMPT_STARTED, at: context.attemptStartedAt || auditAt, outcome: 'started', meta: { intake_id: intake.id, document_index: invoiceIndex === null ? 1 : invoiceIndex + 1 } },
    { type: EVENT_TYPES.GATE_EVALUATED, at: auditAt, outcome: gate.passed ? 'passed' : 'failed', reason: gate.failures[0] || null, meta: { version: gate.validation_version, auto_approved: canAutoApprove } },
    ...(businessDuplicate ? [{ type: EVENT_TYPES.BUSINESS_DUPLICATE, at: auditAt, outcome: 'manual_review', reason: businessDuplicate.reason || null, meta: { original_invoice_id: businessDuplicate.original_invoice_id || null } }] : []),
    { type: EVENT_TYPES.ATTEMPT_SUCCEEDED, at: auditAt, outcome: finalStatus }
  ]);

  const updatePayload = {
    // Unresolved/ambiguous identity clears the link explicitly so no stale supplier can survive.
    supplier: supplierId ?? null,
    doc_type: extraction.doc_type_he || undefined,
    doc_number: extraction.doc_number || undefined,
    normalized_doc_number: normalizeInvoiceNumber(extraction.doc_number) || undefined,
    doc_date: extraction.invoice_date || undefined,
    due_date: extraction.due_date || undefined,
    currency: extraction.currency || undefined,
    subtotal_before_vat: roundMoney(extraction.subtotal_before_vat) ?? undefined,
    vat_amount: roundMoney(extraction.vat_amount) ?? undefined,
    total_with_vat: roundMoney(extraction.total_with_vat) ?? undefined,
    confidence_score: extraction.overall_confidence ?? undefined,
    validation_passed: gate.passed,
    validation_failures: gate.failures.join(' | ') || undefined,
    validation_warnings: gate.warnings.join(' | ') || undefined,
    validated_fields: gate.validated_fields.join(',') || undefined,
    validation_version: gate.validation_version,
    auto_approved: canAutoApprove,
    extraction_status: finalStatus,
    notes: notes,
    field_provenance_json: provenance.json,
    processing_events_json: history.json,
    ai_debug_last_extraction_json: JSON.stringify(extraction),
    ai_debug_last_validation_json: JSON.stringify({ ...validation, gate, supplier_resolution: resolution })
  };

  await base44.asServiceRole.entities.Invoices.update(invoice.id, updatePayload);

  // Persist EVERY usable extracted line (service/subscription lines without SKU included) BEFORE
  // reconciliation. Upsert by invoice_id + line_number, so a retry updates instead of duplicating.
  const lineRecords = buildInvoiceLineRecords(extraction, { invoiceId: invoice.id, supplierId });
  const linePersistence = await persistInvoiceLines(base44, invoice.id, lineRecords);

  // Targeted reconciliation AFTER lines exist. matched/conflict/possible are informational —
  // a Linet match is the same transaction, never a duplicate, and never ends this flow.
  let reconciliationResult = null;
  try {
    const reconciliation = await base44.asServiceRole.functions.invoke('reconcileLinetInvoices', { invoice_ids: [invoice.id] });
    const result = reconciliation?.data || reconciliation;
    reconciliationResult = result?.stats || null;
    const invoiceResult = (result?.results || []).find((row) => row.invoice_id === invoice.id);
    if (invoiceResult?.status === 'matched') {
      const refreshed = (await base44.asServiceRole.entities.Invoices.filter({ id: invoice.id }, undefined, 1))?.[0];
      const purchase = refreshed?.linet_purchase_document_id
        ? (await base44.asServiceRole.entities.LinetPurchaseDocument.filter({ id: refreshed.linet_purchase_document_id }, undefined, 1))?.[0]
        : null;
      if (purchase) {
        await applyLinetLinesToInvoice(base44, invoice.id, parseLinetLines(purchase), { level: 'confirmed', values: { rule_version: LINET_MATCH_RULE_VERSION } });
      }
    }
  } catch (reconciliationError) {
    console.log('Linet reconciliation skipped without blocking intake:', reconciliationError.message);
  }

  return { success: true, invoice_id: invoice.id, supplier_id: supplierId, extraction_status: finalStatus, provenance_original_captured: provenance.original_captured, processing_events_count: history.events.length, business_duplicate: businessDuplicate || null, canonical_supplier_family: family.family || null, lines_persisted: linePersistence, reconciliation: reconciliationResult, extraction, validation, gate };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // The body can be read ONCE — capture intake_id in outer scope so the catch below can always
  // reach the original intake without re-reading the (already consumed) request.
  let intakeId = null;
  // D2b2: a failure event is recorded ONLY when a real AI attempt started, and only on the
  // root/linked invoice. Preflight errors (auth/body/missing/not-ready/no-link/finalized) record nothing.
  let attemptStartedAt = null;
  let rootInvoiceId = null;
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    intakeId = body.intake_id || null;
    if (!intakeId) return Response.json({ error: 'Missing intake_id' }, { status: 400 });

    const intakeList = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = intakeList?.[0];
    if (!intake) return Response.json({ error: 'Intake not found', lifecycle: planNonAttempt(NON_ATTEMPT_REASONS.INTAKE_NOT_FOUND) }, { status: 404 });

    // Guard paths below are NOT AI attempts: zero writes, zero attempt increment.
    if (!intake.file) return Response.json({ error: 'No file on intake', lifecycle: planNonAttempt(NON_ATTEMPT_REASONS.MISSING_FILE_SKIP) }, { status: 400 });
    if (intake.status !== 'מוכן לניתוח') return Response.json({ error: 'Intake not ready', lifecycle: planNonAttempt(NON_ATTEMPT_REASONS.INTAKE_NOT_READY) }, { status: 400 });
    if (!intake.linked_invoice) return Response.json({ error: 'No linked invoice', lifecycle: planNonAttempt(NON_ATTEMPT_REASONS.NO_LINKED_INVOICE) }, { status: 400 });

    // Fetch linked invoice and guard approved/rejected
    const invList = await base44.asServiceRole.entities.Invoices.filter({ id: intake.linked_invoice });
    const invoice = invList?.[0];
    if (!invoice) return Response.json({ error: 'Linked invoice not found' }, { status: 404 });
    if (invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה') {
      // Not an AI attempt: no lifecycle writes, no attempt increment.
      return Response.json({ success: true, skipped: true, reason: 'Invoice already finalized', lifecycle: planNonAttempt(NON_ATTEMPT_REASONS.FINALIZED_INVOICE) });
    }

    // D2b1: lifecycle writes come only from the shared plans; the same intake/invoice pair and
    // the original file survive every retry.
    const applyLifecycle = async (plan) => {
      if (Object.keys(plan.writes).length) await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, plan.writes);
      return plan;
    };

    // Prepares every extraction result identically: separate dates + evidence-based amounts.
    // targetScope is passed ONLY for multi-invoice files, so the monetary audit reads
    // amounts from the same invoice the extraction prompt was scoped to.
    const prepareExtraction = async (extraction, targetScope = undefined) => {
      // D3a: deterministic classification guard — receipts and generic "Invoice" titles stay OTHER.
      applyDocumentClassificationGuard(extraction);
      normalizeExtractionDates(extraction);
      await auditAndApplyAmounts(base44, extraction, intake.file, 'gpt_5_mini', targetScope);
      return extraction;
    };

    // D2b1: an actual AI extraction attempt begins here — the ONLY attempt_count increment.
    const attemptPlan = await applyLifecycle(planAttemptStart(intake));
    attemptStartedAt = attemptPlan.writes.last_attempt_at || new Date().toISOString();
    rootInvoiceId = invoice.id;

    // Step 0: Detect if multiple invoices in file
    const multiDetect = await base44.integrations.Core.InvokeLLM({
      prompt: MULTI_INVOICE_DETECT_PROMPT,
      add_context_from_internet: false,
      response_json_schema: MULTI_INVOICE_DETECT_SCHEMA,
      file_urls: [intake.file]
    });

    const invoiceCount = multiDetect?.invoice_count || 1;
    const results = [];

    if (invoiceCount > 1 && multiDetect.invoices_detected?.length > 0) {
      // Multiple invoices detected - process each one
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status_reason: `זוהו ${invoiceCount} חשבוניות בקובץ. מעבד...`
      });

      // Deterministic per-intake document index: a retry of the same intake reuses the same
      // indexed invoices instead of creating a second set of children.
      const existingForIntake = await base44.asServiceRole.entities.Invoices.filter({ source_intake: intake.id }, undefined, 200);
      const documentPlan = planMultiDocumentTargets({ intakeId: intake.id, rootInvoice: invoice, invoiceCount, existingInvoices: existingForIntake || [] });

      for (let i = 0; i < invoiceCount; i++) {
        const hint = multiDetect.invoices_detected[i];
        // Same identity/hints the extraction prompt below uses — reused for the monetary audit.
        const targetScope = {
          index: i + 1,
          supplier_hint: hint?.supplier_hint || null,
          doc_number_hint: hint?.doc_number_hint || null,
          page_hint: hint?.page_hint || null,
          text: `invoice #${i + 1} of ${invoiceCount} in this file`
        };
        
        // Create extraction prompt with specific invoice hint
        const specificPrompt = `${EXTRACT_PROMPT}

IMPORTANT: This document contains MULTIPLE invoices. 
Extract ONLY invoice #${i + 1} which is: ${hint?.supplier_hint || ''} ${hint?.doc_number_hint || ''} ${hint?.page_hint || ''}
Ignore all other invoices in the document.`;

        let extraction = await base44.integrations.Core.InvokeLLM({
          prompt: specificPrompt,
          add_context_from_internet: false,
          response_json_schema: EXTRACT_SCHEMA,
          file_urls: [intake.file]
        });

        if (extraction?.response?.classification) extraction = extraction.response;
        if (!extraction || typeof extraction !== 'object') continue;
        await prepareExtraction(extraction, targetScope);

        // Root = document index 1; every other index reuses its existing child, or is created once.
        const target = documentPlan.targets[i];
        let targetInvoice = invoice;
        if (target?.action === 'root') {
          if (target.needs_index_write) {
            await base44.asServiceRole.entities.Invoices.update(invoice.id, { source_document_index: ROOT_DOCUMENT_INDEX });
          }
        } else if (target?.action === 'reuse') {
          const reused = (await base44.asServiceRole.entities.Invoices.filter({ id: target.invoice_id }, undefined, 1))?.[0];
          if (!reused) continue;
          targetInvoice = reused;
        } else {
          targetInvoice = await base44.asServiceRole.entities.Invoices.create({
            source_intake: intake.id,
            source_document_index: target?.index ?? (i + 1),
            extraction_status: 'ממתין לאימות',
            notes: `נוצר אוטומטית - חשבונית ${i + 1} מתוך ${invoiceCount} בקובץ מרובה`
          });
        }

        const result = await processSingleInvoice(base44, intake, targetInvoice, extraction, i, { attemptStartedAt: attemptPlan.writes.last_attempt_at });
        results.push(result);
      }

      // Update intake status
      const successCount = results.filter(r => r.success && !r.skipped).length;
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'עובד',
        status_reason: `עובדו ${successCount} חשבוניות מתוך ${invoiceCount} שזוהו בקובץ`
      });

      const multiLifecycle = await applyLifecycle(planAttemptSuccess());
      return Response.json({ 
        success: true, 
        multiple_invoices: true, 
        invoice_count: invoiceCount,
        document_plan: documentPlan,
        lifecycle: multiLifecycle,
        attempt_count: attemptPlan.writes.attempt_count,
        results 
      });
    }

    // Single invoice - normal flow
    let extraction = await base44.integrations.Core.InvokeLLM({
      prompt: EXTRACT_PROMPT,
      add_context_from_internet: false,
      response_json_schema: EXTRACT_SCHEMA,
      file_urls: [intake.file]
    });

    if (extraction?.response?.classification) extraction = extraction.response;
    if (!extraction || typeof extraction !== 'object') throw new Error('Invalid extraction response');
    await prepareExtraction(extraction);

    const result = await processSingleInvoice(base44, intake, invoice, extraction, null, { attemptStartedAt: attemptPlan.writes.last_attempt_at });
    
    if (result.skipped) {
      // Intentional non-invoice classification is a COMPLETED attempt → SUCCEEDED.
      const skipLifecycle = await applyLifecycle(planAttemptSuccess());
      return Response.json({ ...result, lifecycle: skipLifecycle, attempt_count: attemptPlan.writes.attempt_count });
    }

    // Update intake status_reason
    const intakeReason = result.extraction_status === 'אושר'
      ? 'המסמך נותח ונקלט לחשבונית ואושר לפי בדיקות התקינות.'
      : `המסמך נותח אך נדרש אימות ידני: ${(result.gate?.failures?.[0]) || (result.validation?.review_reasons_he?.[0]) || 'נדרשת בדיקה ידנית.'}`;
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { status_reason: intakeReason });
    const successLifecycle = await applyLifecycle(planAttemptSuccess());

    return Response.json({ ...result, lifecycle: successLifecycle, attempt_count: attemptPlan.writes.attempt_count });
  } catch (error) {
    // Transient errors → RETRYABLE and the intake stays 'מוכן לניתוח' so a retry is possible;
    // structurally invalid responses → FAILED (still ready for manual recovery).
    const failureTarget = planRouteFailureTarget({ intakeId, error });
    // Stale-safe: read the LATEST invoice row and append to ITS history. No child shell is
    // created or updated here — the root/linked invoice carries the failure for the whole file.
    try {
      if (attemptStartedAt && rootInvoiceId) {
        const latest = (await base44.asServiceRole.entities.Invoices.filter({ id: rootInvoiceId }, undefined, 1))?.[0];
        if (latest) {
          const failedHistory = appendFailedAttemptPair(latest.processing_events_json, {
            startedAt: attemptStartedAt,
            reason: error?.message || String(error),
            meta: { intake_id: intakeId }
          });
          if (failedHistory.changed) {
            await base44.asServiceRole.entities.Invoices.update(rootInvoiceId, { processing_events_json: failedHistory.json });
          }
        }
      }
    } catch (_) {}
    try {
      if (failureTarget.can_persist) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(failureTarget.intake_id, failureTarget.writes);
      }
    } catch (_) {}
    return Response.json({ success: false, error: error?.message || String(error), lifecycle: failureTarget }, { status: 500 });
  }
});