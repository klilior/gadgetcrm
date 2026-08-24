/**
 * D2a — admin-only, strictly READ-ONLY, DB-FREE regression harness for business-duplicate
 * semantics by canonical supplier family. It uses synthetic fixtures only: no entity read,
 * no entity write, no extraction, no reconciliation, no migration.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { BUSINESS_DUPLICATE_CODE, buildCanonicalSupplierFamily, findBusinessDuplicate, isUsableInvoiceRecord } from '../../shared/invoiceBusinessDuplicate.ts';

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

    const passed = fixtures.filter((f) => f.pass).length;
    return Response.json({ success: true, read_only: true, db_free: true, all_passed: passed === fixtures.length, passed, total: fixtures.length, fixtures });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});