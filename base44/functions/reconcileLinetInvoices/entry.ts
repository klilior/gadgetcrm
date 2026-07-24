import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeInvoiceNumber, evaluateLinetMatch } from '../../shared/linetInvoiceReconciliation.ts';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const [allInvoices, purchases, allLines, suppliers, allGaps] = await Promise.all([
      listAll(base44.asServiceRole.entities.Invoices, '-doc_date'), listAll(base44.asServiceRole.entities.LinetPurchaseDocument, '-doc_date'),
      listAll(base44.asServiceRole.entities.InvoiceLine, 'invoice_id'), listAll(base44.asServiceRole.entities.Suppliers, 'name'),
      listAll(base44.asServiceRole.entities.InvoiceReconciliationGap, '-detected_at')
    ]);
    const requestedIds = new Set(body.invoice_ids || []);
    const invoices = allInvoices.filter((invoice) => {
      if (requestedIds.size && !requestedIds.has(invoice.id)) return false;
      if (body.from_date && invoice.doc_date && invoice.doc_date < body.from_date) return false;
      if (body.to_date && invoice.doc_date && invoice.doc_date > body.to_date) return false;
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
    const stats = { checked: invoices.length, matched_duplicates: 0, possible_matches: 0, missing_in_linet: 0, missing_in_system: 0 };
    const invoiceUpdates = [];
    const intakeUpdates = [];
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
      const evaluations = (purchasesByNumber.get(normalized) || []).map((purchase) => ({ purchase, match: evaluateLinetMatch(invoice, purchase, linesByInvoice.get(invoice.id) || [], supplierById.get(invoice.supplier)) }));
      const confirmed = evaluations.find((item) => item.match.level === 'confirmed');
      const possible = evaluations.find((item) => item.match.level === 'possible' || item.match.level === 'number_only');
      if (confirmed) {
        stats.matched_duplicates++;
        matchedPurchaseIds.add(confirmed.purchase.id);
        const reason = `כפילות מאומתת מול Linet: ${confirmed.match.reason}`;
        invoiceUpdates.push({ id: invoice.id, normalized_doc_number: normalized, linet_match_status: 'matched_duplicate', linet_purchase_document_id: confirmed.purchase.id, linet_doc_id: confirmed.purchase.linet_doc_id, linet_doc_number: confirmed.purchase.linet_doc_number, linet_supplier_invoice_number: confirmed.purchase.supplier_invoice_number, linet_match_reason: reason, linet_matched_at: now, duplicate_key: `linet|${confirmed.purchase.linet_doc_id}`, extraction_status: 'נדחה', notes: String(invoice.notes || '').includes('[linet_duplicate]') ? invoice.notes : `${invoice.notes || ''}\n[linet_duplicate] ${reason}`.trim() });
        purchaseUpdates.set(confirmed.purchase.id, { id: confirmed.purchase.id, matched_invoice_id: invoice.id, reconciliation_status: 'matched', match_reason: reason });
        if (invoice.source_intake) intakeUpdates.push({ id: invoice.source_intake, status: 'כפילות', status_reason: reason });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierById.get(invoice.supplier)?.name || '', doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `linet:${confirmed.purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: confirmed.purchase.id, doc_number: confirmed.purchase.supplier_invoice_number, supplier_name: confirmed.purchase.supplier_name, doc_date: confirmed.purchase.doc_date, total_with_vat: confirmed.purchase.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `ambiguous:${invoice.id}`, direction: 'ambiguous_match', invoice_id: invoice.id, linet_purchase_document_id: confirmed.purchase.id, doc_number: invoice.doc_number, supplier_name: supplierById.get(invoice.supplier)?.name || '', doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
      } else if (possible) {
        stats.possible_matches++;
        matchedPurchaseIds.add(possible.purchase.id);
        const reason = `התאמה אפשרית הדורשת בדיקה: ${possible.match.reason}`;
        invoiceUpdates.push({ id: invoice.id, normalized_doc_number: normalized, linet_match_status: 'possible_match', linet_purchase_document_id: possible.purchase.id, linet_match_reason: reason, linet_matched_at: now });
        if (!purchaseUpdates.has(possible.purchase.id)) purchaseUpdates.set(possible.purchase.id, { id: possible.purchase.id, reconciliation_status: 'ambiguous', match_reason: reason });
        queueGap({ gap_key: `ambiguous:${invoice.id}`, direction: 'ambiguous_match', invoice_id: invoice.id, linet_purchase_document_id: possible.purchase.id, doc_number: invoice.doc_number, supplier_name: supplierById.get(invoice.supplier)?.name || possible.purchase.supplier_name, doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'open', reason, detected_at: now });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierById.get(invoice.supplier)?.name || '', doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
        queueGap({ gap_key: `linet:${possible.purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: possible.purchase.id, doc_number: possible.purchase.supplier_invoice_number, supplier_name: possible.purchase.supplier_name, doc_date: possible.purchase.doc_date, total_with_vat: possible.purchase.total_with_vat, status: 'resolved', reason, detected_at: now, resolved_at: now });
      } else {
        stats.missing_in_linet++;
        const reason = 'החשבונית נקלטה במערכת אך לא נמצא מסמך רכש 13 מאומת ב-Linet.';
        invoiceUpdates.push({ id: invoice.id, normalized_doc_number: normalized, linet_match_status: 'missing_in_linet', linet_match_reason: reason, linet_matched_at: now });
        queueGap({ gap_key: `invoice:${invoice.id}`, direction: 'missing_in_linet', invoice_id: invoice.id, doc_number: invoice.doc_number, supplier_name: supplierById.get(invoice.supplier)?.name || '', doc_date: invoice.doc_date, total_with_vat: invoice.total_with_vat, status: 'open', reason, detected_at: now });
      }
    }

    const eligiblePurchases = purchases.filter((purchase) => (!body.from_date || purchase.doc_date >= body.from_date) && (!body.to_date || purchase.doc_date <= body.to_date));
    for (const purchase of eligiblePurchases) {
      if (purchase.matched_invoice_id || matchedPurchaseIds.has(purchase.id)) continue;
      stats.missing_in_system++;
      queueGap({ gap_key: `linet:${purchase.id}`, direction: 'missing_in_system', linet_purchase_document_id: purchase.id, doc_number: purchase.supplier_invoice_number, supplier_name: purchase.supplier_name, doc_date: purchase.doc_date, total_with_vat: purchase.total_with_vat, status: 'open', reason: 'מסמך רכש 13 קיים ב-Linet אך לא נמצאה חשבונית תואמת במערכת.', detected_at: now });
    }

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

    if (!dryRun) {
      await runBatches(invoiceUpdates, (batch) => base44.asServiceRole.entities.Invoices.bulkUpdate(batch));
      await runBatches(intakeUpdates, (batch) => base44.asServiceRole.entities.InvoiceIntakeRaw.bulkUpdate(batch));
      await runBatches([...purchaseUpdates.values()], (batch) => base44.asServiceRole.entities.LinetPurchaseDocument.bulkUpdate(batch));
      const uniqueGapUpdates = [...new Map(gapUpdates.map((item) => [item.id, item])).values()];
      await runBatches(uniqueGapUpdates, (batch) => base44.asServiceRole.entities.InvoiceReconciliationGap.bulkUpdate(batch));
      await runBatches(gapCreates, (batch) => base44.asServiceRole.entities.InvoiceReconciliationGap.bulkCreate(batch));
    }
    return Response.json({ success: true, dry_run: dryRun, stats });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});