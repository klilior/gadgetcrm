import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { evaluateLinetMatch, parseLinetLines, selectLinetCandidate } from '../../shared/linetInvoiceReconciliation.ts';
import { preflightLinetLineMapping } from '../../shared/invoiceLinePersistence.ts';
import { getLineItemsCheck } from '../../shared/invoiceExtraction.ts';
import { validateInvoiceForAutoApproval } from '../../shared/invoiceValidationGate.ts';

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
      const lineCheck = testCase.extraction ? getLineItemsCheck(testCase.extraction) : null;
      // Optional: run the deterministic approval gate on a synthetic header (no DB access).
      const gate = testCase.gate_candidate
        ? validateInvoiceForAutoApproval(testCase.gate_candidate, { ...(testCase.gate_context || {}), line_check: lineCheck })
        : null;
      // Candidate selection over several synthetic purchases (no DB, no writes).
      let selection = null;
      if (Array.isArray(testCase.purchases)) {
        const evaluations = testCase.purchases.map((purchase) => ({ purchase, match: evaluateLinetMatch(testCase.invoice || {}, purchase, testCase.invoice_lines || [], testCase.supplier || null) }));
        const picked = selectLinetCandidate(evaluations, { invoiceId: testCase.invoice_id || null, reservedPurchaseIds: testCase.reserved_purchase_ids || [] });
        selection = { decision: picked.decision, reason_code: picked.reason_code, selected_purchase_id: picked.selected?.purchase?.id ?? null, candidate_ids: picked.candidates.map((c) => c.linet_purchase_document_id) };
      }
      // Line-mapping preflight (pure; zero write calls by construction).
      const lineMap = testCase.line_map
        ? (({ ok, ambiguous, reason, missing_keys, extra_keys, pairs }) => ({ ok, ambiguous, reason, missing_keys: missing_keys || [], extra_keys: extra_keys || [], pairs: pairs.length }))(preflightLinetLineMapping(testCase.line_map.local_lines || [], testCase.line_map.linet_lines || []))
        : null;

      return {
        name: testCase.name || null,
        selection,
        line_map: lineMap,
        gate: gate ? { passed: gate.passed, failures: gate.failures } : null,
        level: match.level,
        supplier_identity: match.supplier_identity || null,
        conflict_codes: match.conflict_codes || [],
        date_match: match.dateMatch ?? null,
        total_match: match.totalMatch ?? null,
        line_comparison: match.lineComparison?.details || null,
        linet_lines_parsed: parseLinetLines(testCase.purchase || {}).length,
        values: match.values,
        reason: match.reason,
        line_validation: lineCheck
      };
    });
    return Response.json({ success: true, read_only: true, results });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});