/**
 * D2b1 — deterministic per-intake document index for multi-invoice files.
 *
 * Pure and DB-free: decides, per detected document position, whether the route should use the
 * root (linked) invoice, reuse an already-created indexed child, or create a new child.
 *
 * Rules:
 *  - the linked/root invoice is always index 1;
 *  - every index > 1 reuses the existing Invoice with the same source_intake + source_document_index;
 *  - a create happens ONLY when that indexed child does not exist;
 *  - no indexed child may be reused twice within one batch (duplicate index rows are ignored
 *    after the first, records without an index are never reusable).
 */

export const ROOT_DOCUMENT_INDEX = 1;

function indexOf(invoice) {
  const value = Number(invoice?.source_document_index);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

export function planMultiDocumentTargets({ intakeId, rootInvoice, invoiceCount, existingInvoices = [] }) {
  const total = Math.max(1, Number(invoiceCount) || 1);
  const rootId = rootInvoice?.id || null;

  // Reusable pool: children of THIS intake carrying a usable index, root excluded, first row per index wins.
  const pool = new Map();
  for (const candidate of existingInvoices) {
    if (!candidate?.id || candidate.id === rootId) continue;
    if (intakeId && candidate.source_intake && candidate.source_intake !== intakeId) continue;
    const idx = indexOf(candidate);
    if (idx === null || idx === ROOT_DOCUMENT_INDEX) continue;
    if (!pool.has(idx)) pool.set(idx, candidate);
  }

  const consumed = new Set();
  const targets = [];
  for (let index = ROOT_DOCUMENT_INDEX; index <= total; index++) {
    if (index === ROOT_DOCUMENT_INDEX) {
      targets.push({
        index,
        action: 'root',
        invoice_id: rootId,
        // Persist the index the first time the root is identified as document 1.
        needs_index_write: indexOf(rootInvoice) !== ROOT_DOCUMENT_INDEX
      });
      continue;
    }
    const candidate = pool.get(index);
    if (candidate && !consumed.has(candidate.id)) {
      consumed.add(candidate.id);
      targets.push({ index, action: 'reuse', invoice_id: candidate.id, needs_index_write: false });
    } else {
      targets.push({ index, action: 'create', invoice_id: null, needs_index_write: true });
    }
  }

  return {
    intake_id: intakeId || null,
    document_count: total,
    targets,
    creates: targets.filter((t) => t.action === 'create').length,
    reuses: targets.filter((t) => t.action === 'reuse').length,
    reused_invoice_ids: [...consumed]
  };
}