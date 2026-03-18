import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const MULTI_INVOICE_DETECT_PROMPT = `SYSTEM / INSTRUCTION

You are a document analysis engine that detects how many separate invoices/credit notes exist in a scanned document.

INPUT
You will receive ONE document file (PDF/JPG/PNG) that may contain MULTIPLE invoices or credit notes scanned together.

GOAL
Count how many SEPARATE invoices or credit notes appear in this document.
Look for visual separations, different invoice numbers, different dates, different suppliers, page breaks between invoices.

OUTPUT SCHEMA (EXACT)
{
  "invoice_count": number,
  "invoices_detected": [
    {
      "index": number,
      "page_hint": string | null,
      "supplier_hint": string | null,
      "doc_number_hint": string | null
    }
  ],
  "is_single_invoice": boolean,
  "detection_confidence": number
}

RULES
- invoice_count: total number of separate invoices/credit notes detected
- If only 1 invoice found, is_single_invoice = true
- detection_confidence: 0-100
- For each invoice detected, provide hints about where it is and key identifiers`;

const MULTI_INVOICE_DETECT_SCHEMA = {
  type: 'object',
  properties: {
    invoice_count: { type: 'number' },
    invoices_detected: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          page_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          supplier_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          doc_number_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    },
    is_single_invoice: { type: 'boolean' },
    detection_confidence: { type: 'number' }
  },
  required: ['invoice_count', 'is_single_invoice', 'detection_confidence']
};

const EXTRACT_PROMPT = `SYSTEM / INSTRUCTION

You are an invoice header extraction engine.

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

STRICT OUTPUT RULES
1) Output ONLY a single valid JSON object. No markdown, no code fences, no commentary.
2) Never guess. If not confidently found, use null.
3) Dates must be ISO-8601: YYYY-MM-DD.
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
Do not inflate confidence if key fields are missing.

CRITICAL FIELDS
supplier_name, doc_number, doc_date, total_with_vat, doc_type_he

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
    classification: { enum: ['TAX_INVOICE', 'CREDIT_NOTE', 'OTHER'] },
    should_skip: { type: 'boolean' },
    skip_reason_he: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    supplier_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    supplier_name_normalized: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    supplier_vat_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    doc_type_he: { anyOf: [{ enum: ['חשבונית מס', 'חשבונית זיכוי'] }, { type: 'null' }] },
    doc_number: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    doc_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    subtotal_before_vat: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    vat_amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    total_with_vat: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    credit_sign: { anyOf: [{ enum: ['NEGATIVE', 'POSITIVE'] }, { type: 'null' }] },
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
        doc_type_he: { type: 'number' },
      },
      additionalProperties: true,
    },
    display_summary_he: { type: 'string' },
  },
  required: ['classification', 'should_skip', 'overall_confidence', 'field_confidence', 'display_summary_he'],
  additionalProperties: true,
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
   tolerance: 1.0
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
    math_delta: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    missing_critical_fields: { type: 'array', items: { type: 'string' } },
    recommended_extraction_status_he: { enum: ['נקרא בהצלחה', 'ממתין לאימות'] },
    review_reasons_he: { type: 'array', items: { type: 'string' } },
    display_validation_he: { type: 'string' },
  },
  required: ['is_math_consistent', 'missing_critical_fields', 'recommended_extraction_status_he', 'review_reasons_he', 'display_validation_he'],
  additionalProperties: true,
};

// Helper function to process a single invoice extraction
async function processSingleInvoice(base44, intake, invoice, extraction, invoiceIndex = null) {
  if (extraction.classification === 'OTHER' || extraction.should_skip === true) {
    // Update intake as skipped
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
      status: 'דולג',
      status_reason: extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי ולכן דולג.'
    });
    // Mark the invoice as rejected
    await base44.asServiceRole.entities.Invoices.update(invoice.id, {
      extraction_status: 'נדחה',
      notes: `מסמך דולג: ${extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי'}`,
      ai_debug_last_extraction_json: JSON.stringify(extraction)
    });
    return { success: true, skipped: true, reason: 'OTHER', extraction };
  }

  // Validation
  const validationPrompt = `${VALIDATE_PROMPT}\n\nHere is the extracted JSON (use as input):\n\n${JSON.stringify(extraction)}`;
  const validation = await base44.integrations.Core.InvokeLLM({
    prompt: validationPrompt,
    add_context_from_internet: false,
    response_json_schema: VALIDATE_SCHEMA,
  });

  if (!validation || typeof validation !== 'object') throw new Error('Invalid validation response');

  // Supplier linking with pattern learning
  let supplierId = null;
  const vatId = extraction.supplier_vat_id && String(extraction.supplier_vat_id).trim();
  const supplierName = extraction.supplier_name?.trim();
  const normalizedName = extraction.supplier_name_normalized?.trim();
  
  // First try to find by VAT ID
  if (vatId) {
    const found = await base44.asServiceRole.entities.Suppliers.filter({ vat_id: vatId }, undefined, 1);
    if (found && found.length > 0) {
      supplierId = found[0].id;
    }
  }
  
  // If not found by VAT, try by learned pattern
  if (!supplierId && normalizedName) {
    const patterns = await base44.asServiceRole.entities.SupplierPattern.filter({ 
      pattern_type: 'name_pattern', 
      pattern_value: normalizedName,
      is_active: true 
    }, undefined, 1);
    if (patterns && patterns.length > 0) {
      supplierId = patterns[0].supplier_id;
    }
  }
  
  // Create new supplier if not found
  if (!supplierId) {
    const created = await base44.asServiceRole.entities.Suppliers.create({
      name: supplierName || 'לא ידוע',
      vat_id: vatId || undefined,
      created_from_invoice: true,
      is_active: true
    });
    supplierId = created.id;
    
    // Save patterns for future matching
    if (vatId) {
      try {
        await base44.asServiceRole.entities.SupplierPattern.create({
          supplier_id: supplierId,
          pattern_type: 'vat_id',
          pattern_value: vatId,
          confidence: 100,
          learned_from_invoice: invoice.id
        });
      } catch (_) {}
    }
    if (normalizedName) {
      try {
        await base44.asServiceRole.entities.SupplierPattern.create({
          supplier_id: supplierId,
          pattern_type: 'name_pattern',
          pattern_value: normalizedName,
          confidence: 80,
          learned_from_invoice: invoice.id
        });
      } catch (_) {}
    }
  }

  // Duplicate check - same doc_number + same supplier
  const extractedDocNumber = extraction.doc_number?.trim();
  if (extractedDocNumber && supplierId) {
    const existingWithSameDocNum = await base44.asServiceRole.entities.Invoices.filter({ doc_number: extractedDocNumber }, undefined, 50);
    const duplicate = existingWithSameDocNum.find(inv => 
      inv.id !== invoice.id && 
      inv.supplier === supplierId && 
      inv.extraction_status !== 'נדחה'
    );
    if (duplicate) {
      const dupKey = `${extractedDocNumber}|${vatId || supplierId}`;
      const dupNote = `כפילות - חשבונית ${extractedDocNumber} מספק זה כבר קיימת במערכת (מזהה: ${duplicate.id}). נדחתה אוטומטית.`;
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        supplier: supplierId,
        doc_type: extraction.doc_type_he || undefined,
        doc_number: extractedDocNumber,
        extraction_status: 'נדחה',
        duplicate_key: dupKey,
        notes: dupNote,
        ai_debug_last_extraction_json: JSON.stringify(extraction)
      });
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'כפילות',
        status_reason: dupNote
      });
      return { success: true, skipped: true, reason: 'duplicate', duplicate_of: duplicate.id };
    }
  }

  // Update invoice
  const indexNote = invoiceIndex !== null ? `[חשבונית ${invoiceIndex + 1} מתוך קובץ מרובה]\n` : '';
  const notes = `${indexNote}${extraction.display_summary_he || ''}\n${validation.display_validation_he || ''}`.trim();
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
    extraction_status: validation.recommended_extraction_status_he,
    notes: notes,
    ai_debug_last_extraction_json: JSON.stringify(extraction),
    ai_debug_last_validation_json: JSON.stringify(validation)
  };

  await base44.asServiceRole.entities.Invoices.update(invoice.id, updatePayload);

  return { success: true, invoice_id: invoice.id, supplier_id: supplierId, extraction, validation };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const intakeId = body.intake_id;
    if (!intakeId) return Response.json({ error: 'Missing intake_id' }, { status: 400 });

    const intakeList = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = intakeList?.[0];
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });

    if (!intake.file) return Response.json({ error: 'No file on intake' }, { status: 400 });
    if (intake.status !== 'מוכן לניתוח') return Response.json({ error: 'Intake not ready' }, { status: 400 });
    if (!intake.linked_invoice) return Response.json({ error: 'No linked invoice' }, { status: 400 });

    // Fetch linked invoice and guard approved/rejected
    const invList = await base44.asServiceRole.entities.Invoices.filter({ id: intake.linked_invoice });
    const invoice = invList?.[0];
    if (!invoice) return Response.json({ error: 'Linked invoice not found' }, { status: 404 });
    if (invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה') {
      return Response.json({ success: true, skipped: true, reason: 'Invoice already finalized' });
    }

    // Step 0: Detect if multiple invoices in file
    const multiDetect = await base44.integrations.Core.InvokeLLM({
      prompt: MULTI_INVOICE_DETECT_PROMPT,
      add_context_from_internet: false,
      response_json_schema: MULTI_INVOICE_DETECT_SCHEMA,
      file_urls: [intake.file]
    });

    const invoiceCount = multiDetect?.invoice_count || 1;
    const results = [];

    if (invoiceCount > 1 && multiDetect.invoices_detected?.length > 0) {
      // Multiple invoices detected - process each one
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status_reason: `זוהו ${invoiceCount} חשבוניות בקובץ. מעבד...`
      });

      for (let i = 0; i < invoiceCount; i++) {
        const hint = multiDetect.invoices_detected[i];
        
        // Create extraction prompt with specific invoice hint
        const specificPrompt = `${EXTRACT_PROMPT}

IMPORTANT: This document contains MULTIPLE invoices. 
Extract ONLY invoice #${i + 1} which is: ${hint?.supplier_hint || ''} ${hint?.doc_number_hint || ''} ${hint?.page_hint || ''}
Ignore all other invoices in the document.`;

        const extraction = await base44.integrations.Core.InvokeLLM({
          prompt: specificPrompt,
          add_context_from_internet: false,
          response_json_schema: EXTRACT_SCHEMA,
          file_urls: [intake.file]
        });

        if (!extraction || typeof extraction !== 'object') continue;

        // For first invoice, use the existing linked invoice
        // For additional invoices, create new invoice records
        let targetInvoice = invoice;
        if (i > 0) {
          const newInvoice = await base44.asServiceRole.entities.Invoices.create({
            source_intake: intake.id,
            extraction_status: 'ממתין לאימות',
            notes: `נוצר אוטומטית - חשבונית ${i + 1} מתוך ${invoiceCount} בקובץ מרובה`
          });
          targetInvoice = newInvoice;
        }

        const result = await processSingleInvoice(base44, intake, targetInvoice, extraction, i);
        results.push(result);
      }

      // Update intake status
      const successCount = results.filter(r => r.success && !r.skipped).length;
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'עובד',
        status_reason: `עובדו ${successCount} חשבוניות מתוך ${invoiceCount} שזוהו בקובץ`
      });

      return Response.json({ 
        success: true, 
        multiple_invoices: true, 
        invoice_count: invoiceCount,
        results 
      });
    }

    // Single invoice - normal flow
    const extraction = await base44.integrations.Core.InvokeLLM({
      prompt: EXTRACT_PROMPT,
      add_context_from_internet: false,
      response_json_schema: EXTRACT_SCHEMA,
      file_urls: [intake.file]
    });

    if (!extraction || typeof extraction !== 'object') throw new Error('Invalid extraction response');

    const result = await processSingleInvoice(base44, intake, invoice, extraction);
    
    if (result.skipped) {
      return Response.json(result);
    }

    // Update intake status_reason
    let intakeReason = '';
    if (result.validation?.recommended_extraction_status_he === 'נקרא בהצלחה') {
      intakeReason = 'המסמך נותח ונקלט לחשבונית. ממתין לאישור סופי לפי הצורך.';
    } else {
      const topReason = (result.validation?.review_reasons_he && result.validation.review_reasons_he[0]) || 'נדרש אימות ידני.';
      intakeReason = `המסמך נותח אך נדרש אימות ידני: ${topReason}`;
    }
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { status_reason: intakeReason });

    return Response.json(result);
  } catch (error) {
    try {
      const text = await req.text().catch(() => null);
      const body = text ? JSON.parse(text) : {};
      const intakeId = body?.intake_id;
      if (intakeId) {
        await createClientFromRequest(req).asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, {
          status: 'דולג',
          status_reason: 'שגיאת ניתוח מסמך. נדרש טיפול ידני.'
        });
      }
    } catch (_) {}
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});