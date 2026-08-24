import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInvoiceForAutoApproval, normalizeInvoiceNumber, INVOICE_VALIDATION_VERSION } from '../../shared/invoiceValidationGate.ts';

// Re-runs the deterministic validation gate on invoices that were already approved
// (many of them were auto-approved by the old AI-confidence rule).
// Any invoice that fails the gate is moved back to 'ממתין לאימות' with an explicit reason.
Deno.serve(async (req) => {
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const base44 = createClientFromRequest(req);

  try {
    const dryRun = body.dry_run !== false; // default: report only
    const limit = Math.min(Number(body.limit) || 500, 2000);

    const invoices = body.invoice_ids?.length
      ? (await Promise.all(body.invoice_ids.map(async (id: string) =>
          (await base44.asServiceRole.entities.Invoices.filter({ id }, undefined, 1))?.[0])))
          .filter(Boolean)
      : await base44.asServiceRole.entities.Invoices.filter({ extraction_status: 'אושר' }, '-created_date', limit);

    const suppliers = await base44.asServiceRole.entities.Suppliers.list('-created_date', 1000);
    const supplierById = new Map(suppliers.map((s: any) => [s.id, s]));
    const bySupplier = new Map<string, any[]>();
    for (const inv of invoices) {
      if (!inv.supplier) continue;
      if (!bySupplier.has(inv.supplier)) {
        bySupplier.set(inv.supplier, await base44.asServiceRole.entities.Invoices.filter({ supplier: inv.supplier }, undefined, 300));
      }
    }

    const downgraded: any[] = [];
    const kept: any[] = [];

    for (const inv of invoices) {
      const supplier = inv.supplier ? supplierById.get(inv.supplier) || null : null;
      const gate = validateInvoiceForAutoApproval({
        supplier_name: supplier?.name,
        supplier_vat_id: supplier?.vat_id,
        doc_number: inv.doc_number,
        invoice_date: inv.doc_date,
        due_date: inv.due_date,
        subtotal_before_vat: inv.subtotal_before_vat,
        vat_amount: inv.vat_amount,
        total_with_vat: inv.total_with_vat,
        doc_type_he: inv.doc_type
      }, {
        supplier,
        supplier_match_method: supplier?.vat_id ? 'vat_id' : 'name',
        duplicates: bySupplier.get(inv.supplier) || [],
        invoice_id: inv.id
      });

      const record = {
        id: inv.id,
        doc_number: inv.doc_number,
        supplier_name: supplier?.name || null,
        total_with_vat: inv.total_with_vat,
        failures: gate.failures
      };

      if (gate.passed) {
        kept.push(record);
        if (!dryRun) {
          await base44.asServiceRole.entities.Invoices.update(inv.id, {
            validation_passed: true,
            validation_failures: undefined,
            validation_warnings: gate.warnings.join(' | ') || undefined,
            validated_fields: gate.validated_fields.join(',') || undefined,
            validation_version: gate.validation_version,
            normalized_doc_number: normalizeInvoiceNumber(inv.doc_number) || undefined
          });
        }
        continue;
      }

      downgraded.push(record);
      if (!dryRun) {
        await base44.asServiceRole.entities.Invoices.update(inv.id, {
          extraction_status: 'ממתין לאימות',
          auto_approved: false,
          validation_passed: false,
          validation_failures: gate.failures.join(' | '),
          validation_warnings: gate.warnings.join(' | ') || undefined,
          validated_fields: gate.validated_fields.join(',') || undefined,
          validation_version: gate.validation_version,
          normalized_doc_number: normalizeInvoiceNumber(inv.doc_number) || undefined,
          notes: `${inv.notes || ''}\nהוחזר לאימות ידני (${INVOICE_VALIDATION_VERSION}): ${gate.failures.join(' | ')}`.trim()
        });
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      checked: invoices.length,
      still_valid: kept.length,
      needs_review: downgraded.length,
      needs_review_details: downgraded
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});