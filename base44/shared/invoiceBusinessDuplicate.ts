/**
 * D2a — business-duplicate semantics by canonical supplier family. Pure, DB-free.
 *
 * A BUSINESS duplicate is: the SAME normalized invoice number inside the SAME canonical
 * supplier identity family. It is a different thing from:
 *   - D1 technical duplicates (FILE_DUPLICATE / GMAIL_*_DUPLICATE — same bytes / same Gmail item),
 *   - Linet reconciliation (a matched purchase document is the SAME transaction, never a duplicate).
 * This module NEVER produces a linet_match_status, matched_duplicate, or any Linet reason.
 *
 * A family = the canonical supplier id plus every Suppliers row whose canonical_supplier_id
 * redirects to it. Historical invoice.supplier references are NOT migrated; the family is
 * resolved at read time so a legacy-linked invoice still blocks a canonical-linked one.
 */

import { normalizeInvoiceNumber } from './invoiceValidationGate.ts';

export const BUSINESS_DUPLICATE_CODE = 'BUSINESS_DUPLICATE';

const MAX_REDIRECT_HOPS = 10;

/** Defensive redirect resolution: follows canonical_supplier_id, cycle- and depth-safe. */
export function resolveCanonicalSupplierId(supplierId, suppliers) {
  const byId = new Map((suppliers || []).filter((s) => s?.id).map((s) => [s.id, s]));
  let current = supplierId || null;
  const seen = new Set();
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    if (!current || seen.has(current)) break;
    seen.add(current);
    const next = byId.get(current)?.canonical_supplier_id;
    if (!next || next === current || !byId.has(next)) break;
    current = next;
  }
  return current || null;
}

/**
 * All supplier ids that share one identity. The canonical id itself is always included,
 * as is the requested id even when its record is missing.
 */
export function buildCanonicalSupplierFamily(supplierId, suppliers) {
  const canonicalId = resolveCanonicalSupplierId(supplierId, suppliers);
  const ids = new Set();
  if (supplierId) ids.add(supplierId);
  if (canonicalId) ids.add(canonicalId);
  for (const supplier of suppliers || []) {
    if (supplier?.id && canonicalId && resolveCanonicalSupplierId(supplier.id, suppliers) === canonicalId) ids.add(supplier.id);
  }
  return { canonical_id: canonicalId, family_ids: [...ids] };
}

/** An unusable shell (rejected/void) must not block, but every normal historical invoice does. */
export function isUsableInvoiceRecord(invoice) {
  const status = String(invoice?.extraction_status || '').trim();
  return !!invoice?.id && status !== 'נדחה' && status !== 'בוטל';
}

/** Same-id retries are idempotent, never duplicates. Exact normalized-number equality only. */
export function findBusinessDuplicate({ docNumber, invoiceId, candidates }) {
  const normalized = normalizeInvoiceNumber(docNumber);
  if (!normalized) return null;
  const hit = (candidates || []).find((invoice) => {
    if (!invoice || invoice.id === invoiceId) return false;
    if (!isUsableInvoiceRecord(invoice)) return false;
    return normalizeInvoiceNumber(invoice.normalized_doc_number || invoice.doc_number) === normalized;
  });
  if (!hit) return null;
  return {
    reason_code: BUSINESS_DUPLICATE_CODE,
    duplicate_invoice_id: hit.id,
    normalized_number: normalized,
    failure_he: `${BUSINESS_DUPLICATE_CODE}: חשבונית ${String(docNumber || '').trim()} כבר קיימת עבור אותו ספק קנוני (מזהה: ${hit.id}). נדרש אימות ידני.`
  };
}