import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

ADDITIONAL: EXTRACT LINE ITEMS
You MUST also extract ALL line items (products/services) from the invoice.
Each line item should include:
- line_number: sequential number (1, 2, 3...)
- sku: product code/SKU/מק"ט (exactly as appears)
- product_name: product description/name
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const invoiceId = body.invoice_id;
    if (!invoiceId) return Response.json({ error: 'Missing invoice_id' }, { status: 400 });

    const invList = await base44.asServiceRole.entities.Invoices.filter({ id: invoiceId });
    const invoice = invList?.[0];
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });

    // Conditions (Option A - updated)
    if (invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה') {
      return Response.json({ success: true, skipped: true, reason: 'Finalized' });
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

    // Idempotency: run only if doc_number OR total_with_vat missing
    const hasDocNumber = !!(invoice.doc_number && String(invoice.doc_number).trim());
    const hasTotal = typeof invoice.total_with_vat === 'number' && !Number.isNaN(invoice.total_with_vat);
    if (hasDocNumber && hasTotal) {
      return Response.json({ success: true, skipped: true, reason: 'Already populated' });
    }

    // Step 1: Extraction
    let extraction;
    try {
      extraction = await base44.integrations.Core.InvokeLLM({
        prompt: EXTRACT_PROMPT,
        add_context_from_internet: false,
        response_json_schema: EXTRACT_SCHEMA,
        file_urls: [intake.file]
      });
    } catch (llmErr) {
      const errMsg = `שגיאת AI בחילוץ: ${llmErr?.message || String(llmErr)}`;
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: errMsg });
      throw llmErr;
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
      await base44.asServiceRole.entities.Invoices.update(invoice.id, { notes: (invoice.notes ? invoice.notes + '\n' : '') + newNotes });
      return Response.json({ success: true, skipped: true, reason: 'OTHER', extraction });
    }

    // Step 3: Validation
    const validationPrompt = `${VALIDATE_PROMPT}\n\nHere is the extracted JSON (use as input):\n\n${JSON.stringify(extraction)}`;
    let validation;
    try {
      validation = await base44.integrations.Core.InvokeLLM({
        prompt: validationPrompt,
        add_context_from_internet: false,
        response_json_schema: VALIDATE_SCHEMA,
      });
    } catch (valErr) {
      const errMsg = `שגיאת AI בולידציה: ${valErr?.message || String(valErr)}`;
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: errMsg });
      throw valErr;
    }

    if (!validation || typeof validation !== 'object') {
      const errMsg = 'תגובת ולידציה לא תקינה או ריקה';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: errMsg });
      throw new Error('Invalid validation response');
    }

    // DEBUG: Save raw validation JSON
    const validationJson = JSON.stringify(validation);
    await base44.asServiceRole.entities.Invoices.update(invoice.id, { ai_debug_last_validation_json: validationJson });

    // Step 4: Supplier linking
    let supplierId = null;
    const vatId = extraction.supplier_vat_id && String(extraction.supplier_vat_id).trim();
    if (vatId) {
      const found = await base44.asServiceRole.entities.Suppliers.filter({ vat_id: vatId }, undefined, 1);
      if (found && found.length > 0) {
        supplierId = found[0].id;
      } else {
        const created = await base44.asServiceRole.entities.Suppliers.create({
          name: extraction.supplier_name || 'לא ידוע',
          vat_id: vatId,
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

    // Step 5: Update invoice (mapping + safe auto-approval)
    const baseNotes = `${extraction.display_summary_he || ''}\n${validation.display_validation_he || ''}`.trim();

    // Determine final status and notes
    const fieldsComplete = !!(extraction.doc_type_he && extraction.doc_number && extraction.doc_date && (typeof extraction.total_with_vat === 'number'));
    const canAutoApprove = (
      validation.recommended_extraction_status_he === 'נקרא בהצלחה' &&
      (typeof extraction.overall_confidence === 'number' ? extraction.overall_confidence >= 90 : false) &&
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
        
        // Check for price change
        if (oldPrice && newPrice && oldPrice !== newPrice) {
          const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
          const direction = newPrice > oldPrice ? 'עלה' : 'ירד';
          
          // Update price record
          await base44.asServiceRole.entities.SupplierProductPrice.update(oldPriceRecord.id, {
            previous_price_before_vat: oldPrice,
            last_price_before_vat: newPrice,
            price_change_percent: Math.round(changePercent * 100) / 100,
            price_change_direction: direction,
            last_invoice_id: invoice.id,
            last_invoice_date: extraction.doc_date || null,
            purchase_count: (oldPriceRecord.purchase_count || 0) + 1
          });
          
          // Create PriceAlert
          if (Math.abs(changePercent) >= 1) {
            await base44.asServiceRole.entities.PriceAlert.create({
              supplier_id: supplierId,
              sku: item.sku,
              product_name: item.product_name,
              invoice_id: invoice.id,
              old_price: oldPrice,
              new_price: newPrice,
              change_percent: Math.round(changePercent * 100) / 100,
              direction: direction,
              status: 'חדש'
            });
            priceAlerts.push({ sku: item.sku, from: oldPrice, to: newPrice, change: `${changePercent.toFixed(1)}%` });
          }
        } else if (newPrice) {
          // No change, just update last invoice
          await base44.asServiceRole.entities.SupplierProductPrice.update(oldPriceRecord.id, {
            last_invoice_id: invoice.id,
            last_invoice_date: extraction.doc_date || null,
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

    return Response.json({ success: true, invoice_id: invoice.id, supplier_id: supplierId, extraction, validation });
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