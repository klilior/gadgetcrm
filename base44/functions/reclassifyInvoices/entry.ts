import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { classifyInvoiceLines } from '../../shared/invoiceClassification.ts';

function parseJson(value) {
  try { return value ? JSON.parse(value) : {}; } catch (_) { return {}; }
}

function lineKey(line, index) {
  return `${Number(line?.line_number || index + 1)}|${String(line?.sku || '')}|${String(line?.product_name || '')}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'מנהל') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.invoice_ids) ? body.invoice_ids.filter(Boolean) : [];
    const invoices = requestedIds.length
      ? await base44.asServiceRole.entities.Invoices.filter({ id: { $in: requestedIds } }, '-created_date', 100)
      : await base44.asServiceRole.entities.Invoices.filter({ extraction_status: 'ממתין לאימות' }, '-created_date', Math.min(Number(body.limit || 100), 100));
    const suppliers = await base44.asServiceRole.entities.Suppliers.list('name', 500);
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const results = [];

    for (const invoice of invoices) {
      const extraction = parseJson(invoice.ai_debug_last_extraction_json);
      const validation = parseJson(invoice.ai_debug_last_validation_json);
      const existingLines = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: invoice.id }, 'line_number', 500);
      const sourceLines = existingLines.length ? existingLines : (extraction.line_items || []);
      const classification = classifyInvoiceLines({ invoice, supplier: supplierMap.get(invoice.supplier) || null, lineItems: sourceLines });
      const existingMap = new Map(existingLines.map((line, index) => [lineKey(line, index), line]));
      let linesCreated = 0;
      let linesUpdated = 0;

      for (let index = 0; index < classification.lines.length; index++) {
        const line = classification.lines[index];
        const existing = existingMap.get(lineKey(line, index));
        const payload = {
          line_category: line.line_category || undefined,
          classification_source: line.classification_source,
          classification_reason: line.classification_reason
        };
        if (existing) {
          await base44.asServiceRole.entities.InvoiceLine.update(existing.id, payload);
          linesUpdated++;
        } else if (line.product_name || line.sku) {
          await base44.asServiceRole.entities.InvoiceLine.create({
            invoice_id: invoice.id,
            line_number: Number(line.line_number || index + 1),
            sku: String(line.sku || ''),
            product_name: String(line.product_name || line.description || line.sku || 'שורה ללא תיאור'),
            quantity: Number(line.quantity ?? 1),
            unit_price_before_vat: line.unit_price_before_vat ?? null,
            line_total_before_vat: line.line_total_before_vat ?? null,
            line_total_with_vat: line.line_total_with_vat ?? null,
            supplier_id: invoice.supplier || undefined,
            ...payload
          });
          linesCreated++;
        }
      }

      const hasHeader = !!(invoice.supplier && invoice.doc_number && invoice.doc_date && typeof invoice.total_with_vat === 'number');
      const missingCritical = validation.missing_critical_fields || [];
      const financiallySafe = validation.is_math_consistent !== false && missingCritical.length === 0;
      const release = invoice.extraction_status === 'ממתין לאימות' && !classification.needs_review && hasHeader && financiallySafe;
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        invoice_classification: classification.invoice_classification || undefined,
        classification_status: classification.classification_status,
        classification_reason: classification.classification_reason,
        extraction_status: release ? 'נקרא בהצלחה' : invoice.extraction_status
      });

      results.push({
        invoice_id: invoice.id,
        doc_number: invoice.doc_number || null,
        invoice_classification: classification.invoice_classification,
        classification_status: classification.classification_status,
        released: release,
        lines_created: linesCreated,
        lines_updated: linesUpdated,
        kept_for_review_reason: release ? null : classification.needs_review ? classification.classification_reason : !hasHeader ? 'חסרים נתוני כותרת' : !financiallySafe ? 'נדרש אימות נתונים כספיים/שדות קריטיים' : null
      });
    }

    return Response.json({
      success: true,
      scanned: results.length,
      released: results.filter((result) => result.released).length,
      needs_classification_review: results.filter((result) => result.classification_status === 'needs_review').length,
      results
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});