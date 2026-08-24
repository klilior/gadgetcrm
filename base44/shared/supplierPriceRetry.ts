/**
 * D2b1 — retry side-effect idempotency for supplier price tracking.
 *
 * A retry of the SAME invoice is not a new purchase: purchase_count must not move when the
 * existing price record already points at this invoice (last_invoice_id === invoice.id).
 * Price / min / max / date may still be refreshed safely, because they are last-write values
 * rather than accumulators.
 *
 * Pure and DB-free — the caller applies the returned fields.
 */

/**
 * @returns {{action: 'create'|'update', is_same_invoice_retry: boolean, purchase_count: number, purchase_count_delta: number}}
 */
export function planSupplierPricePurchase({ oldRecord, invoiceId }) {
  if (!oldRecord) {
    return { action: 'create', is_same_invoice_retry: false, purchase_count: 1, purchase_count_delta: 1 };
  }
  const base = Number(oldRecord.purchase_count) || 0;
  const isSameInvoiceRetry = !!invoiceId && oldRecord.last_invoice_id === invoiceId;
  return {
    action: 'update',
    is_same_invoice_retry: isSameInvoiceRetry,
    purchase_count: isSameInvoiceRetry ? base : base + 1,
    purchase_count_delta: isSameInvoiceRetry ? 0 : 1
  };
}