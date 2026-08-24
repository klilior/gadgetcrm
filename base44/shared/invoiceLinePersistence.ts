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
 * Pure preflight (C2/D): a write is allowed ONLY for a complete deterministic one-to-one mapping —
 * identical non-empty normalized key sets on both sides, equal counts, no duplicate keys.
 * Any partial mapping, extra/missing key or duplicate returns ambiguous and blocks all writes.
 */
export function preflightLinetLineMapping(localLines, linetLines) {
  const keyOf = (line) => normalizedText(line?.sku) || normalizedText(line?.product_name);
  const local = localLines || [];
  const linet = linetLines || [];
  if (!local.length || !linet.length) return { ok: false, ambiguous: false, reason: 'no_lines_on_one_side', pairs: [] };
  if (local.length !== linet.length) return { ok: false, ambiguous: true, reason: 'line_count_mismatch', pairs: [] };

  const linetByKey = new Map();
  for (const line of linet) {
    const key = keyOf(line);
    if (!key) return { ok: false, ambiguous: true, reason: 'empty_linet_key', pairs: [] };
    if (linetByKey.has(key)) return { ok: false, ambiguous: true, reason: 'ambiguous_linet_keys', pairs: [] };
    linetByKey.set(key, line);
  }
  const localByKey = new Map();
  for (const line of local) {
    const key = keyOf(line);
    if (!key) return { ok: false, ambiguous: true, reason: 'empty_local_key', pairs: [] };
    if (localByKey.has(key)) return { ok: false, ambiguous: true, reason: 'ambiguous_local_keys', pairs: [] };
    localByKey.set(key, line);
  }
  const missing = [...localByKey.keys()].filter((key) => !linetByKey.has(key));
  const extra = [...linetByKey.keys()].filter((key) => !localByKey.has(key));
  if (missing.length || extra.length) {
    return { ok: false, ambiguous: true, reason: 'incomplete_mapping', missing_keys: missing, extra_keys: extra, pairs: [] };
  }
  return { ok: true, ambiguous: false, reason: 'complete_one_to_one', pairs: [...localByKey.entries()].map(([key, localLine]) => ({ key, local: localLine, linet: linetByKey.get(key) })) };
}

/**
 * On a strong (confirmed) merchandise match, Linet structured lines become the final business
 * values — but only when the mapping is a complete one-to-one match (see preflight above).
 * The extracted candidate is preserved in line_provenance_json. Ambiguous mapping writes nothing.
 */
export async function applyLinetLinesToInvoice(base44, invoiceId, linetLines, matchEvaluation) {
  if (matchEvaluation?.level !== 'confirmed' || !linetLines?.length) {
    return { applied: false, reason: 'not_confirmed_or_no_linet_lines', ambiguous: false };
  }
  const existing = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: invoiceId }, undefined, 500);
  if (!existing.length) return { applied: false, reason: 'no_stored_lines', ambiguous: false };

  const preflight = preflightLinetLineMapping(existing, linetLines);
  if (!preflight.ok) return { applied: false, reason: preflight.reason, ambiguous: preflight.ambiguous, missing_keys: preflight.missing_keys, extra_keys: preflight.extra_keys };
  const pairs = preflight.pairs.map((pair) => [pair.key, pair.local]);
  const linetByKey = new Map(preflight.pairs.map((pair) => [pair.key, pair.linet]));

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