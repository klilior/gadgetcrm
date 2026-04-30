import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const EXTRACT_PROMPT = `SYSTEM / INSTRUCTION

You are an EXTREMELY PRECISE invoice data extraction engine. Your job is to read the EXACT text from the document — never guess, never approximate, never hallucinate.

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

*** DATE EXTRACTION — MOST CRITICAL ***
1. The document date (doc_date) MUST be read EXACTLY as printed on the invoice.
2. Look for labels like "תאריך חשבונית:", "תאריך:", "Date:" — read the date next to them.
3. Israeli date formats: DD/MM/YY or DD/MM/YYYY. Convert to ISO: YYYY-MM-DD.
   - "28/04/26" means 2026-04-28 (NOT 2023!)
   - "28/04/2026" means 2026-04-28
   - "15/01/25" means 2025-01-15
   - Two-digit years: 20-29 = 2020-2029, 30-99 = 2030-2099
4. NEVER fabricate a date. If you cannot read it clearly, set to null.
5. Cross-check: if the document has multiple date fields (תאריך חשבונית, תאריך הדפסה), use "תאריך חשבונית" as the primary date.

*** AMOUNT EXTRACTION — CRITICAL ***
1. Read ALL amounts EXACTLY as printed. Do NOT calculate or estimate.
2. Look for the FINAL totals section at the bottom of the invoice:
   - "מחיר כולל" or "סה"כ לפני מע"מ" = subtotal_before_vat
   - "מע"מ" or "מע״מ (18%)" = vat_amount
   - "סה"כ כולל מע"מ" or "סה״כ מחיר" = total_with_vat
3. The total_with_vat is the FINAL number the customer pays (the largest amount).
4. Verify: subtotal + VAT should approximately equal total. If not, re-read the numbers.
5. Israeli number format: commas for thousands (17,987.34), period for decimals.

*** LINE ITEMS — CRITICAL ***
1. Read EVERY row in the products table exactly as written.
2. For each line: read the SKU/מק"ט, product name, quantity, unit price, and line total.
3. The unit price (מחיר ליח') is BEFORE VAT (לפני מע"מ), not the final price.
4. quantity × unit_price_before_vat should approximately equal line_total_before_vat.

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

CONFIDENCE
Provide overall_confidence (0..100) and per-field confidence (0..100).
Do not inflate confidence — if ANY field was hard to read or ambiguous, lower its confidence.
If you had to guess or approximate ANY value, set overall_confidence below 80.

CRITICAL FIELDS
supplier_name, doc_number, doc_date, total_with_vat, doc_type_he

ADDITIONAL: EXTRACT LINE ITEMS
You MUST also extract ALL line items (products/services) from the invoice.
Each line item should include:
- line_number: sequential number (1, 2, 3...)
- sku: product code/SKU/מק"ט (exactly as appears on document, including barcode numbers)
- product_name: product description/name (exactly as written)
- quantity: number of units
- unit_price_before_vat: price per unit before VAT (number)
- line_total_before_vat: total for this line before VAT (number)

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
  "doc_date": string | null,

  "currency": string | null,
  "subtotal_before_vat": number | null,
  "vat_amount": number | null,
  "total_with_vat": number | null,

  "credit_sign": "NEGATIVE" | "POSITIVE" | null,

  "line_items": [
    {
      "line_number": number,
      "sku": string,
      "product_name": string,
      "quantity": number,
      "unit_price_before_vat": number,
      "line_total_before_vat": number
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


const EXTRACT_SCHEMA = {
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
    doc_date: { type: 'string' },
    currency: { type: 'string' },
    subtotal_before_vat: { type: 'number' },
    vat_amount: { type: 'number' },
    total_with_vat: { type: 'number' },
    credit_sign: { type: 'string', enum: ['NEGATIVE', 'POSITIVE'] },
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
          line_total_before_vat: { type: 'number' }
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

const VALIDATE_PROMPT = `SYSTEM / INSTRUCTION

You are a validation and normalization engine for extracted invoice header data.

INPUT
You will receive a JSON object that matches the extraction schema from the previous step.

IMPORTANT UI LANGUAGE RULE
All UI text must be Hebrew (RTL).
Output JSON keys must be English.

TASKS
1) Validate math consistency:
   subtotal_before_vat + vat_amount ≈ total_with_vat
   tolerance: 5.0 (up to 5 NIS difference is acceptable due to rounding)
2) Validate critical fields presence:
   supplier_name, doc_type_he, doc_number, doc_date, total_with_vat
3) Recommend invoice extraction status in Hebrew.

STRICT OUTPUT RULES
Output ONLY one valid JSON object.

OUTPUT SCHEMA
{
  "is_math_consistent": boolean,
  "math_delta": number | null,
  "missing_critical_fields": string[],
  "recommended_extraction_status_he": "נקרא בהצלחה" | "ממתין לאימות",
  "review_reasons_he": string[],
  "display_validation_he": string
}

LOGIC
If any critical field missing OR is_math_consistent=false => "ממתין לאימות"
Else => "נקרא בהצלחה"`;

const VALIDATE_SCHEMA = {
  type: 'object',
  properties: {
    is_math_consistent: { type: 'boolean' },
    math_delta: { type: 'number' },
    missing_critical_fields: { type: 'array', items: { type: 'string' } },
    recommended_extraction_status_he: { type: 'string', enum: ['נקרא בהצלחה', 'ממתין לאימות'] },
    review_reasons_he: { type: 'array', items: { type: 'string' } },
    display_validation_he: { type: 'string' }
  },
  required: ['is_math_consistent', 'missing_critical_fields', 'recommended_extraction_status_he', 'display_validation_he']
};

Deno.serve(async (req) => {
    // Read body BEFORE creating base44 client (body can only be read once)
    let body = {};
    try {
      body = await req.json();
    } catch (_) {
      try {
        // Fallback: body may have already been consumed
        body = {};
      } catch (__) {}
    }
    const base44 = createClientFromRequest(req);
    try {
      const invoiceId = body.invoice_id;
      if (!invoiceId) return Response.json({ error: 'Missing invoice_id' }, { status: 400 });
    
    console.log(`Starting extraction for invoice: ${invoiceId}`);

    const invList = await base44.asServiceRole.entities.Invoices.filter({ id: invoiceId });
    const invoice = invList?.[0];
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });

    // Allow re-run for any non-finalized status
    if (invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה') {
      // Check if force re-run was requested
      if (!body.force) {
        return Response.json({ success: true, skipped: true, reason: 'Finalized' });
      }
      // Reset status to allow re-extraction
      await base44.asServiceRole.entities.Invoices.update(invoice.id, { extraction_status: 'ממתין לאימות' });
    }
    if (!invoice.source_intake) {
      return Response.json({ success: true, skipped: true, reason: 'No source intake' });
    }

    const intakeList = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: invoice.source_intake });
    const intake = intakeList?.[0];
    if (!intake) return Response.json({ success: false, error: 'Source intake not found' }, { status: 404 });

    // DEBUG: Check file presence
    const filePresent = !!(intake.file && typeof intake.file === 'string' && intake.file.trim().length > 0);
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_input_file_present: filePresent });

    if (!filePresent) {
      const errMsg = 'אין קובץ בשדה file בקליטה / הקובץ לא זמין ל-AI';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'דולג',
        ai_debug_last_error_he: errMsg
      });
      return Response.json({ success: false, skipped: true, reason: 'No file on intake', ai_debug_last_error_he: errMsg });
    }

    // Idempotency: run only if doc_number OR total_with_vat missing (unless force re-run)
    const hasDocNumber = !!(invoice.doc_number && String(invoice.doc_number).trim());
    const hasTotal = typeof invoice.total_with_vat === 'number' && !Number.isNaN(invoice.total_with_vat);
    if (hasDocNumber && hasTotal && !body.force) {
      return Response.json({ success: true, skipped: true, reason: 'Already populated' });
    }

    // Step 1: Extraction - with automatic PDF to image conversion fallback
    let extraction;
    let fileUrlToUse = intake.file;
    
    // Check if PDF file (by extension or mime type)
    const isPdf = (intake.file_mime && intake.file_mime.toLowerCase().includes('pdf')) || 
                  (intake.file_name && intake.file_name.toLowerCase().endsWith('.pdf')) ||
                  (intake.file && intake.file.toLowerCase().includes('.pdf'));
    
    // If PDF, convert to image first using GenerateImage with the PDF as reference
    if (isPdf) {
      try {
        // Use ExtractDataFromUploadedFile to get text, then generate summary image approach
        // Actually, let's try direct LLM call first, if fails we'll use a workaround
        console.log('PDF detected, attempting direct extraction first...');
      } catch (_) {}
    }
    
    // Helper function to convert PDF to image using pdf2pic-like approach
    const convertPdfToImage = async (pdfUrl) => {
      try {
        // Fetch PDF as blob
        const pdfResponse = await fetch(pdfUrl);
        if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
        const pdfBlob = await pdfResponse.blob();
        
        // Create a File object with lowercase extension
        const fileName = intake.file_name?.replace(/\.PDF$/i, '.pdf') || 'document.pdf';
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
        
        // Upload with corrected filename
        const uploadResult = await base44.integrations.Core.UploadFile({ file: pdfFile });
        return uploadResult?.file_url || null;
      } catch (err) {
        console.log('PDF re-upload failed:', err.message);
        return null;
      }
    };
    
    try {
      extraction = await base44.integrations.Core.InvokeLLM({
        prompt: EXTRACT_PROMPT,
        add_context_from_internet: false,
        response_json_schema: EXTRACT_SCHEMA,
        file_urls: [fileUrlToUse],
        model: 'gpt_5_4'
      });
    } catch (llmErr) {
      const errMsg = llmErr?.message || String(llmErr);
      
      // Check if it's an unsupported file type error (PDF issue)
      if (errMsg.includes('Unsupported file type') || errMsg.includes('PDF') || errMsg.includes('.pdf')) {
        console.log('PDF extraction failed, trying re-upload with corrected extension...');
        
        // First try: re-upload with lowercase extension
        const correctedUrl = await convertPdfToImage(intake.file);
        if (correctedUrl) {
          try {
            extraction = await base44.integrations.Core.InvokeLLM({
              prompt: EXTRACT_PROMPT,
              add_context_from_internet: false,
              response_json_schema: EXTRACT_SCHEMA,
              file_urls: [correctedUrl],
              model: 'gpt_5_4'
            });
            console.log('PDF extraction succeeded after re-upload');
          } catch (retryErr) {
            console.log('Re-upload extraction failed, trying ExtractDataFromUploadedFile...');
          }
        }
        
        // Second fallback: try ExtractDataFromUploadedFile
        if (!extraction) {
          try {
            console.log('Trying ExtractDataFromUploadedFile as final fallback...');
            const extractedData = await base44.integrations.Core.ExtractDataFromUploadedFile({
              file_url: correctedUrl || intake.file,
              json_schema: EXTRACT_SCHEMA
            });
            
            if (extractedData?.status === 'success' && extractedData?.output) {
              extraction = extractedData.output;
              console.log('PDF extraction via ExtractDataFromUploadedFile succeeded');
            } else {
              throw new Error(extractedData?.details || 'ExtractDataFromUploadedFile failed');
            }
          } catch (fallbackErr) {
            const fallbackErrMsg = `שגיאת AI בחילוץ PDF: ${fallbackErr?.message || String(fallbackErr)}`;
            await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { 
              ai_debug_last_error_he: fallbackErrMsg,
              status: 'מוכן לניתוח',
              status_reason: 'קובץ PDF לא נתמך לניתוח אוטומטי. יש להעלות כתמונה.'
            });
            throw fallbackErr;
          }
        }
      } else {
        const aiErrMsg = `שגיאת AI בחילוץ: ${errMsg}`;
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: aiErrMsg });
        throw llmErr;
      }
    }

    if (!extraction || typeof extraction !== 'object') {
      const errMsg = 'תגובת AI לא תקינה או ריקה';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: errMsg });
      throw new Error('Invalid extraction response');
    }

    // DEBUG: Save raw extraction JSON
    const extractionJson = JSON.stringify(extraction);
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_extraction_json: extractionJson });
    await base44.asServiceRole.entities.Invoices.update(invoice.id, { ai_debug_last_extraction_json: extractionJson });

    // Step 2: Skip handling
    if (extraction.classification === 'OTHER' || extraction.should_skip === true) {
      const skipReason = extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי ולכן דולג.';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'דולג',
        status_reason: skipReason,
        ai_debug_last_error_he: skipReason
      });
      const newNotes = `מסמך דולג: ${skipReason}`;
      await base44.asServiceRole.entities.Invoices.update(invoice.id, { 
        extraction_status: 'נדחה',
        notes: (invoice.notes ? invoice.notes + '\n' : '') + newNotes 
      });
      return Response.json({ success: true, skipped: true, reason: 'OTHER', extraction });
    }

    // Step 3: Deterministic validation (no LLM - avoids math miscalculations)
    const validation = (() => {
      const sub = extraction.subtotal_before_vat;
      const vat = extraction.vat_amount;
      const total = extraction.total_with_vat;
      
      // Math consistency: subtotal + vat ≈ total (tolerance 5 NIS for rounding)
      let isMathConsistent = true;
      let mathDelta = null;
      
      if (typeof sub === 'number' && typeof vat === 'number' && typeof total === 'number') {
        mathDelta = Math.abs((sub + vat) - total);
        mathDelta = Math.round(mathDelta * 100) / 100;
        isMathConsistent = mathDelta <= 5.0;
      } else if (typeof total === 'number') {
        // If only total exists, consider it consistent (we just don't have the breakdown)
        isMathConsistent = true;
        mathDelta = 0;
      }
      
      // Critical fields check
      const criticalFields = ['supplier_name', 'doc_type_he', 'doc_number', 'doc_date', 'total_with_vat'];
      const missing = criticalFields.filter(f => {
        const val = extraction[f];
        return val === null || val === undefined || val === '' || val === 'null';
      });
      
      // Determine status
      const allGood = missing.length === 0 && isMathConsistent;
      const reviewReasons = [];
      if (!isMathConsistent) reviewReasons.push(`סכום כולל אינו תואם לסכום לפני מע"מ וסכום המע"מ (הפרש: ${mathDelta} ש"ח).`);
      if (missing.length > 0) reviewReasons.push(`שדות חסרים: ${missing.join(', ')}`);
      
      const displayValidation = allGood ? 'חשבונית תקנית' : `חשבונית לא תקנית: ${reviewReasons.join('; ')}`;
      
      return {
        is_math_consistent: isMathConsistent,
        math_delta: mathDelta,
        missing_critical_fields: missing,
        recommended_extraction_status_he: allGood ? 'נקרא בהצלחה' : 'ממתין לאימות',
        review_reasons_he: reviewReasons,
        display_validation_he: displayValidation
      };
    })();
    
    console.log('Deterministic validation result:', JSON.stringify(validation));

    // DEBUG: Save raw validation JSON
    const validationJson = JSON.stringify(validation);
    await base44.asServiceRole.entities.Invoices.update(invoice.id, { ai_debug_last_validation_json: validationJson });

    // Step 4: Supplier linking - improved with learned patterns, normalized VAT ID matching and aliases
    let supplierId = null;
    const rawVatId = extraction.supplier_vat_id && String(extraction.supplier_vat_id).trim();
    
    // Extract only digits for VAT ID (Israeli VAT IDs are 9 digits)
    const digitsOnly = rawVatId ? rawVatId.replace(/\D/g, '') : '';
    // Normalize: if we have 9 digits, use them; otherwise keep the raw value for matching
    const normalizedVatId = digitsOnly.length === 9 ? digitsOnly : (rawVatId ? rawVatId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : null);
    
    // CRITICAL: Check if extracted VAT ID is actually OUR company's VAT ID (buyer, not supplier)
    const OUR_VAT_ID = '040638660';
    if (normalizedVatId === OUR_VAT_ID || rawVatId === OUR_VAT_ID) {
      console.log(`WARNING: Extracted VAT ID ${rawVatId} is OUR company's VAT ID, not supplier's. Ignoring.`);
      // Don't use this VAT ID for supplier matching - it's ours!
      // Fall through to name-based matching instead
    }
    
    // First, try to find supplier by learned patterns (highest priority)
    const learnedPatterns = await base44.asServiceRole.entities.SupplierPattern.filter({ is_active: true }, undefined, 500);
    
    // Check VAT ID patterns first
    if (normalizedVatId) {
      const vatPattern = learnedPatterns.find(p => 
        p.pattern_type === 'vat_id' && 
        (p.pattern_value === normalizedVatId || p.pattern_value === rawVatId)
      );
      if (vatPattern) {
        supplierId = vatPattern.supplier_id;
        console.log(`Supplier matched by learned VAT pattern: ${supplierId}`);
      }
    }
    
    // Check name patterns if no VAT match
    if (!supplierId && extraction.supplier_name) {
      const supplierName = extraction.supplier_name.trim();
      const normalizedName = extraction.supplier_name_normalized?.trim();
      
      const namePattern = learnedPatterns.find(p => {
        if (p.pattern_type !== 'name_pattern') return false;
        const patternLower = p.pattern_value.toLowerCase();
        const nameLower = supplierName.toLowerCase();
        const normLower = normalizedName?.toLowerCase() || '';
        return patternLower === nameLower || patternLower === normLower ||
               patternLower.includes(nameLower) || nameLower.includes(patternLower) ||
               (normLower && (patternLower.includes(normLower) || normLower.includes(patternLower)));
      });
      if (namePattern) {
        supplierId = namePattern.supplier_id;
        console.log(`Supplier matched by learned name pattern: ${supplierId}`);
      }
    }
    
    // Helper: check if a supplier matches by VAT ID or aliases
    const matchesSupplier = (supplier, vatId, supplierName) => {
      // Match by VAT ID
      if (vatId && supplier.vat_id) {
        const supplierVatDigits = supplier.vat_id.replace(/\D/g, '');
        if (supplierVatDigits === vatId || supplier.vat_id === vatId) return true;
      }
      // Match by aliases (pipe-separated)
      if (supplier.aliases && vatId) {
        const aliasesList = supplier.aliases.split('|').map(a => a.trim().toUpperCase());
        if (aliasesList.includes(vatId) || aliasesList.includes(rawVatId?.toUpperCase())) return true;
      }
      // Match by name in aliases
      if (supplier.aliases && supplierName) {
        const normalizedSearchName = supplierName.replace(/['"״׳\-\.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const aliasesList = supplier.aliases.split('|').map(a => a.trim().toLowerCase());
        if (aliasesList.some(alias => alias.includes(normalizedSearchName) || normalizedSearchName.includes(alias))) return true;
      }
      return false;
    };
    
    const allSuppliers = await base44.asServiceRole.entities.Suppliers.filter({ is_active: true }, undefined, 500);
    
    // If already found by patterns, skip to supplier update
    if (supplierId) {
      // Verify supplier still exists
      const foundSupplier = allSuppliers.find(s => s.id === supplierId);
      if (!foundSupplier) {
        supplierId = null; // Pattern points to deleted supplier, continue with normal search
      }
    }
    
    // Only use VAT ID for matching if it's NOT our company's VAT ID
    const isOurVatId = normalizedVatId === OUR_VAT_ID || rawVatId === OUR_VAT_ID;
    
    if (!supplierId && normalizedVatId && !isOurVatId) {
      // Try to find by exact vat_id first
      let found = allSuppliers.filter(s => {
        if (!s.vat_id) return false;
        const sVatDigits = s.vat_id.replace(/\D/g, '');
        return sVatDigits === normalizedVatId || s.vat_id === rawVatId;
      });
      
      // If not found, check aliases
      if (found.length === 0) {
        found = allSuppliers.filter(s => matchesSupplier(s, normalizedVatId, extraction.supplier_name));
      }
      
      if (found.length > 0) {
        supplierId = found[0].id;
        // Update supplier name if current is generic and we have a better one
        const currentName = found[0].name || '';
        const newName = extraction.supplier_name || '';
        const hasHebrew = /[\u0590-\u05FF]/.test(newName);
        const currentHasHebrew = /[\u0590-\u05FF]/.test(currentName);
        if (hasHebrew && !currentHasHebrew && newName.length > currentName.length) {
          await base44.asServiceRole.entities.Suppliers.update(supplierId, { name: newName });
        }
      } else {
        // Use the 9-digit VAT ID if available
        const vatIdToSave = digitsOnly.length === 9 ? digitsOnly : rawVatId;
        const created = await base44.asServiceRole.entities.Suppliers.create({
          name: extraction.supplier_name || 'לא ידוע',
          vat_id: vatIdToSave,
          created_from_invoice: true,
          is_active: true
        });
        supplierId = created.id;
      }
    } else if (!supplierId) {
      // No VAT ID and no pattern match - try to match by normalized name or aliases
      const supplierName = extraction.supplier_name || '';
      const normalizedName = supplierName.replace(/['"״׳\-\.]/g, '').replace(/בע"?מ|בעמ|ltd|llc|inc/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
      
      if (normalizedName) {
        // Check aliases first
        let found = allSuppliers.find(s => matchesSupplier(s, null, supplierName));
        
        // Then check by name
        if (!found) {
          found = allSuppliers.find(s => {
            const sName = (s.name || '').replace(/['"״׳\-\.]/g, '').replace(/בע"?מ|בעמ|ltd|llc|inc/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
            return sName === normalizedName || sName.includes(normalizedName) || normalizedName.includes(sName);
          });
        }
        
        if (found) {
          supplierId = found.id;
        } else {
          const created = await base44.asServiceRole.entities.Suppliers.create({
            name: extraction.supplier_name || 'לא ידוע',
            created_from_invoice: true,
            is_active: true
          });
          supplierId = created.id;
        }
      } else {
        const created = await base44.asServiceRole.entities.Suppliers.create({
          name: extraction.supplier_name || 'לא ידוע',
          created_from_invoice: true,
          is_active: true
        });
        supplierId = created.id;
      }
    }

    // Step 4b: Duplicate check - same doc_number + same supplier (by vat_id)
    const extractedDocNumber = extraction.doc_number?.trim();
    const extractedVatId = normalizedVatId && !isOurVatId ? normalizedVatId : null;
    
    if (extractedDocNumber && supplierId) {
      // Find all existing invoices with the same doc_number
      const existingWithSameDocNum = await base44.asServiceRole.entities.Invoices.filter({ doc_number: extractedDocNumber }, undefined, 50);
      const duplicate = existingWithSameDocNum.find(inv => 
        inv.id !== invoice.id && 
        inv.supplier === supplierId && 
        inv.extraction_status !== 'נדחה'
      );
      
      if (duplicate) {
        const dupKey = `${extractedDocNumber}|${extractedVatId || supplierId}`;
        const dupNote = `כפילות - חשבונית ${extractedDocNumber} מספק זה כבר קיימת במערכת (מזהה: ${duplicate.id}). נדחתה אוטומטית.`;
        await base44.asServiceRole.entities.Invoices.update(invoice.id, {
          supplier: supplierId,
          doc_type: extraction.doc_type_he || undefined,
          doc_number: extractedDocNumber,
          doc_date: extraction.doc_date || undefined,
          currency: extraction.currency || undefined,
          subtotal_before_vat: extraction.subtotal_before_vat ?? undefined,
          vat_amount: extraction.vat_amount ?? undefined,
          total_with_vat: extraction.total_with_vat ?? undefined,
          confidence_score: extraction.overall_confidence ?? undefined,
          extraction_status: 'נדחה',
          duplicate_key: dupKey,
          notes: dupNote,
          ai_debug_last_extraction_json: JSON.stringify(extraction),
          ai_debug_last_validation_json: JSON.stringify(validation)
        });
        // Update intake
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
          status: 'כפילות',
          status_reason: dupNote
        });
        console.log(`Duplicate invoice rejected: ${extractedDocNumber} for supplier ${supplierId}`);
        return Response.json({ success: true, skipped: true, reason: 'duplicate', duplicate_of: duplicate.id, doc_number: extractedDocNumber });
      }
    }

    // Step 5: Update invoice (mapping + safe auto-approval)
    const baseNotes = `${extraction.display_summary_he || ''}\n${validation.display_validation_he || ''}`.trim();

    // Determine final status and notes
    const fieldsComplete = !!(extraction.doc_type_he && extraction.doc_number && extraction.doc_date && (typeof extraction.total_with_vat === 'number'));
    // Auto-approve if: deterministic validation passed (math OK + all fields present) AND
    // AI confidence >= 75 (lowered from 90 because GPT-4o gives more conservative/honest scores;
    // the real safety net is the deterministic math + fields check above)
    const canAutoApprove = (
      validation.recommended_extraction_status_he === 'נקרא בהצלחה' &&
      (typeof extraction.overall_confidence === 'number' ? extraction.overall_confidence >= 75 : false) &&
      validation.is_math_consistent === true &&
      fieldsComplete
    );

    const finalStatus = canAutoApprove ? 'אושר' : validation.recommended_extraction_status_he;
    const finalNotes = canAutoApprove ? `${baseNotes}\nאושר אוטומטית (ודאות גבוהה).` : baseNotes;

    const updatePayload = {
      supplier: supplierId,
      doc_type: extraction.doc_type_he || undefined,
      doc_number: extraction.doc_number || undefined,
      doc_date: extraction.doc_date || undefined,
      currency: extraction.currency || undefined,
      subtotal_before_vat: extraction.subtotal_before_vat ?? undefined,
      vat_amount: extraction.vat_amount ?? undefined,
      total_with_vat: extraction.total_with_vat ?? undefined,
      confidence_score: extraction.overall_confidence ?? undefined,
      extraction_status: finalStatus,
      notes: finalNotes
    };

    await base44.asServiceRole.entities.Invoices.update(invoice.id, updatePayload);

    // Step 6: Create InvoiceLine records and update SupplierProductPrice + PriceAlert
    const lineItems = extraction.line_items || [];
    const priceAlerts = [];
    
    for (const item of lineItems) {
      if (!item.sku || !item.product_name) continue;
      
      // Create InvoiceLine
      await base44.asServiceRole.entities.InvoiceLine.create({
        invoice_id: invoice.id,
        line_number: item.line_number || 1,
        sku: item.sku,
        product_name: item.product_name,
        quantity: item.quantity || 1,
        unit_price_before_vat: item.unit_price_before_vat || null,
        line_total_before_vat: item.line_total_before_vat || null,
        supplier_id: supplierId
      });
      
      // Check/update SupplierProductPrice
      const existingPrice = await base44.asServiceRole.entities.SupplierProductPrice.filter({
        supplier_id: supplierId,
        sku: item.sku
      }, undefined, 1);
      
      const newPrice = item.unit_price_before_vat || (item.line_total_before_vat && item.quantity ? item.line_total_before_vat / item.quantity : null);
      
      if (existingPrice && existingPrice.length > 0) {
        const oldPriceRecord = existingPrice[0];
        const oldPrice = oldPriceRecord.last_price_before_vat;

        // Calculate min/max prices
        const currentMin = oldPriceRecord.min_price_before_vat || oldPrice || newPrice;
        const currentMax = oldPriceRecord.max_price_before_vat || oldPrice || newPrice;
        const newMin = newPrice ? Math.min(currentMin, newPrice) : currentMin;
        const newMax = newPrice ? Math.max(currentMax, newPrice) : currentMax;

        // Check for price change
        if (oldPrice && newPrice && oldPrice !== newPrice) {
          const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
          const direction = newPrice > oldPrice ? 'עלה' : 'ירד';

          // Update price record
          await base44.asServiceRole.entities.SupplierProductPrice.update(oldPriceRecord.id, {
            previous_price_before_vat: oldPrice,
            last_price_before_vat: newPrice,
            min_price_before_vat: newMin,
            max_price_before_vat: newMax,
            price_change_percent: Math.round(changePercent * 100) / 100,
            price_change_direction: direction,
            last_invoice_id: invoice.id,
            last_invoice_date: extraction.doc_date || null,
            purchase_count: (oldPriceRecord.purchase_count || 0) + 1
          });
          
          // Log price change (PriceAlert entity is used for Zap monitoring, not invoices)
          if (Math.abs(changePercent) >= 1) {
            priceAlerts.push({ sku: item.sku, from: oldPrice, to: newPrice, change: `${changePercent.toFixed(1)}%` });
          }
        } else if (newPrice) {
          // No change, just update last invoice and min/max
          await base44.asServiceRole.entities.SupplierProductPrice.update(oldPriceRecord.id, {
            last_invoice_id: invoice.id,
            last_invoice_date: extraction.doc_date || null,
            min_price_before_vat: newMin,
            max_price_before_vat: newMax,
            purchase_count: (oldPriceRecord.purchase_count || 0) + 1,
            price_change_direction: 'ללא שינוי'
          });
        }
        } else if (newPrice) {
        // New product - create price record
        await base44.asServiceRole.entities.SupplierProductPrice.create({
          supplier_id: supplierId,
          sku: item.sku,
          product_name: item.product_name,
          last_price_before_vat: newPrice,
          min_price_before_vat: newPrice,
          max_price_before_vat: newPrice,
          last_invoice_id: invoice.id,
          last_invoice_date: extraction.doc_date || null,
          first_seen_date: extraction.doc_date || new Date().toISOString().split('T')[0],
          purchase_count: 1,
          price_change_direction: 'ללא שינוי'
        });
        }
    }

    // Step 7: Update intake status_reason
    let intakeReason = '';
    if (validation.recommended_extraction_status_he === 'נקרא בהצלחה') {
      intakeReason = 'המסמך נותח ונקלט לחשבונית. ממתין לאישור סופי לפי הצורך.';
    } else {
      const topReason = (validation.review_reasons_he && validation.review_reasons_he[0]) || 'נדרש אימות ידני.';
      intakeReason = `המסמך נותח אך נדרש אימות ידני: ${topReason}`;
    }
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { status_reason: intakeReason });

    return Response.json({ 
      success: true, 
      invoice_id: invoice.id, 
      supplier_id: supplierId, 
      line_items_count: lineItems.length,
      price_alerts: priceAlerts,
      extraction, 
      validation 
    });
  } catch (error) {
    try {
      const text2 = await req.text().catch(() => null);
      const body2 = text2 ? JSON.parse(text2) : {};
      const invoiceId = body2?.invoice_id;
      if (invoiceId) {
        const invList = await createClientFromRequest(req).asServiceRole.entities.Invoices.filter({ id: invoiceId });
        const invoice = invList?.[0];
        if (invoice?.source_intake) {
          await createClientFromRequest(req).asServiceRole.entities.InvoiceIntakeRaw.update(invoice.source_intake, {
            status: 'דולג',
            status_reason: 'שגיאת ניתוח מסמך. נדרש טיפול ידני.'
          });
        }
      }
    } catch (_) {}
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});