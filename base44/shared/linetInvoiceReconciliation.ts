/**
 * Deterministic Invoice ↔ LinetPurchaseDocument matching.
 *
 * SEMANTICS (Task C): the scanned invoice and the Linet type-13 purchase document are two
 * representations of the SAME transaction — never duplicates. A confirmed match is 'matched'.
 * 'matched_duplicate' is legacy-only and must never be written by new code.
 */

export const LINET_MATCH_TOLERANCE = 0.02;
export const LINET_MATCH_RULE_VERSION = 'linet-match-c-2026-08';

export const LINET_REASON_CODES = {
  TOTAL: 'LINET_TOTAL_CONFLICT',
  DATE: 'LINET_DATE_CONFLICT',
  SUPPLIER: 'LINET_SUPPLIER_CONFLICT',
  LINE: 'LINET_LINE_CONFLICT',
  VERIFIED: 'LINET_VERIFIED',
  AMBIGUOUS_CANDIDATES: 'LINET_AMBIGUOUS_CANDIDATES',
  PURCHASE_ALREADY_MATCHED: 'LINET_PURCHASE_ALREADY_MATCHED'
};

export function normalizeInvoiceNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

export function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (!match || match[0].startsWith('0000-')) return '';
  return match[0];
}

export function numberValue(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function normalizedText(value) {
  return String(value || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function sumTolerance(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return Math.round(Math.max(LINET_MATCH_TOLERANCE, n * LINET_MATCH_TOLERANCE) * 100) / 100;
}

/** Tolerant parse of LinetPurchaseDocument.lines_json into a comparable shape. */
export function parseLinetLines(purchase) {
  let raw = purchase?.lines_json;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { return []; }
  }
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.lines) ? raw.lines : []);
  return list.map((line, index) => ({
    line_number: numberValue(line.line_number ?? line.lineNumber ?? index + 1) || index + 1,
    sku: String(line.sku ?? line.item_sku ?? line.itemSku ?? line.catalog_number ?? '').trim(),
    product_name: String(line.product_name ?? line.item_name ?? line.itemName ?? line.name ?? '').trim(),
    quantity: numberValue(line.quantity ?? line.qty ?? line.amount),
    unit_price_before_vat: numberValue(line.unit_price_before_vat ?? line.unit_price ?? line.price),
    line_total_before_vat: numberValue(line.line_total_before_vat ?? line.total_before_vat ?? line.line_total ?? line.total),
    line_total_with_vat: numberValue(line.line_total_with_vat ?? line.total_with_vat)
  })).filter((line) => line.sku || line.product_name || line.quantity !== null);
}

function lineKey(line) {
  return normalizedText(line.sku) || normalizedText(line.product_name);
}

/**
 * Supporting line comparison. Returns { applicable, agrees, conflict, details }.
 * Only a MEANINGFUL contradiction sets conflict; missing structure is simply not applicable.
 */
export function compareLines(invoiceLines, linetLines) {
  const local = (invoiceLines || []).filter((line) => line && (line.sku || line.product_name));
  if (!local.length || !linetLines.length) {
    return { applicable: false, agrees: null, conflict: false, details: { reason: 'no comparable line structure on both sides' } };
  }
  const localSum = local.reduce((sum, line) => sum + (numberValue(line.line_total_before_vat) || 0), 0);
  const linetSum = linetLines.reduce((sum, line) => sum + (line.line_total_before_vat || 0), 0);
  const tolerance = sumTolerance(Math.max(local.length, linetLines.length));
  const sumDelta = Math.round(Math.abs(localSum - linetSum) * 100) / 100;
  const sumComparable = localSum > 0 && linetSum > 0;
  const sumConflict = sumComparable && sumDelta > tolerance;

  const linetByKey = new Map();
  for (const line of linetLines) {
    const key = lineKey(line);
    if (key) linetByKey.set(key, (linetByKey.get(key) || 0) + (line.quantity || 0));
  }
  const localByKey = new Map();
  for (const line of local) {
    const key = lineKey(line);
    if (key) localByKey.set(key, (localByKey.get(key) || 0) + (numberValue(line.quantity) || 0));
  }
  const quantityConflicts = [];
  for (const [key, localQty] of localByKey.entries()) {
    if (!linetByKey.has(key)) continue;
    const linetQty = linetByKey.get(key);
    if (localQty > 0 && linetQty > 0 && Math.abs(localQty - linetQty) > 0.001) {
      quantityConflicts.push({ key, local_quantity: localQty, linet_quantity: linetQty });
    }
  }
  const conflict = sumConflict || quantityConflicts.length > 0;
  return {
    applicable: sumComparable || linetByKey.size > 0,
    agrees: conflict ? false : (sumComparable && sumDelta <= tolerance),
    conflict,
    details: {
      local_line_sum_before_vat: Math.round(localSum * 100) / 100,
      linet_line_sum_before_vat: Math.round(linetSum * 100) / 100,
      sum_delta: sumDelta,
      tolerance,
      quantity_conflicts: quantityConflicts
    }
  };
}

/**
 * Pure candidate selection (C2/B + C2/C). NEVER picks the first of several confirmed candidates,
 * and never claims a purchase document that already belongs to another invoice or was reserved by
 * an earlier confirmed match in the same batch. Blocked decisions carry stable reason codes and
 * preserve all candidate ids/values so the reviewer sees both sides; no header value is chosen.
 *
 * evaluations: [{ purchase, match }]
 * returns { decision: 'confirmed'|'blocked'|'conflict'|'possible'|'none', selected, reason_code, candidates }
 */
export function selectLinetCandidate(evaluations, { invoiceId = null, reservedPurchaseIds = null } = {}) {
  const reserved = reservedPurchaseIds instanceof Set ? reservedPurchaseIds : new Set(reservedPurchaseIds || []);
  const list = Array.isArray(evaluations) ? evaluations : [];
  const describe = (item) => ({
    linet_purchase_document_id: item.purchase?.id ?? null,
    linet_doc_id: item.purchase?.linet_doc_id ?? null,
    linet_doc_number: item.purchase?.linet_doc_number ?? null,
    matched_invoice_id: item.purchase?.matched_invoice_id ?? null,
    values: item.match?.values ?? null
  });

  const confirmed = list.filter((item) => item.match?.level === 'confirmed');
  if (confirmed.length > 1) {
    return { decision: 'blocked', selected: null, reason_code: LINET_REASON_CODES.AMBIGUOUS_CANDIDATES, candidates: confirmed.map(describe) };
  }
  if (confirmed.length === 1) {
    const item = confirmed[0];
    const takenByOther = item.purchase?.matched_invoice_id && String(item.purchase.matched_invoice_id) !== String(invoiceId ?? '');
    const reservedInBatch = item.purchase?.id && reserved.has(item.purchase.id);
    if (takenByOther || reservedInBatch) {
      return { decision: 'blocked', selected: null, reason_code: LINET_REASON_CODES.PURCHASE_ALREADY_MATCHED, candidates: [describe(item)] };
    }
    return { decision: 'confirmed', selected: item, reason_code: LINET_REASON_CODES.VERIFIED, candidates: [describe(item)] };
  }
  const conflicted = list.find((item) => item.match?.level === 'conflict');
  if (conflicted) return { decision: 'conflict', selected: conflicted, reason_code: null, candidates: [describe(conflicted)] };
  const possible = list.find((item) => item.match?.level === 'possible' || item.match?.level === 'number_only');
  if (possible) return { decision: 'possible', selected: possible, reason_code: null, candidates: [describe(possible)] };
  return { decision: 'none', selected: null, reason_code: null, candidates: [] };
}

/**
 * Evaluate one invoice against one Linet purchase document.
 * level: 'none' | 'number_only' | 'possible' | 'conflict' | 'confirmed'
 * A confirmed match requires ALL of: normalized number, positive supplier identity,
 * exact document date, and total within rounding-only tolerance (0.02).
 */
export function evaluateLinetMatch(invoice, purchase, invoiceLines = [], supplier = null, tolerance = LINET_MATCH_TOLERANCE) {
  const localNumber = normalizeInvoiceNumber(invoice.doc_number);
  // Defensive: the stored Linet key may be unnormalized (leading zeros, dashes, spaces).
  const linetNumber = normalizeInvoiceNumber(purchase.normalized_invoice_number);
  const numberMatch = localNumber !== '' && localNumber === linetNumber;

  const localVat = String(supplier?.vat_id || '').replace(/\D/g, '');
  const linetVat = String(purchase.supplier_vat_id || '').replace(/\D/g, '');
  const localDate = dateOnly(invoice.doc_date);
  const linetDate = dateOnly(purchase.doc_date);
  const localTotal = numberValue(invoice.total_with_vat);
  const linetTotal = numberValue(purchase.total_with_vat);
  const linetLines = parseLinetLines(purchase);
  const lineComparison = compareLines(invoiceLines, linetLines);

  const values = {
    local_doc_number: invoice.doc_number || null,
    local_normalized_number: localNumber || null,
    linet_normalized_number: linetNumber || null,
    linet_supplier_invoice_number: purchase.supplier_invoice_number || null,
    local_vat_id: localVat || null,
    linet_vat_id: linetVat || null,
    local_doc_date: localDate || null,
    linet_doc_date: linetDate || null,
    local_total_with_vat: localTotal,
    linet_total_with_vat: linetTotal,
    linet_subtotal_before_vat: numberValue(purchase.subtotal_before_vat),
    linet_vat_amount: numberValue(purchase.vat_amount),
    line_comparison: lineComparison.details,
    rule_version: LINET_MATCH_RULE_VERSION
  };

  if (!numberMatch) {
    return { level: 'none', numberMatch: false, conflict_codes: [], values, reason: 'מספר החשבונית אינו תואם למסמך רכש בלינט.' };
  }

  const conflictCodes = [];
  let supplierIdentity = 'none';
  if (localVat && linetVat) {
    if (localVat === linetVat) supplierIdentity = 'vat';
    else { supplierIdentity = 'conflict'; conflictCodes.push(LINET_REASON_CODES.SUPPLIER); }
  }
  if (supplierIdentity === 'none' && supplier?.linet_supplier_account_id && purchase.supplier_account_id
      && String(supplier.linet_supplier_account_id) === String(purchase.supplier_account_id)) {
    supplierIdentity = 'linet_account';
  }

  const dateMatch = !!localDate && !!linetDate && localDate === linetDate;
  if (localDate && linetDate && !dateMatch) conflictCodes.push(LINET_REASON_CODES.DATE);

  const totalComparable = localTotal !== null && linetTotal !== null;
  const totalMatch = totalComparable && Math.abs(localTotal - linetTotal) <= tolerance;
  if (totalComparable && !totalMatch) conflictCodes.push(LINET_REASON_CODES.TOTAL);

  if (lineComparison.conflict) conflictCodes.push(LINET_REASON_CODES.LINE);

  const supplierIdentified = supplierIdentity === 'vat' || supplierIdentity === 'linet_account';
  const reasonParts = [
    `מספר=כן`,
    `זהות ספק=${supplierIdentity}`,
    `תאריך=${dateMatch ? 'כן' : (localDate && linetDate ? 'לא' : 'חסר')}`,
    `סכום=${totalMatch ? 'כן' : (totalComparable ? 'לא' : 'חסר')}`,
    `שורות=${lineComparison.applicable ? (lineComparison.conflict ? 'סתירה' : 'תואם') : 'לא ישים'}`
  ];

  let level;
  if (conflictCodes.length) level = 'conflict';
  else if (supplierIdentified && dateMatch && totalMatch) level = 'confirmed';
  else if (dateMatch || totalMatch || lineComparison.agrees === true) level = 'possible';
  else level = 'number_only';

  return {
    level,
    numberMatch: true,
    supplier_identity: supplierIdentity,
    dateMatch,
    totalMatch,
    lineComparison,
    linet_lines: linetLines,
    conflict_codes: conflictCodes,
    values,
    reason: reasonParts.join(', ')
  };
}