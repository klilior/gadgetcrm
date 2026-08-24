import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeInvoiceNumber, evaluateLinetMatch, LINET_MATCH_RULE_VERSION, LINET_REASON_CODES } from '../../shared/linetInvoiceReconciliation.ts';

/**
 * Invoice ↔ Linet purchase-document reconciliation.
 *
 * SEMANTICS: the invoice and the Linet type-13 document are the SAME transaction, never
 * duplicates. A confirmed match is 'matched' — it NEVER rejects the invoice, never writes
 * duplicate_key, and never marks the intake as 'כפילות'. Conflicts are preserved on both
 * sides and forced to manual review. dry_run:true is strictly read-only.
 */

async function listAll(entity, sort) {
  const rows = [];
  for (let skip = 0; skip < 10000; skip += 1000) {
    const batch = await entity.list(sort, 1000, skip);
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

async function runBatches(items, operation) {
  for (let start = 0; start < items.length; start += 500) await operation(items.slice(start, start + 500));
}

function buildProvenance(match, chosenSource, reasonCode, now) {
  return JSON.stringify({
    rule_version: LINET_MATCH_RULE_VERSION,
    evaluated_at: now,
    chosen_source: chosenSource,
    reason: reasonCode,
    match_level: match.level,
    supplier_identity: match.supplier_identity || 'none',
    conflict_codes: match.conflict_codes || [],
    local: {
      doc_number: match.values?.local_doc_number ?? null,
      doc_date: match.values?.local_doc_date ?? null,
      total_with_vat: match.values?.local_total_with_vat ?? null,
      vat_id: match.values?.local_vat_id ?? null,
      line_sum_before_vat: match.values?.line_comparison?.local_line_sum_before_vat ?? null
    },
    linet: {
      supplier_invoice_number: match.values?.linet_supplier_invoice_number ?? null,
      doc_date: match.values?.linet_doc_date ?? null,
      total_with_vat: match.values?.linet_total_with_vat ?? null,
      subtotal_before_vat: match.values?.linet_subtotal_before_vat ?? null,
      vat_amount: match.values?.linet_vat_amount ?? null,
      vat_id: match.values?.linet_vat_id ?? null,
      line_sum_before_vat: match.values?.line_comparison?.linet_line_sum_before_vat ?? null
    }
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const [allInvoices, purchases, allLines, suppliers, allGaps] = await Promise.all([
      listAll(base44.asServiceRole.entities.Invoices, '-doc_date'), listAll(base44.asServiceRole.entities.LinetPurchaseDocument, '-doc_date'),
      listAll(base44.asServiceRole.entities.InvoiceLine, 'invoice_id'), listAll(base44.asServiceRole.entities.Suppliers, 'name'),
      listAll(base44.asServiceRole.entities.InvoiceReconciliationGap, 'id')
    ]);
    const requestedIds = new Set(body.invoice_ids || []);
    const invoices = allInvoices.filter((invoice) => {
      if (requestedIds.size && !requestedIds.has(invoice.id)) return false;
      if (body.from_date && invoice.doc_date && invoice.doc_date < body.from_date) return false;
      if (body.to_date && invoice.doc_date && invoice.doc_date > body.to_date) return false;
      // Legacy records rejected by the old duplicate logic stay eligible for targeted re-evaluation.
      return invoice.extraction_status !== 'נדחה' || invoice.linet_match_status === 'matched_duplicate';
    });
    const linesByInvoice = new Map();
    for (const line of allLines) {
      if (!linesByInvoice.has(line.invoice_id)) linesByInvoice.set(line.invoice_id, []);
      linesByInvoice.get(line.invoice_id).push(line);
    }
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const purchasesByNumber = new Map();
    for (const purchase of purchases) {
      if (!purchase.normalized_invoice_number) continue;
      if (!purchasesByNumber.has(purchase.normalized_invoice_number)) purchasesByNumber.set(purchase.normalized_invoice_number, []);
      purchasesByNumber.get(purchase.normalized_invoice_number).push(purchase);
    }
    const gapByKey = new Map(allGaps.map((gap) => [gap.gap_key, gap]));
    const matchedPurchaseIds = new Set();
    const now = new Date().toISOString();
    const stats = { checked: invoices.length, matched: 0, conflicts: 0, possible_matches: 0, missing_in_linet: 0, missing_in_system: 0, legacy_recovered: 0 };
    const results = [];
    const invoiceUpdates = [];
    const purchaseUpdates = new Map();
    const gapCreates = [];
    const gapUpdates = [];
    const activeGapKeys = new Set();

    const queueGap = (data) => {
      if (data.status === 'open') activeGapKeys.add(data.gap_key);
      const existing = gapByKey.get(data.gap_key);
      if (existing?.id) gapUpdates.push({ id: existing.id, ...data });
      else if (existing) {
        const index = gapCreates.findIndex((gap) => gap.gap_key === data.gap_key);
        if (index >= 0) gapCreates[index] = { ...gapCreates[index], ...data };
        gapByKey.set(data.gap_key, { ...existing, ...data });
      } else {
        gapCreates.push(data);
        gapByKey.set(data.gap_key, data);
      }
    };

    for (const invoice of invoices) {
      const normalized = normalizeInvoiceNumber(invoice.doc_number);
      if (!normalized) continue;
      const supplier = supplierById.get(invoice.supplier);
      const evaluations = (purchasesByNumber.get(normalized) || []).map((purchase) => ({ purchase, match: evaluateLinetMatch(invoice, purchase, linesByInvoice.get(invoice.id) || [], supplier) }));
      const confirmed = evaluations.find((item) => item.match.level === 'confirmed');
      const conflicted = evaluations.find((item) => item.match.level === 'conflict');
      const possible = evaluations.find((item) => item.match.level === 'possible' || item.match.level === 'number_only');
      const supplierName = supplier?.name || '';

      if (confirmed) {
        stats.matched++;
        matchedPurchaseIds.add(confirmed.purchase.id);
        const reason = `אותה עסקה אומתה מול מסמך רכש בלינט: ${confirmed.match.reason}`;
        const update = {
          id: invoice.id,
          normalized_doc_number: normalized,
          linet_match_status: 'matched',
          linet_purchase_document_id: confirmed.purchase.id,
          linet_doc_id: confirmed.purchase.linet_doc_id,
          linet_doc_number: confirmed.purchase.linet_doc_number,
          linet_supplier_invoice_number: confirmed.purchase.supplier_invoice_number,
          linet_total_with_vat: confirmed.match.values?.linet_total_with_vat ?? undefined,
          linet_doc_date: confirmed.match.values?.linet_doc_date ?? undefined,
          linet_conflict_reason_code: '',
          linet_match_reason: reason,
          linet_matched_at: now,
          linet_provenance_json: buildProvenance(confirmed.match, 'LINET', LINET_REASON_CODES.VERIFIED, now),
          notes: String(invoice.notes || '').includes('[linet_matched]') ? invoice.notes : `${invoice.notes || ''}\n[linet_matched] ${reason}`.trim()
        };
        // Merchandise purchases: Linet structured header becomes the business source; the extracted
        // originals are preserved first, and the document itself stays the source artifact.
        const isMerchandise = invoice.invoice_classification === 'goods' || invoice.is_goods_invoice === true;
        const linetSubtotal = confirmed.match.values?.linet_subtotal_before_vat;
        const linetVat = confirmed.match.values?.linet_vat_amount;
        const linetTotal = confirmed.match.values?.linet_total_with_vat;
        if (isMerchandise && typeof linetTotal === 'number') {
          if (invoice.extracted_total_with_vat === undefined || invoice.extracted_total_with_vat === null) {
            update.extracted_subtotal_before_vat = invoice.subtotal_before_vat ?? undefined;
            update.extracted_vat_amount = invoice.vat_amount ?? undefined;
            update.extracted_total_with_vat = invoice.total_with_vat ?? undefined;
          }
          if (typeof linetSubtotal === 'number') update.subtotal_before_vat = linetSubtotal;
          if (typeof linetVat === 'number') update.vat_amount = linetVat;
          update.total_with_vat = linetTotal;
          update.source_of_truth = 'LINET';
        }
        // Legacy recovery: an old duplicate-rejected record may return only to review, never straight to approved.
        if (invoice.linet_match_status === 'matched_duplicate' || invoice.extraction_status === 'נדחה') {
          stats.legacy_recovered++;
          update.extraction_status = 'ממתין לאימות';
          update.auto_approved = false;
          update.duplicate_key = '';
        }
        invoiceUpdates.push(update);
        purchaseUpdates.set(confirmed.purchase.id, { id: confirmed.purchase.id, matched_invoice_id: invoice.id, reconciliation_status: 'matched', match_reason: reason });
        results.push({ invoice_id: invoice.id, status: 'matched', reason, linet_purchase_document_id: confirmed.purchase.id, values: confirmed.match.values });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierName, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `linet:${confirmed.purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: confirmed.purchase.id, doc_number: confirmed.purchase.supplier_invoice_number, supplier_name: confirmed.purchase.supplier_name, doc_date: confirmed.purchase.doc_date, total_with_vat: confirmed.purchase.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `ambiguous:${invoice.id}`, direction: 'ambiguous_match', invoice_id: invoice.id, linet_purchase_document_id: confirmed.purchase.id, doc_number: invoice.doc_number, supplier_name: supplierName, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
      } else if (conflicted) {
        stats.conflicts++;
        matchedPurchaseIds.add(conflicted.purchase.id);
        const codes = conflicted.match.conflict_codes.join(',');
        const reason = `סתירה מול לינט (${codes}): ${conflicted.match.reason}`;
        // Neither side is overwritten; both values live in provenance and the record goes to review.
        invoiceUpdates.push({
          id: invoice.id,
          normalized_doc_number: normalized,
          linet_match_status: 'conflict',
          linet_purchase_document_id: conflicted.purchase.id,
          linet_doc_id: conflicted.purchase.linet_doc_id,
          linet_doc_number: conflicted.purchase.linet_doc_number,
          linet_supplier_invoice_number: conflicted.purchase.supplier_invoice_number,
          linet_total_with_vat: conflicted.match.values?.linet_total_with_vat ?? undefined,
          linet_doc_date: conflicted.match.values?.linet_doc_date ?? undefined,
          linet_conflict_reason_code: codes,
          linet_match_reason: reason,
          linet_matched_at: now,
          linet_provenance_json: buildProvenance(conflicted.match, 'none', codes, now),
          auto_approved: false,
          validation_passed: false,
          extraction_status: invoice.extraction_status === 'אושר' ? 'ממתין לאימות' : (invoice.extraction_status === 'נדחה' ? 'ממתין לאימות' : invoice.extraction_status),
          notes: String(invoice.notes || '').includes('[linet_conflict]') ? invoice.notes : `${invoice.notes || ''}\n[linet_conflict] ${reason}`.trim()
        });
        if (!purchaseUpdates.has(conflicted.purchase.id)) purchaseUpdates.set(conflicted.purchase.id, { id: conflicted.purchase.id, reconciliation_status: 'ambiguous', match_reason: reason });
        results.push({ invoice_id: invoice.id, status: 'conflict', reason_codes: conflicted.match.conflict_codes, reason, linet_purchase_document_id: conflicted.purchase.id, values: conflicted.match.values });
        queueGap({ gap_key: `ambiguous:${invoice.id}`, direction: 'ambiguous_match', invoice_id: invoice.id, linet_purchase_document_id: conflicted.purchase.id, doc_number: invoice.doc_number, supplier_name: supplierName || conflicted.purchase.supplier_name, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'open', reason, detected_at: now });
      } else if (possible) {
        stats.possible_matches++;
        matchedPurchaseIds.add(possible.purchase.id);
        const reason = `התאמה אפשרית הדורשת בדיקה: ${possible.match.reason}`;
        invoiceUpdates.push({ id: invoice.id, normalized_doc_number: normalized, linet_match_status: 'possible_match', linet_purchase_document_id: possible.purchase.id, linet_total_with_vat: possible.match.values?.linet_total_with_vat ?? undefined, linet_doc_date: possible.match.values?.linet_doc_date ?? undefined, linet_match_reason: reason, linet_matched_at: now, linet_provenance_json: buildProvenance(possible.match, 'extracted', 'LINET_POSSIBLE_MATCH', now) });
        if (!purchaseUpdates.has(possible.purchase.id)) purchaseUpdates.set(possible.purchase.id, { id: possible.purchase.id, reconciliation_status: 'ambiguous', match_reason: reason });
        results.push({ invoice_id: invoice.id, status: 'possible_match', reason, linet_purchase_document_id: possible.purchase.id });
        queueGap({ gap_key: `ambiguous:${invoice.id}`, direction: 'ambiguous_match', invoice_id: invoice.id, linet_purchase_document_id: possible.purchase.id, doc_number: invoice.doc_number, supplier_name: supplierName || possible.purchase.supplier_name, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'open', reason, detected_at: now });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierName, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `linet:${possible.purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: possible.purchase.id, doc_number: possible.purchase.supplier_invoice_number, supplier_name: possible.purchase.supplier_name, doc_date: possible.purchase.doc_date, total_with_vat: possible.purchase.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
      } else {
        stats.missing_in_linet++;
        const reason = 'החשבונית נקלטה במערכת אך לא נמצא מסמך רכש 13 מאומת ב-Linet.';
        invoiceUpdates.push({ id: invoice.id, normalized_doc_number: normalized, linet_match_status: 'missing_in_linet', linet_match_reason: reason, linet_matched_at: now });
        results.push({ invoice_id: invoice.id, status: 'missing_in_linet', reason });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierName, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'open', reason, detected_at: now });
      }
    }

    // Targeted runs (invoice_ids) never scan the global purchase set: no unrelated
    // missing_in_system gap may be created or touched, so targeted stats stay at 0.
    if (!requestedIds.size) {
      const eligiblePurchases = purchases.filter((purchase) => (!body.from_date || purchase.doc_date >= body.from_date) && (!body.to_date || purchase.doc_date <= body.to_date));
      for (const purchase of eligiblePurchases) {
        if (purchase.matched_invoice_id || matchedPurchaseIds.has(purchase.id)) continue;
        stats.missing_in_system++;
        queueGap({ gap_key: `linet:${purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: purchase.id, doc_number: purchase.supplier_invoice_number, supplier_name: purchase.supplier_name, doc_date: purchase.doc_date, total_with_vat: purchase.total_with_vat, status: 'open', reason: 'מסמך רכש 13 קיים ב-Linet אך לא נמצאה חשבונית תואמת במערכת.', detected_at: now });
      }
    }

    // Targeted single-invoice runs must not close unrelated gaps.
    if (!requestedIds.size) {
      for (const gap of allGaps) {
        const inPeriod = (!body.from_date || !gap.doc_date || gap.doc_date >= body.from_date) && (!body.to_date || !gap.doc_date || gap.doc_date <= body.to_date);
        const shouldCloseStale = body.close_stale_all === true || inPeriod;
        const isActive = activeGapKeys.has(gap.gap_key);
        const canonical = gapByKey.get(gap.gap_key);
        const isDuplicateActiveRecord = isActive && canonical?.id && canonical.id !== gap.id;
        if (gap.status === 'open' && (isDuplicateActiveRecord || (shouldCloseStale && !isActive))) {
          gapUpdates.push({ id: gap.id, status: 'resolved', resolved_at: now, reason: `${gap.reason || ''} [נסגר אוטומטית: אינו פער פעיל בריצה האחרונה]`.trim() });
        }
      }
    }

    if (!dryRun) {
      await runBatches(invoiceUpdates, (batch) => base44.asServiceRole.entities.Invoices.bulkUpdate(batch));
      await runBatches([...purchaseUpdates.values()], (batch) => base44.asServiceRole.entities.LinetPurchaseDocument.bulkUpdate(batch));
      const uniqueGapUpdates = [...new Map(gapUpdates.map((item) => [item.id, item])).values()];
      await runBatches(uniqueGapUpdates, (batch) => base44.asServiceRole.entities.InvoiceReconciliationGap.bulkUpdate(batch));
      await runBatches(gapCreates, (batch) => base44.asServiceRole.entities.InvoiceReconciliationGap.bulkCreate(batch));
    }
    return Response.json({ success: true, dry_run: dryRun, rule_version: LINET_MATCH_RULE_VERSION, stats, results });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});