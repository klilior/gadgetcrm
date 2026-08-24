import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';
import { EXTRACT_PROMPT, EXTRACT_SCHEMA, getLineItemsCheck, normalizeExtractionDates } from '../../shared/invoiceExtraction.ts';

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

      normalizeExtractionDates(extraction);

      // Read-only supplier resolution — never creates or updates a supplier.
      const vatDigits = extraction.supplier_vat_id ? String(extraction.supplier_vat_id).replace(/\D/g, '') : '';
      let supplier = vatDigits ? suppliers.find((s: any) => (s.vat_id || '').replace(/\D/g, '') === vatDigits) || null : null;
      let matchMethod = supplier ? 'vat_id' : 'none';
      if (!supplier && invoice.supplier) {
        supplier = suppliers.find((s: any) => s.id === invoice.supplier) || null;
        if (supplier) matchMethod = supplier.vat_id ? 'vat_id' : 'name';
      }
      const duplicates = supplier
        ? await base44.asServiceRole.entities.Invoices.filter({ supplier: supplier.id }, undefined, 300)
        : [];

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
        duplicates,
        invoice_id: invoice.id,
        line_check: lineCheck
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
        line_check: lineCheck,
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