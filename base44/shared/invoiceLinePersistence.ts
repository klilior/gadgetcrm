/**
 * Shared InvoiceLine persistence (Task C).
 *
 * Both extraction routes MUST store every usable extracted line BEFORE any Linet
 * reconciliation can influence the flow. Upsert key is invoice_id + line_number so a
 * retry updates instead of duplicating; historical lines are never deleted.
 */
import { roundMoney } from './invoiceExtraction.ts';
import { normalizedText, numberValue } from './linetInvoiceReconciliation.ts';

/** Build line records from an extraction payload. Service/subscription lines without SKU are kept. */
export function buildInvoiceLineRecords(extraction, { invoiceId, supplierId = null, classifiedByLineNumber = null } = {}) {
  const items = extraction?.line_items || [];
  const used = new Set();
  const records = [];
  let seq = 0;
  for (const item of items) {
    if (!item || (!item.sku && !item.product_name)) continue;
    seq += 1;
    let lineNumber = Number(item.line_number);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0 || used.has(lineNumber)) lineNumber = seq;
    while (used.has(lineNumber)) lineNumber += 1;
    used.add(lineNumber);
    const classified = classifiedByLineNumber?.get(Number(item.line_number || lineNumber)) || classifiedByLineNumber?.get(lineNumber);
    records.push({
      invoice_id: invoiceId,
      line_number: lineNumber,
      sku: item.sku || '',
      product_name: item.product_name || item.sku,
      quantity: item.quantity ?? 1,
      unit_price_before_vat: roundMoney(item.unit_price_before_vat) ?? null,
      line_total_before_vat: roundMoney(item.line_total_before_vat) ?? null,
      line_total_with_vat: roundMoney(item.line_total_with_vat) ?? null,
      supplier_id: supplierId || undefined,
      line_category: classified?.line_category || undefined,
      classification_source: classified?.classification_source || 'keywords',
      classification_reason: classified?.classification_reason || '',
      data_source: 'extracted'
    });
  }
  return records;
}

/** Upsert lines by invoice_id + line_number. Returns { created, updated, line_numbers }. */
export async function persistInvoiceLines(base44, invoiceId, records) {
  if (!invoiceId || !records?.length) return { created: 0, updated: 0, line_numbers: [] };
  const existing = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: invoiceId }, undefined, 500);
  const byNumber = new Map(existing.map((line) => [Number(line.line_number), line]));
  let created = 0;
  let updated = 0;
  for (const record of records) {
    const current = byNumber.get(Number(record.line_number));
    if (current) {
      await base44.asServiceRole.entities.InvoiceLine.update(current.id, record);
      updated += 1;
    } else {
      await base44.asServiceRole.entities.InvoiceLine.create(record);
      created += 1;
    }
  }
  return { created, updated, line_numbers: records.map((r) => r.line_number) };
}

/**
 * On a strong (confirmed) merchandise match, Linet structured lines become the final business
 * values where they map deterministically by SKU/name. The extracted candidate is preserved in
 * line_provenance_json. Ambiguous mapping is never applied silently — it is reported for review.
 */
export async function applyLinetLinesToInvoice(base44, invoiceId, linetLines, matchEvaluation) {
  if (matchEvaluation?.level !== 'confirmed' || !linetLines?.length) {
    return { applied: false, reason: 'not_confirmed_or_no_linet_lines', ambiguous: false };
  }
  const existing = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: invoiceId }, undefined, 500);
  if (!existing.length) return { applied: false, reason: 'no_stored_lines', ambiguous: false };

  const keyOf = (line) => normalizedText(line.sku) || normalizedText(line.product_name);
  const linetByKey = new Map();
  for (const line of linetLines) {
    const key = keyOf(line);
    if (!key) continue;
    if (linetByKey.has(key)) return { applied: false, reason: 'ambiguous_linet_keys', ambiguous: true };
    linetByKey.set(key, line);
  }
  const localByKey = new Map();
  for (const line of existing) {
    const key = keyOf(line);
    if (!key) continue;
    if (localByKey.has(key)) return { applied: false, reason: 'ambiguous_local_keys', ambiguous: true };
    localByKey.set(key, line);
  }
  const pairs = [...localByKey.entries()].filter(([key]) => linetByKey.has(key));
  if (!pairs.length) return { applied: false, reason: 'no_deterministic_mapping', ambiguous: true };

  let applied = 0;
  for (const [key, localLine] of pairs) {
    const linetLine = linetByKey.get(key);
    const provenance = {
      rule_version: matchEvaluation.values?.rule_version,
      chosen_source: 'LINET',
      reason: 'LINET_VERIFIED',
      applied_at: new Date().toISOString(),
      extracted: {
        quantity: numberValue(localLine.quantity),
        unit_price_before_vat: numberValue(localLine.unit_price_before_vat),
        line_total_before_vat: numberValue(localLine.line_total_before_vat),
        line_total_with_vat: numberValue(localLine.line_total_with_vat)
      },
      linet: {
        quantity: linetLine.quantity,
        unit_price_before_vat: linetLine.unit_price_before_vat,
        line_total_before_vat: linetLine.line_total_before_vat,
        line_total_with_vat: linetLine.line_total_with_vat
      }
    };
    await base44.asServiceRole.entities.InvoiceLine.update(localLine.id, {
      quantity: linetLine.quantity ?? localLine.quantity,
      unit_price_before_vat: linetLine.unit_price_before_vat ?? localLine.unit_price_before_vat,
      line_total_before_vat: linetLine.line_total_before_vat ?? localLine.line_total_before_vat,
      line_total_with_vat: linetLine.line_total_with_vat ?? localLine.line_total_with_vat,
      data_source: 'LINET',
      line_provenance_json: JSON.stringify(provenance)
    });
    applied += 1;
  }
  return { applied: true, updated_lines: applied, reason: 'LINET_VERIFIED', ambiguous: false };
}