import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function isNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}

async function listAll(entity, sort = '-created_date') {
  const records = [];
  let skip = 0;
  const limit = 1000;

  while (true) {
    const batch = await entity.list(sort, limit, skip);
    records.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return records;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const fromDate = body.from_date || null;
    const toDate = body.to_date || null;
    const tolerance = isNumber(body.tolerance) ? body.tolerance : 1;

    const [allInvoices, allLines] = await Promise.all([
      listAll(base44.asServiceRole.entities.Invoices, '-doc_date'),
      listAll(base44.asServiceRole.entities.InvoiceLine, 'invoice_id'),
    ]);

    const invoices = allInvoices.filter((invoice) => {
      if (invoice.extraction_status === 'נדחה') return false;
      if (fromDate && invoice.doc_date && invoice.doc_date < fromDate) return false;
      if (toDate && invoice.doc_date && invoice.doc_date > toDate) return false;
      return true;
    });

    const linesByInvoice = new Map();
    for (const line of allLines) {
      if (!line.invoice_id) continue;
      if (!linesByInvoice.has(line.invoice_id)) linesByInvoice.set(line.invoice_id, []);
      linesByInvoice.get(line.invoice_id).push(line);
    }

    const missingFinancialFields = [];
    const mathMismatches = [];
    const lineMismatches = [];

    for (const invoice of invoices) {
      const hasTotal = isNumber(invoice.total_with_vat);
      const hasSubtotal = isNumber(invoice.subtotal_before_vat);
      const hasVat = isNumber(invoice.vat_amount);

      if (!hasTotal || !hasSubtotal || !hasVat) {
        missingFinancialFields.push({
          id: invoice.id,
          doc_number: invoice.doc_number || null,
          doc_date: invoice.doc_date || null,
          status: invoice.extraction_status || null,
          subtotal_before_vat: invoice.subtotal_before_vat ?? null,
          vat_amount: invoice.vat_amount ?? null,
          total_with_vat: invoice.total_with_vat ?? null,
        });
        continue;
      }

      const mathDelta = roundMoney((invoice.subtotal_before_vat + invoice.vat_amount) - invoice.total_with_vat);
      if (Math.abs(mathDelta) > tolerance) {
        mathMismatches.push({
          id: invoice.id,
          doc_number: invoice.doc_number || null,
          doc_date: invoice.doc_date || null,
          status: invoice.extraction_status || null,
          subtotal_before_vat: invoice.subtotal_before_vat,
          vat_amount: invoice.vat_amount,
          total_with_vat: invoice.total_with_vat,
          delta: mathDelta,
        });
      }

      const invoiceLines = linesByInvoice.get(invoice.id) || [];
      if (invoiceLines.length > 0) {
        const linesSubtotal = roundMoney(invoiceLines.reduce((sum, line) => sum + (isNumber(line.line_total_before_vat) ? line.line_total_before_vat : 0), 0));
        const lineDelta = roundMoney(linesSubtotal - invoice.subtotal_before_vat);
        if (Math.abs(lineDelta) > tolerance) {
          lineMismatches.push({
            id: invoice.id,
            doc_number: invoice.doc_number || null,
            doc_date: invoice.doc_date || null,
            lines_count: invoiceLines.length,
            lines_subtotal_before_vat: linesSubtotal,
            invoice_subtotal_before_vat: invoice.subtotal_before_vat,
            delta: lineDelta,
          });
        }
      }
    }

    const markedForReview = [];
    if (body.mark_for_review === true) {
      const reviewMap = new Map();
      for (const item of missingFinancialFields) reviewMap.set(item.id, `נדרש אימות מספרי: חסרים שדות כספיים (${item.doc_number || 'ללא מספר מסמך'}).`);
      for (const item of mathMismatches) reviewMap.set(item.id, `נדרש אימות מספרי: סכום לפני מע״מ + מע״מ אינו תואם לסה״כ (הפרש ${item.delta} ש״ח).`);

      for (const [invoiceId, reason] of reviewMap.entries()) {
        await base44.asServiceRole.entities.Invoices.update(invoiceId, {
          extraction_status: 'ממתין לאימות',
          notes: reason,
        });
        markedForReview.push({ id: invoiceId, reason });
      }
    }

    return Response.json({
      success: true,
      period: { from: fromDate, to: toDate },
      tolerance,
      checked_invoices: invoices.length,
      checked_lines: allLines.length,
      missing_financial_fields: {
        count: missingFinancialFields.length,
        sample: missingFinancialFields.slice(0, 30),
      },
      math_mismatches: {
        count: mathMismatches.length,
        sample: mathMismatches.slice(0, 30),
      },
      line_mismatches: {
        count: lineMismatches.length,
        sample: lineMismatches.slice(0, 30),
      },
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});