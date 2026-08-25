import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';
import { EXTRACT_PROMPT, EXTRACT_SCHEMA, getLineItemsCheck, normalizeExtractionDates } from '../../shared/invoiceExtraction.ts';
import { auditAndApplyAmounts } from '../../shared/invoiceMonetaryAudit.ts';
import { applyDocumentClassificationGuard } from '../../shared/invoiceDocumentClassification.ts';
import { applyClassificationRecovery } from '../../shared/invoiceClassificationRecovery.ts';
import { resolveSupplier } from '../../shared/supplierResolver.ts';
import { recoverCriticalFields } from '../../shared/invoiceCriticalFieldRecovery.ts';
import { matchSupplierProfile, summarizeProfileMatch, validateProfileDocNumber, normalizeProfileReference } from '../../shared/invoiceSupplierProfiles.ts';
import { applyRecoveryOutcomesToGate, runLinetAssistedRecovery } from '../../shared/linetAssistedRecovery.ts';

/**
 * SAFE, STRICTLY READ-ONLY regression harness (admins only).
 * Re-extracts the given invoice_ids and runs the deterministic gate WITHOUT writing anything:
 * no Invoices / InvoiceIntakeRaw / InvoiceLine / Suppliers / SupplierPattern /
 * SupplierProductPrice / Linet record is created, updated or deleted.
 * Requires dry_run: true. There is no write/force mode.
 */
const MAX_IDS = 32;

Deno.serve(async (req) => {
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const base44 = createClientFromRequest(req);

  try {
    // Auth: this endpoint reads invoice + intake data, so it is never public.
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admins only' }, { status: 403 });

    if (body.dry_run !== true) {
      return Response.json({ error: 'dry_run: true is required. This endpoint is read-only.' }, { status: 400 });
    }
    const ids: string[] = Array.isArray(body.invoice_ids)
      ? body.invoice_ids.filter((v: any) => typeof v === 'string' && v.trim())
      : [];
    if (!ids.length) return Response.json({ error: 'Missing invoice_ids' }, { status: 400 });
    if (ids.length > MAX_IDS) return Response.json({ error: `Too many invoice_ids (max ${MAX_IDS}).` }, { status: 400 });

    const suppliers = await base44.asServiceRole.entities.Suppliers.list('-created_date', 1000);
    const patterns = await base44.asServiceRole.entities.SupplierPattern.filter({ is_active: true }, undefined, 1000);
    const results: any[] = [];

    for (const id of ids) {
      const invoice = (await base44.asServiceRole.entities.Invoices.filter({ id }, undefined, 1))?.[0];
      if (!invoice) { results.push({ invoice_id: id, error: 'Invoice not found' }); continue; }
      if (!invoice.source_intake) { results.push({ invoice_id: id, error: 'No source intake' }); continue; }

      const intake = (await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: invoice.source_intake }, undefined, 1))?.[0];
      if (!intake?.file) { results.push({ invoice_id: id, error: 'No file on intake' }); continue; }

      let extraction: any = null;
      let extractionError: string | null = null;
      try {
        extraction = await base44.integrations.Core.InvokeLLM({
          prompt: EXTRACT_PROMPT,
          add_context_from_internet: false,
          response_json_schema: EXTRACT_SCHEMA,
          file_urls: [intake.file],
          model: 'gpt_5_mini'
        });
        if (extraction?.response?.classification) extraction = extraction.response;
      } catch (err) {
        extractionError = err?.message || String(err);
      }

      if (!extraction || typeof extraction !== 'object') {
        results.push({ invoice_id: id, stored_doc_number: invoice.doc_number, error: extractionError || 'Invalid extraction response' });
        continue;
      }

      applyDocumentClassificationGuard(extraction);
      normalizeExtractionDates(extraction);

      // Second pass: evidence-based monetary audit against the ORIGINAL file.
      // Stored invoice amounts are never fed into extraction or selection.
      await auditAndApplyAmounts(base44, extraction, intake.file);

      // P1-A: fail-closed critical-field recovery, evaluated BEFORE supplier resolution and the
      // gate. Read-only: only the in-memory extraction object is touched.
      // P1-B: initial curated profile from first-pass identity + intake sender metadata.
      const initialProfile = matchSupplierProfile({
        vat_id: extraction.supplier_vat_id,
        supplier_name: extraction.supplier_name,
        supplier_name_normalized: extraction.supplier_name_normalized,
        sender_email: intake.gmail_from || null,
        sender_domain: intake.gmail_from || null
      }, { suppliers });
      const initialProfileDocCheck = validateProfileDocNumber(initialProfile, extraction.doc_number);
      // P1-E: same deterministic classification recovery as production — after the monetary audit
      // and the initial profile match, BEFORE P1-A. In-memory only, nothing persisted.
      const classificationRecovery = applyClassificationRecovery(extraction, { profile_match: initialProfile });
      const recovery = await recoverCriticalFields(base44, extraction, intake.file, {
        profile_match: initialProfile.reliable_for_auto_approval ? initialProfile : null
      });

      // P1-B: re-evaluate with the post-recovery identity evidence, then feed the reliable match
      // into the shared deterministic resolver as an audited method. Read-only throughout.
      const finalProfile = matchSupplierProfile({
        vat_id: extraction.supplier_vat_id,
        supplier_name: extraction.supplier_name,
        supplier_name_normalized: extraction.supplier_name_normalized,
        sender_email: intake.gmail_from || null,
        sender_domain: intake.gmail_from || null
      }, { suppliers });
      const resolution = resolveSupplier({
        vat_id: extraction.supplier_vat_id,
        supplier_name: extraction.supplier_name,
        supplier_name_normalized: extraction.supplier_name_normalized
      }, { suppliers, patterns, profile_match: finalProfile });
      const supplier = resolution.supplier;
      const matchMethod = resolution.method;
      const duplicates = supplier
        ? await base44.asServiceRole.entities.Invoices.filter({ supplier: supplier.id }, undefined, 300)
        : [];

      // P1-C: same deterministic Linet-assisted recovery as production. Read-only — it only reads
      // existing LinetPurchaseDocument rows and mutates the in-memory extraction object.
      const linetAssisted = await runLinetAssistedRecovery(base44, extraction, {
        profile_match: finalProfile,
        supplier: resolution.supplier,
        supplier_resolution: resolution,
        // Same options shape as production: without the P1-A merge, a repeated identical
        // profile-invalid reading could not be recognised as clear conflicting evidence.
        recovery_merge: recovery.merge,
        invoice_id: invoice.id
      });

      const lineCheck = getLineItemsCheck(extraction);
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
        supplier,
        supplier_match_method: matchMethod,
        supplier_resolution: resolution,
        duplicates,
        invoice_id: invoice.id,
        line_check: lineCheck
      });

      // Production parity: the SAME shared helper folds P1-A, P1-C and the P1-B reference guard
      // into the gate (in-memory only, nothing persisted).
      const finalDocCheck = validateProfileDocNumber(finalProfile, extraction.doc_number);
      const recoveryOutcomes = applyRecoveryOutcomesToGate(gate, {
        merge: recovery.merge,
        decision: linetAssisted.decision,
        profile_doc_check: finalDocCheck
      });

      results.push({
        invoice_id: invoice.id,
        stored_doc_number: invoice.doc_number,
        stored_total_with_vat: invoice.total_with_vat,
        extracted: {
          supplier_name: extraction.supplier_name ?? null,
          supplier_vat_id: extraction.supplier_vat_id ?? null,
          doc_number: extraction.doc_number ?? null,
          doc_type_he: extraction.doc_type_he ?? null,
          invoice_date: extraction.invoice_date ?? null,
          due_date: extraction.due_date ?? null,
          subtotal_before_vat: extraction.subtotal_before_vat ?? null,
          vat_amount: extraction.vat_amount ?? null,
          total_with_vat: extraction.total_with_vat ?? null,
          currency: extraction.currency ?? null
        },
        amount_provenance: extraction.amount_provenance ? {
          audit_version: extraction.amount_provenance.audit_version,
          document_kind: extraction.amount_provenance.document_kind,
          ambiguous: extraction.amount_provenance.ambiguous,
          total_evidence_label: extraction.amount_provenance.total_evidence_label,
          total_evidence_role: extraction.amount_provenance.total_evidence_role,
          subtotal_evidence_label: extraction.amount_provenance.subtotal_evidence_label,
          vat_evidence_label: extraction.amount_provenance.vat_evidence_label,
          reasons: extraction.amount_provenance.reasons,
          candidates_count: (extraction.amount_provenance.candidates || []).length,
          charge_candidates: (extraction.amount_provenance.candidates || [])
            .filter((c: any) => ['document_payable', 'document_subtotal', 'document_vat', 'fee_or_commission'].includes(c.role))
            .slice(0, 12)
        } : null,
        critical_field_recovery: {
          needed: recovery.plan.needed,
          attempted: recovery.attempted,
          requested_fields: recovery.plan.request_fields,
          plan_reasons_he: recovery.plan.reasons_he,
          applied_fields: recovery.merge?.applied_fields || [],
          unresolved_fields: recovery.merge?.unresolved_fields || [],
          conflict_fields: recovery.merge?.conflict_fields || [],
          requires_manual_review: recovery.merge?.requires_manual_review === true,
          outcome: recovery.merge?.outcome || null,
          review_reasons_he: recovery.merge?.review_reasons_he || [],
          error: recovery.error || null,
          decisions: recovery.merge?.decisions || []
        },
        linet_assisted_recovery: {
          plan: {
            needed: linetAssisted.plan.needed,
            eligible: linetAssisted.plan.eligible,
            target_fields: linetAssisted.plan.target_fields,
            optional_fields: linetAssisted.plan.optional_fields,
            clear: linetAssisted.plan.clear,
            identity: linetAssisted.plan.identity,
            reason_code: linetAssisted.plan.reason_code,
            reason: linetAssisted.plan.reason
          },
          candidates_read: linetAssisted.purchases_count,
          outcome: linetAssisted.decision.outcome,
          reason_code: linetAssisted.decision.reason_code,
          reason: linetAssisted.decision.reason,
          applied: linetAssisted.decision.applied,
          applied_fields: linetAssisted.decision.applied_fields,
          applied_supplier_id: linetAssisted.decision.applied_supplier_id,
          selected: linetAssisted.decision.selected,
          runner_up_score: linetAssisted.decision.runner_up_score,
          margin: linetAssisted.decision.margin,
          post_fill: linetAssisted.decision.post_fill,
          satisfies_profile_doc_guard: linetAssisted.decision.satisfies_profile_doc_guard,
          requires_manual_review: linetAssisted.decision.requires_manual_review,
          review_reasons_he: linetAssisted.decision.review_reasons_he,
          top_candidates: (linetAssisted.decision.candidates || []).slice(0, 8),
          error: linetAssisted.error || null
        },
        remaining_recovery_failures: recoveryOutcomes.remaining,
        profile_doc_guard_kept: recoveryOutcomes.profile_guard_kept,
        supplier_profile: {
          initial: summarizeProfileMatch(initialProfile),
          final: summarizeProfileMatch(finalProfile),
          initial_doc_number_check: initialProfileDocCheck,
          final_doc_number_check: finalDocCheck,
          contextual_reference: normalizeProfileReference(finalProfile, extraction.doc_number)
        },
        // The exact header candidate the deterministic gate evaluated below.
        gate_candidate: {
          supplier_name: extraction.supplier_name ?? null,
          supplier_vat_id: extraction.supplier_vat_id ?? null,
          doc_number: extraction.doc_number ?? null,
          invoice_date: extraction.invoice_date ?? null,
          total_with_vat: extraction.total_with_vat ?? null
        },
        line_check: lineCheck,
        classification_guard: extraction.classification_guard || null,
        classification_recovery: classificationRecovery,
        line_applicability: lineCheck.line_applicability || null,
        supplier_resolution: {
          supplier_id: resolution.supplier_id,
          supplier_name: resolution.supplier?.name ?? null,
          method: resolution.method,
          evidence_strength: resolution.evidence_strength,
          reliable_for_auto_approval: resolution.reliable_for_auto_approval,
          reason_code: resolution.reason_code,
          reason: resolution.reason,
          candidate_ids: resolution.candidate_ids,
          redirected_from: resolution.redirected_from
        },
        gate: {
          passed: gate.passed,
          failures: gate.failures,
          warnings: gate.warnings,
          validated_fields: gate.validated_fields,
          validation_version: gate.validation_version
        },
        confidence_telemetry: {
          overall_confidence: extraction.overall_confidence ?? null,
          field_confidence: extraction.field_confidence ?? null
        }
      });
    }

    return Response.json({ success: true, dry_run: true, read_only: true, checked: results.length, results });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});