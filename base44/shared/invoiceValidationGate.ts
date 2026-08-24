/**
 * Deterministic validation gate for supplier invoices.
 *
 * P0.1 — LLM self-confidence (overall_confidence / confidence_score) is telemetry ONLY.
 *        It must NEVER be the reason an invoice gets auto-approved.
 * P0.2 — This is the single central place that decides whether an invoice may be
 *        auto-approved. Every pipeline must call validateInvoiceForAutoApproval().
 */

export const INVOICE_VALIDATION_VERSION = 'gate-1.0.0';

// Rounding-only tolerance for subtotal + VAT ≈ total (single agora of rounding).
export const ARITHMETIC_TOLERANCE = 0.02;

function isNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function cleanStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Digits-only invoice-number core, used for duplicate identity. */
export function normalizeInvoiceNumber(docNumber: unknown): string {
  const raw = cleanStr(docNumber).toUpperCase();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits || raw.replace(/[^A-Z0-9]/g, '');
}

function isPlausibleInvoiceNumber(docNumber: unknown): boolean {
  const raw = cleanStr(docNumber);
  if (!raw || raw.toLowerCase() === 'null') return false;
  if (raw.length < 2 || raw.length > 40) return false;
  // Must contain at least one digit; pure words ("חשבונית") are not a number.
  return /\d/.test(raw);
}

function parseIsoDate(value: unknown): Date | null {
  const raw = cleanStr(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (raw !== d.toISOString().slice(0, 10)) return null;
  return d;
}

/**
 * @param candidate extracted/normalized invoice header:
 *   { supplier_name, supplier_vat_id, doc_number, invoice_date (or doc_date), due_date,
 *     subtotal_before_vat, vat_amount, total_with_vat, doc_type_he }
 * @param context   { supplier, supplier_match_method, duplicates, invoice_id, line_check, now }
 *   supplier_match_method: 'vat_id' | 'alias' | 'learned_pattern' | 'name' | 'created' | 'none'
 *   duplicates: existing invoice records sharing the same supplier identity (may include self)
 */
export function validateInvoiceForAutoApproval(candidate: any, context: any = {}) {
  const failures: string[] = [];
  const warnings: string[] = [];
  const validated_fields: string[] = [];

  const supplier = context.supplier || null;
  const matchMethod = context.supplier_match_method || 'none';
  const RELIABLE_MATCHES = ['vat_id', 'alias', 'learned_pattern'];
  // Supplier reliability comes from the deterministic resolver when the route supplies it.
  // A Supplier record merely EXISTING is never enough. Older callers that pass no
  // resolution keep the previous match-method behaviour.
  const resolution = context.supplier_resolution || null;
  const reliableIdentity = resolution
    ? resolution.reliable_for_auto_approval === true
    : RELIABLE_MATCHES.includes(matchMethod);

  // ── Supplier identity ────────────────────────────────────────────────
  const supplierName = cleanStr(candidate?.supplier_name);
  const GENERIC_NAMES = ['לא ידוע', 'לא ניתן לקרוא', 'unknown', 'n/a'];
  if (!supplier?.id) {
    failures.push(resolution?.reason
      ? `לא זוהה ספק במערכת (${resolution.reason_code || 'SUPPLIER_UNRESOLVED'}): ${resolution.reason}`
      : 'לא זוהה ספק במערכת.');
  } else if (!supplierName || GENERIC_NAMES.includes(supplierName.toLowerCase())) {
    failures.push('שם הספק אינו קריא או כללי מדי.');
  } else if (!reliableIdentity) {
    failures.push(resolution
      ? `זיהוי הספק אינו אמין דיו (${resolution.reason_code || 'SUPPLIER_WEAK_EVIDENCE'}): ${resolution.reason}`
      : `זיהוי הספק אינו אמין דיו (זוהה לפי ${matchMethod === 'created' ? 'יצירת ספק חדש' : 'התאמת שם'}).`);
  } else {
    validated_fields.push('supplier');
  }

  // ── Invoice number ───────────────────────────────────────────────────
  if (!isPlausibleInvoiceNumber(candidate?.doc_number)) {
    failures.push('מספר מסמך חסר או לא סביר.');
  } else {
    validated_fields.push('doc_number');
  }

  // ── Invoice date (must be the document date, NOT the due date) ────────
  const invoiceDateRaw = candidate?.invoice_date ?? candidate?.doc_date;
  const invoiceDate = parseIsoDate(invoiceDateRaw);
  const dueDate = parseIsoDate(candidate?.due_date);
  if (!invoiceDate) {
    failures.push('תאריך המסמך חסר או לא תקין.');
  } else {
    const now = context.now ? new Date(context.now) : new Date();
    const maxFuture = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const minPast = new Date('2015-01-01T00:00:00Z');
    if (invoiceDate > maxFuture) {
      failures.push('תאריך המסמך עתידי ואינו הגיוני.');
    } else if (invoiceDate < minPast) {
      failures.push('תאריך המסמך מוקדם מדי ואינו הגיוני.');
    } else if (dueDate && invoiceDate.getTime() === dueDate.getTime()) {
      warnings.push('תאריך המסמך זהה למועד התשלום — ייתכן בלבול בין השניים.');
      validated_fields.push('invoice_date');
    } else if (dueDate && dueDate < invoiceDate) {
      warnings.push('מועד התשלום מוקדם מתאריך המסמך.');
      validated_fields.push('invoice_date');
    } else {
      validated_fields.push('invoice_date');
    }
  }

  // ── Total ────────────────────────────────────────────────────────────
  const total = candidate?.total_with_vat;
  const sub = candidate?.subtotal_before_vat;
  const vat = candidate?.vat_amount;
  // An explicitly extracted finite total of 0 is valid (e.g. fully discounted document).
  if (!isNum(total)) {
    failures.push('סכום לתשלום חסר או לא תקין.');
  } else {
    validated_fields.push('total_with_vat');
  }

  // ── Arithmetic: subtotal + VAT ≈ total (rounding tolerance only) ──────
  if (isNum(total) && isNum(sub) && isNum(vat)) {
    const delta = Math.round(Math.abs(sub + vat - total) * 100) / 100;
    if (delta > ARITHMETIC_TOLERANCE) {
      failures.push(`אי-התאמה חשבונאית: לפני מע״מ + מע״מ אינו שווה לסכום הכולל (הפרש ${delta} ש״ח).`);
    } else {
      validated_fields.push('arithmetic');
    }
  } else if (isNum(total)) {
    warnings.push('אין פירוט לפני מע״מ / מע״מ ולכן לא בוצעה בדיקה חשבונאית.');
  }

  // ── Line items consistency (when available) ──────────────────────────
  // Every deterministic line failure blocks approval — including a per-line
  // quantity × unit_price ≠ line_total contradiction that leaves the line SUM intact.
  const lineCheck = context.line_check;
  if (Array.isArray(lineCheck?.failures) && lineCheck.failures.length) {
    for (const failure of lineCheck.failures) failures.push(failure);
  } else if (lineCheck?.hasAnyFailure || lineCheck?.hasMismatch || lineCheck?.hasBadQuantity) {
    failures.push('בדיקת שורות המוצרים נכשלה.');
  }

  // ── Duplicate: supplier identity + normalized invoice number ─────────
  const normalized = normalizeInvoiceNumber(candidate?.doc_number);
  const selfId = context.invoice_id || null;
  const duplicates = Array.isArray(context.duplicates) ? context.duplicates : [];
  if (normalized) {
    const realDuplicate = duplicates.find((inv: any) => {
      if (!inv || inv.id === selfId) return false;                 // same record → idempotent re-run
      if (inv.extraction_status === 'נדחה') return false;          // already rejected
      const other = normalizeInvoiceNumber(inv.normalized_doc_number || inv.doc_number);
      return other && other === normalized;
    });
    if (realDuplicate) {
      failures.push(`כפילות: חשבונית ${cleanStr(candidate?.doc_number)} מספק זה כבר קיימת (${realDuplicate.id}).`);
    } else {
      validated_fields.push('no_duplicate');
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    validated_fields,
    validation_version: INVOICE_VALIDATION_VERSION,
  };
}