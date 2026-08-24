import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { evaluateLinetMatch, parseLinetLines } from '../../shared/linetInvoiceReconciliation.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';

/**
 * Read-only matching harness: evaluates SYNTHETIC invoice/purchase payloads against the shared
 * deterministic matcher and line validator. It performs NO database reads and NO writes.
 * Admin-only. Used for regression fixtures of the Linet reconciliation semantics.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const cases = Array.isArray(body.cases) ? body.cases.slice(0, 20) : [];
    if (!cases.length) return Response.json({ error: 'Provide cases: [{ name, invoice, purchase, invoice_lines, supplier, extraction }]' }, { status: 400 });

    const results = cases.map((testCase) => {
      const match = evaluateLinetMatch(testCase.invoice || {}, testCase.purchase || {}, testCase.invoice_lines || [], testCase.supplier || null);
      return {
        name: testCase.name || null,
        level: match.level,
        supplier_identity: match.supplier_identity || null,
        conflict_codes: match.conflict_codes || [],
        date_match: match.dateMatch ?? null,
        total_match: match.totalMatch ?? null,
        line_comparison: match.lineComparison?.details || null,
        linet_lines_parsed: parseLinetLines(testCase.purchase || {}).length,
        values: match.values,
        reason: match.reason,
        line_validation: testCase.extraction ? getLineItemsCheck(testCase.extraction) : null
      };
    });
    return Response.json({ success: true, read_only: true, results });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});