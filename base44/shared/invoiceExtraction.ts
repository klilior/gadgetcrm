/**
 * Shared invoice extraction contract (prompt + schema + deterministic helpers).
 * Imported by every extraction route so all of them read documents identically.
 */

export const EXTRACT_PROMPT = `SYSTEM / INSTRUCTION

You are an EXTREMELY PRECISE Israeli invoice data extraction engine. Your job is to read the EXACT text from the document — never guess, never approximate, never hallucinate.

INPUT
You will receive ONE document file (PDF/JPG/PNG) attached to this request.

IMPORTANT UI LANGUAGE RULE
All human-readable text intended to be displayed in the app UI must be in Hebrew (RTL).
JSON keys MUST be English as defined below.

GOAL
Extract structured header data from a supplier document.
Only two document types are relevant:
- Tax Invoice (חשבונית מס)
- Credit Note (חשבונית זיכוי)
Anything else must be classified as OTHER and skipped.

═══════════════════════════════════════
ABSOLUTE PRECISION RULES — READ CAREFULLY
═══════════════════════════════════════

*** SUPPLIER NAME — MOST CRITICAL ***
1. Read the supplier name EXACTLY as printed. Do NOT "correct" or guess spelling.
2. Hebrew OCR pitfalls: carefully distinguish between similar letters:
   - א vs ע (alef vs ayin)
   - ו vs ן (vav vs final-nun)
   - כ vs ב (kaf vs bet)
   - ד vs ר (dalet vs resh)
   - ם vs ס vs מ (final-mem vs samech vs mem)
3. If the invoice has a LOGO with the company name, prefer the printed text version over the logo.
4. Look for the supplier name near the top of the invoice, often with their address and VAT ID.
5. supplier_name_normalized: remove punctuation and legal suffixes (בע"מ, ltd, etc.) but keep the EXACT spelling.
6. Common Israeli supplier examples: "אולפון", "ניופאן", "פלאפון", "סלקום" — do NOT confuse similar names.

*** DATE EXTRACTION — CRITICAL (INVOICE DATE vs DUE DATE) ***
1. invoice_date = the date the DOCUMENT WAS ISSUED. Read it EXACTLY as printed.
   Labels: "תאריך חשבונית", "תאריך המסמך", "תאריך הפקה", "תאריך", "Invoice Date", "Document Date", "Date".
2. due_date = the PAYMENT date only. Labels: "לתשלום עד", "תאריך לתשלום", "מועד תשלום",
   "תנאי תשלום ... עד", "שוטף + ...", "Due Date", "Payment Due", "Payment Date".
3. NEVER use due_date as invoice_date, and never use invoice_date as due_date.
   If a payment date exists but no issue date is printed → invoice_date = null (do NOT fall back to the due date).
   If no payment date exists → due_date = null.
4. Israeli date formats: DD/MM/YY or DD/MM/YYYY. Convert to ISO: YYYY-MM-DD.
   - "28/04/26" means 2026-04-28
   - "28/04/2026" means 2026-04-28
   - Two-digit years: 20-29 = 2020-2029, 30-99 = 2030-2099
5. NEVER fabricate a date. If you cannot read it clearly, set to null.
6. Ignore "תאריך הדפסה" / print date — it is not the invoice date.

*** AMOUNT EXTRACTION — CRITICAL ***
1. Read ALL amounts EXACTLY as printed. Do NOT calculate or estimate.
2. Look for the FINAL totals section at the bottom of the invoice:
   - "מחיר כולל" or "סה"כ לפני מע"מ" = subtotal_before_vat
   - "מע"מ" or "מע״מ (18%)" = vat_amount
   - "סה"כ כולל מע"מ" or "סה״כ מחיר" or "סה״כ לתשלום" = total_with_vat
3. total_with_vat = the FINAL AMOUNT PAYABLE FOR THIS SPECIFIC DOCUMENT.
   NEVER pick a number just because it is the largest on the page.
   total_with_vat is NOT: turnover / מחזור, accumulated balance / יתרה, previous balance / יתרה קודמת,
   sum of transactions / סכום עסקאות, credit limit / מסגרת אשראי, account total / סה״כ חשבון,
   cumulative or monthly activity summaries, or any reference figure about the account rather than this document.
   Use the label next to the amount, inside the document's own totals block:
   "סה״כ לתשלום", "לתשלום", "סה״כ כולל מע״מ", "סה״כ חשבונית", "Total", "Amount Due", "Grand Total".
   Do not rely on a single keyword: cross-check with the arithmetic
   (subtotal_before_vat + vat_amount must equal total_with_vat) and with the invoice's own line items.
   If several candidate "totals" exist, choose the one consistent with this document's VAT
   breakdown and its line items — never the biggest unrelated figure.
   On commission / collection / settlement statements the payable amount is usually the small net
   amount charged for the period, while the large figures are turnover — never take the turnover.
4. Verify: subtotal + VAT should equal total. If not, re-read the numbers before answering.
5. Israeli number format: commas for thousands (17,987.34), period for decimals.

*** LINE ITEMS — CRITICAL (VAT AWARENESS) ***
1. Read EVERY row in the products table exactly as written.
2. IMPORTANT: Check the column headers carefully!
   - If header says "מחיר ליח' כולל מע"מ" or "מחיר כולל מעמ" or "כולל מע"מ" → prices are WITH VAT
   - If header says "מחיר ליח'" or "מחיר ליחידה" or "לפני מע"מ" → prices are BEFORE VAT
   - Set prices_include_vat = true if the column headers indicate VAT-inclusive pricing
3. For each line item:
   - Read sku, product_name, quantity as-is
   - If prices_include_vat is TRUE:
     - unit_price_with_vat = the price as printed
     - unit_price_before_vat = unit_price_with_vat / 1.18 (calculate)
     - line_total_with_vat = the line total as printed
     - line_total_before_vat = line_total_with_vat / 1.18 (calculate)
   - If prices_include_vat is FALSE:
     - unit_price_before_vat = the price as printed
     - unit_price_with_vat = null
     - line_total_before_vat = the line total as printed
     - line_total_with_vat = null

*** SUPPLIER IDENTIFICATION ***
1. The supplier name is the COMPANY that ISSUED the invoice (the seller), NOT the customer/buyer.
2. Look for the supplier name at the TOP of the invoice, usually with their logo.
3. The supplier VAT ID (עוסק מורשה / ח.פ.) is a 9-digit Israeli number - extract ONLY the digits.
4. Common patterns: "עוסק מורשה:", "ח.פ.:", "מספר חברה:" followed by a 9-digit number.
5. NEVER use document numbers as VAT ID! Document numbers start with "IN", "IL", etc.
6. If you cannot find a clearly labeled 9-digit VAT ID, set supplier_vat_id to null.
7. OUR BUSINESS VAT ID IS: 040638660 — this is the BUYER, never use it as supplier_vat_id.

STRICT OUTPUT RULES
1) Output ONLY a single valid JSON object. No markdown, no code fences, no commentary.
2) Never guess. If not confidently found, use null.
3) Dates must be ISO-8601: YYYY-MM-DD. Two-digit year YY → 20YY.
4) Amounts must be numbers only (no currency symbols, no commas). Use '.' decimal separator.
5) Currency must be a 3-letter ISO code (ILS, USD, EUR...). If not found, null.
6) For multi-page docs: use totals for the entire document.

CLASSIFICATION
- TAX_INVOICE if explicit "חשבונית מס" / "Tax Invoice"
- CREDIT_NOTE if explicit "חשבונית זיכוי" / "Credit Note"
- OTHER otherwise (statement, report, proforma, order confirmation, etc.)

CREDIT SIGN
If CREDIT_NOTE:
- If the displayed total is negative or has a minus sign => credit_sign = "NEGATIVE"
- Otherwise => credit_sign = "POSITIVE"

CONFIDENCE (TELEMETRY ONLY — NEVER AN APPROVAL SIGNAL)
Provide overall_confidence (0..100) and per-field confidence (0..100) for debugging purposes only.
Approval is decided by a deterministic validation gate in the system, not by your confidence.
Do not inflate confidence — if ANY field was hard to read or ambiguous, lower its confidence.

CRITICAL FIELDS
supplier_name, doc_number, invoice_date, total_with_vat, doc_type_he

OUTPUT SCHEMA (EXACT)
{
  "classification": "TAX_INVOICE" | "CREDIT_NOTE" | "OTHER",
  "should_skip": boolean,
  "skip_reason_he": string | null,

  "supplier_name": string | null,
  "supplier_name_normalized": string | null,
  "supplier_vat_id": string | null,

  "doc_type_he": "חשבונית מס" | "חשבונית זיכוי" | null,
  "doc_number": string | null,
  "invoice_date": string | null,
  "due_date": string | null,

  "currency": string | null,
  "subtotal_before_vat": number | null,
  "vat_amount": number | null,
  "total_with_vat": number | null,

  "credit_sign": "NEGATIVE" | "POSITIVE" | null,
  "prices_include_vat": boolean,

  "line_items": [
    {
      "line_number": number,
      "sku": string,
      "product_name": string,
      "quantity": number,
      "unit_price_before_vat": number,
      "unit_price_with_vat": number | null,
      "line_total_before_vat": number,
      "line_total_with_vat": number | null
    }
  ],

  "overall_confidence": number,
  "field_confidence": {
    "supplier_name": number,
    "supplier_vat_id": number,
    "doc_number": number,
    "doc_date": number,
    "currency": number,
    "subtotal_before_vat": number,
    "vat_amount": number,
    "total_with_vat": number,
    "doc_type_he": number
  },

  "display_summary_he": string
}

DISPLAY SUMMARY (HEBREW)
- If invoice/credit note: short Hebrew summary including supplier, date, total, and confidence.
- If OTHER: explain in Hebrew that the document is skipped.

DECISION RULES
- If classification == OTHER:
  should_skip = true
  doc_type_he = null
  display_summary_he must explain skip in Hebrew.
- Else:
  should_skip = false
  doc_type_he must match classification:
    TAX_INVOICE => "חשבונית מס"
    CREDIT_NOTE => "חשבונית זיכוי"`;

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: ['TAX_INVOICE', 'CREDIT_NOTE', 'OTHER'] },
    should_skip: { type: 'boolean' },
    skip_reason_he: { type: 'string' },
    supplier_name: { type: 'string' },
    supplier_name_normalized: { type: 'string' },
    supplier_vat_id: { type: 'string' },
    doc_type_he: { type: 'string' },
    doc_number: { type: 'string' },
    invoice_date: { type: 'string' },
    due_date: { type: 'string' },
    doc_date: { type: 'string' },
    currency: { type: 'string' },
    subtotal_before_vat: { type: 'number' },
    vat_amount: { type: 'number' },
    total_with_vat: { type: 'number' },
    credit_sign: { type: 'string', enum: ['NEGATIVE', 'POSITIVE'] },
    prices_include_vat: { type: 'boolean' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line_number: { type: 'number' },
          sku: { type: 'string' },
          product_name: { type: 'string' },
          quantity: { type: 'number' },
          unit_price_before_vat: { type: 'number' },
          unit_price_with_vat: { type: 'number' },
          line_total_before_vat: { type: 'number' },
          line_total_with_vat: { type: 'number' }
        },
        required: ['line_number', 'sku', 'product_name', 'quantity']
      }
    },
    overall_confidence: { type: 'number' },
    field_confidence: {
      type: 'object',
      properties: {
        supplier_name: { type: 'number' },
        supplier_vat_id: { type: 'number' },
        doc_number: { type: 'number' },
        doc_date: { type: 'number' },
        currency: { type: 'number' },
        subtotal_before_vat: { type: 'number' },
        vat_amount: { type: 'number' },
        total_with_vat: { type: 'number' },
        doc_type_he: { type: 'number' }
      }
    },
    display_summary_he: { type: 'string' }
  },
  required: ['classification', 'should_skip', 'overall_confidence', 'display_summary_he']
};

export function roundMoney(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? Math.round(value * 100) / 100 : undefined;
}

/**
 * Rounding-only tolerance for "sum of line totals ≈ invoice subtotal".
 * Each line can be rounded to the agora, so the allowed drift scales with the
 * number of lines: max(0.02, line_count * 0.02) — never a whole-shekel slack.
 * This is separate from the header check (subtotal + VAT = total), which stays
 * at exactly ARITHMETIC_TOLERANCE = 0.02 in invoiceValidationGate.ts.
 */
export const LINE_ROUNDING_UNIT = 0.02;

export function getLineRoundingTolerance(lineCount) {
  const lines = Number.isFinite(lineCount) && lineCount > 0 ? Math.floor(lineCount) : 0;
  return Math.round(Math.max(LINE_ROUNDING_UNIT, lines * LINE_ROUNDING_UNIT) * 100) / 100;
}

/**
 * Deterministic line validation (Task C).
 * Applicability is explicit: a summary invoice with no usable line structure is NOT a failure —
 * it returns applicable:false with a warning. Real arithmetic contradictions return reason codes.
 * Checks: quantity × unit_price ≈ line_total (per line) and SUM(line_total_before_vat) ≈ subtotal.
 */
export function getLineItemsCheck(extraction) {
  const items = extraction?.line_items || [];
  const subtotal = typeof extraction?.subtotal_before_vat === 'number' ? extraction.subtotal_before_vat : null;
  const failures = [];
  const warnings = [];
  const reason_codes = [];

  if (!items.length) {
    warnings.push('אין שורות מוצר במסמך — בדיקת שורות אינה ישימה.');
    return { applicable: false, hasMismatch: false, delta: 0, tolerance: getLineRoundingTolerance(0), hasBadQuantity: false, hasLineArithmeticMismatch: false, hasAnyFailure: false, failures, warnings, reason_codes };
  }

  // Per-line arithmetic, only where quantity, unit price and line total are all present.
  const lineArithmeticFailures = [];
  for (const [index, item] of items.entries()) {
    const qty = item?.quantity;
    const unit = item?.unit_price_before_vat;
    const total = item?.line_total_before_vat;
    if (typeof qty !== 'number' || typeof unit !== 'number' || typeof total !== 'number') continue;
    const delta = Math.round(Math.abs(qty * unit - total) * 100) / 100;
    if (delta > getLineRoundingTolerance(1)) {
      lineArithmeticFailures.push({ line_number: item.line_number || index + 1, quantity: qty, unit_price_before_vat: unit, line_total_before_vat: total, delta });
    }
  }
  if (lineArithmeticFailures.length) {
    reason_codes.push('LINE_TOTAL_MISMATCH');
    failures.push(`שורות עם אי-התאמה בין כמות × מחיר יחידה לסה״כ שורה: ${lineArithmeticFailures.map((l) => l.line_number).join(', ')}.`);
  }

  const hasBadQuantity = items.some((item) => typeof item.quantity !== 'number' || item.quantity <= 0);
  if (hasBadQuantity) {
    reason_codes.push('LINE_QUANTITY_INVALID');
    failures.push('קיימות שורות מוצר עם כמות חסרה או לא תקינה.');
  }

  if (subtotal === null) {
    warnings.push('אין סה״כ לפני מע״מ להשוואה מול סכום השורות.');
    return { applicable: lineArithmeticFailures.length > 0 || hasBadQuantity, hasMismatch: false, delta: 0, tolerance: getLineRoundingTolerance(items.length), hasBadQuantity, hasLineArithmeticMismatch: lineArithmeticFailures.length > 0, hasAnyFailure: failures.length > 0, failures, warnings, reason_codes, line_arithmetic_failures: lineArithmeticFailures };
  }

  const lineSum = items.reduce((sum, item) => {
    const total = typeof item.line_total_before_vat === 'number'
      ? item.line_total_before_vat
      : (typeof item.unit_price_before_vat === 'number' && typeof item.quantity === 'number' ? item.unit_price_before_vat * item.quantity : 0);
    return sum + total;
  }, 0);
  const delta = Math.round(Math.abs(lineSum - subtotal) * 100) / 100;
  const tolerance = getLineRoundingTolerance(items.length);
  const hasMismatch = delta > tolerance;
  if (hasMismatch) {
    reason_codes.push('LINE_SUM_MISMATCH');
    failures.push(`סכום שורות המוצרים (${roundMoney(lineSum)}) אינו תואם לסה״כ לפני מע״מ (${subtotal}), הפרש ${delta} ש״ח.`);
  }
  return { applicable: true, hasMismatch, delta, tolerance, lineSum: roundMoney(lineSum), hasBadQuantity, hasLineArithmeticMismatch: lineArithmeticFailures.length > 0, hasAnyFailure: failures.length > 0, failures, warnings, reason_codes, line_arithmetic_failures: lineArithmeticFailures };
}

/** invoice_date and due_date are strictly separate; due_date must never become the invoice date. */
export function normalizeExtractionDates(extraction) {
  const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
  extraction.due_date = isIsoDate(extraction.due_date) ? extraction.due_date.trim() : null;
  let invoiceDate = isIsoDate(extraction.invoice_date) ? extraction.invoice_date.trim() : null;
  if (!invoiceDate && isIsoDate(extraction.doc_date) && extraction.doc_date.trim() !== extraction.due_date) {
    invoiceDate = extraction.doc_date.trim();
  }
  extraction.invoice_date = invoiceDate;
  extraction.doc_date = invoiceDate;
  return extraction;
}