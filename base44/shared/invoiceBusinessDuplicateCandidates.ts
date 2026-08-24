/**
 * D2a candidate loading for business duplicates: one bounded query per supplier id in the
 * canonical family, results deduplicated by invoice id. No mutation, no migration.
 */

import { buildCanonicalSupplierFamily } from './invoiceBusinessDuplicate.ts';

const PER_SUPPLIER_LIMIT = 200;

export async function loadFamilyDuplicateCandidates(base44, supplierId, suppliers) {
  const family = buildCanonicalSupplierFamily(supplierId, suppliers);
  if (!family.family_ids.length) return { family, candidates: [] };
  const byId = new Map();
  for (const id of family.family_ids) {
    const rows = await base44.asServiceRole.entities.Invoices.filter({ supplier: id }, undefined, PER_SUPPLIER_LIMIT);
    for (const row of rows || []) if (row?.id) byId.set(row.id, row);
  }
  return { family, candidates: [...byId.values()] };
}