/**
 * D2a — admin-only, strictly READ-ONLY, DB-FREE regression harness for business-duplicate
 * semantics by canonical supplier family. It uses synthetic fixtures only: no entity read,
 * no entity write, no extraction, no reconciliation, no migration.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { BUSINESS_DUPLICATE_CODE, buildCanonicalSupplierFamily, findBusinessDuplicate, isUsableInvoiceRecord } from '../../shared/invoiceBusinessDuplicate.ts';
import { FORBIDDEN_BUSINESS_DUPLICATE_WRITES, applyBusinessDuplicateToGate } from '../../shared/invoiceBusinessDuplicateOutcome.ts';

/** Pure mirror of the routes' decision, using the shared outcome helper (no DB, no writes). */
function planRoute(candidates, { invoiceId = 'inv-new', docNumber = '264002392' } = {}) {
  const gate = { passed: true, failures: [], warnings: [], validated_fields: ['supplier', 'total'], validation_version: 'test' };
  const duplicate = findBusinessDuplicate({ docNumber, invoiceId, candidates });
  const outcome = applyBusinessDuplicateToGate(gate, duplicate, true);
  return { gate, duplicate, outcome };
}

const CANONICAL_STS = '696f8b608af51a27cabb505e';
const LEGACY_STS = '69f0c0d5c65ea17859f458f7';
const OTHER_SUPPLIER = '61a0000000000000000000aa';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const suppliers = [
      { id: CANONICAL_STS, name: 'STS' },
      { id: LEGACY_STS, name: 'STS (legacy)', canonical_supplier_id: CANONICAL_STS },
      { id: OTHER_SUPPLIER, name: 'ספק אחר' }
    ];
    const family = buildCanonicalSupplierFamily(CANONICAL_STS, suppliers);
    const familyFromLegacy = buildCanonicalSupplierFamily(LEGACY_STS, suppliers);
    const otherFamily = buildCanonicalSupplierFamily(OTHER_SUPPLIER, suppliers);

    // Historical invoice recorded under the LEGACY supplier id — never migrated.
    const legacyInvoice = { id: 'inv-legacy', supplier: LEGACY_STS, doc_number: '264002392', normalized_doc_number: '264002392', extraction_status: 'אושר' };
    const rejectedShell = { id: 'inv-void', supplier: LEGACY_STS, doc_number: '264002392', extraction_status: 'נדחה' };
    const fixtures = [];

    fixtures.push({
      name: 'canonical_and_redirected_legacy_form_one_family',
      pass: family.canonical_id === CANONICAL_STS && family.family_ids.length === 2 &&
        family.family_ids.includes(CANONICAL_STS) && family.family_ids.includes(LEGACY_STS) &&
        familyFromLegacy.canonical_id === CANONICAL_STS && familyFromLegacy.family_ids.length === 2,
      detail: { family, familyFromLegacy }
    });

    const blocked = findBusinessDuplicate({ docNumber: '264002392', invoiceId: 'inv-new', candidates: [legacyInvoice] });
    fixtures.push({
      name: 'legacy_family_invoice_blocks_canonical_new_invoice',
      pass: blocked?.reason_code === BUSINESS_DUPLICATE_CODE && blocked.duplicate_invoice_id === 'inv-legacy' && blocked.normalized_number === '264002392',
      detail: blocked
    });

    fixtures.push({
      name: 'different_invoice_number_passes',
      pass: findBusinessDuplicate({ docNumber: '264002393', invoiceId: 'inv-new', candidates: [legacyInvoice] }) === null,
      detail: 'exact normalized-number equality only'
    });

    fixtures.push({
      name: 'different_canonical_family_passes',
      pass: otherFamily.canonical_id === OTHER_SUPPLIER && !otherFamily.family_ids.includes(CANONICAL_STS) &&
        findBusinessDuplicate({ docNumber: '264002392', invoiceId: 'inv-new', candidates: [] }) === null,
      detail: { otherFamily, candidates_from_other_family: [] }
    });

    fixtures.push({
      name: 'same_current_invoice_id_passes',
      pass: findBusinessDuplicate({ docNumber: '264002392', invoiceId: 'inv-legacy', candidates: [legacyInvoice] }) === null,
      detail: 'a retry of the same record is idempotent, never a duplicate'
    });

    fixtures.push({
      name: 'rejected_void_shell_passes_but_normal_history_still_blocks',
      pass: isUsableInvoiceRecord(rejectedShell) === false &&
        findBusinessDuplicate({ docNumber: '264002392', invoiceId: 'inv-new', candidates: [rejectedShell] }) === null &&
        findBusinessDuplicate({ docNumber: '264002392', invoiceId: 'inv-new', candidates: [rejectedShell, legacyInvoice] })?.duplicate_invoice_id === 'inv-legacy',
      detail: 'unusable shells are ignored without loosening historical protection'
    });

    fixtures.push({
      name: 'helper_produces_no_linet_status_or_reason',
      pass: (() => {
        const result = blocked || {};
        const serialized = JSON.stringify(result);
        return !('linet_match_status' in result) && !serialized.includes('matched_duplicate') && !serialized.toLowerCase().includes('linet');
      })(),
      detail: 'BUSINESS_DUPLICATE is never a Linet match and never matched_duplicate'
    });

    // 1. Same CURRENT supplier, same number → BUSINESS_DUPLICATE + manual review (no legacy 'duplicate').
    const currentSupplierInvoice = { id: 'inv-current', supplier: CANONICAL_STS, doc_number: '264002392', extraction_status: 'אושר' };
    const currentRoute = planRoute([currentSupplierInvoice]);
    fixtures.push({
      name: 'same_current_supplier_same_number_is_business_duplicate_manual_review',
      pass: currentRoute.outcome.reason_code === BUSINESS_DUPLICATE_CODE &&
        currentRoute.outcome.extraction_status === 'ממתין לאימות' &&
        currentRoute.outcome.auto_approved === false &&
        currentRoute.outcome.validation_passed === false &&
        currentRoute.gate.failures.some((f) => f.includes(BUSINESS_DUPLICATE_CODE)),
      detail: currentRoute.outcome
    });

    // 2. Canonical-vs-legacy STS, same number → identical outcome.
    const legacyRoute = planRoute([legacyInvoice]);
    fixtures.push({
      name: 'canonical_vs_legacy_sts_same_number_same_outcome',
      pass: JSON.stringify({ ...legacyRoute.outcome, duplicate_of: null }) === JSON.stringify({ ...currentRoute.outcome, duplicate_of: null }) &&
        legacyRoute.outcome.duplicate_of === 'inv-legacy',
      detail: legacyRoute.outcome
    });

    // 3. Route outcome writes nothing rejection/כפילות/duplicate_key/Linet-related.
    const outcomeText = JSON.stringify([currentRoute, legacyRoute]);
    fixtures.push({
      name: 'route_outcome_has_no_reject_intake_duplicate_or_linet_writes',
      pass: currentRoute.outcome.intake_status_change === null &&
        currentRoute.outcome.duplicate_key === null &&
        currentRoute.outcome.linet_state_change === null &&
        !FORBIDDEN_BUSINESS_DUPLICATE_WRITES.some((token) => currentRoute.gate.failures.join(' ').includes(token)) &&
        !outcomeText.includes('duplicate_key":"') && !outcomeText.includes('linet_match_status') &&
        !outcomeText.includes('matched_duplicate') && !outcomeText.includes('"נדחה"') && !outcomeText.includes('"כפילות"') &&
        !outcomeText.includes('"reason":"duplicate"'),
      detail: { forbidden_tokens: FORBIDDEN_BUSINESS_DUPLICATE_WRITES }
    });

    // Clean invoice still auto-approves — the block does not over-reach.
    const cleanRoute = planRoute([], { docNumber: '900000111' });
    fixtures.push({
      name: 'no_duplicate_still_auto_approves',
      pass: cleanRoute.outcome.auto_approved === true && cleanRoute.outcome.extraction_status === 'אושר' && cleanRoute.outcome.reason_code === null,
      detail: cleanRoute.outcome
    });

    const passed = fixtures.filter((f) => f.pass).length;
    return Response.json({ success: true, read_only: true, db_free: true, all_passed: passed === fixtures.length, passed, total: fixtures.length, fixtures });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});