import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { classifyInvoiceLines } from '../../shared/invoiceClassification.ts';
import { calculateFileHash, getEarlyNonInvoiceReason } from '../../shared/invoiceIntakeGuards.ts';
import { needsFileHashRecompute, trustedFileHash } from '../../shared/invoiceIntakeIdentity.ts';
import { planExtractionRoutePreflight } from '../../shared/invoiceExtractionRoutePreflight.ts';
import { validateInvoiceForAutoApproval, normalizeInvoiceNumber, INVOICE_VALIDATION_VERSION, ARITHMETIC_TOLERANCE } from '../../shared/invoiceValidationGate.ts';
import { EXTRACT_PROMPT, EXTRACT_SCHEMA, roundMoney, getLineItemsCheck, normalizeExtractionDates } from '../../shared/invoiceExtraction.ts';
import { auditAndApplyAmounts } from '../../shared/invoiceMonetaryAudit.ts';
import { resolveSupplier, normalizeVatId, isOurBuyerVatId } from '../../shared/supplierResolver.ts';
import { buildInvoiceLineRecords, persistInvoiceLines, applyLinetLinesToInvoice } from '../../shared/invoiceLinePersistence.ts';
import { parseLinetLines, LINET_MATCH_RULE_VERSION } from '../../shared/linetInvoiceReconciliation.ts';

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

    // Allow re-run for any non-finalized status. The reset write is DEFERRED until after the
    // technical-identity preflight, so a cross-intake duplicate can never mutate a finalized invoice.
    const isFinalized = invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה';
    if (isFinalized && !body.force) {
      return Response.json({ success: true, skipped: true, reason: 'Finalized' });
    }
    if (!invoice.source_intake) {
      return Response.json({ success: true, skipped: true, reason: 'No source intake' });
    }

    const intakeList = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: invoice.source_intake });
    const intake = intakeList?.[0];
    if (!intake) return Response.json({ success: false, error: 'Source intake not found' }, { status: 404 });

    // File presence is evaluated IN MEMORY; the debug write is deferred past the preflight.
    const filePresent = !!(intake.file && typeof intake.file === 'string' && intake.file.trim().length > 0);

    // D1 technical-identity preflight — BEFORE any entity update. Legacy non-64-hex pseudo-hashes
    // are untrusted, so the hash is recomputed from the ACTUAL file bytes in memory and dedupe
    // requires a trusted SHA-256 on BOTH sides. Technical duplicate only — never a
    // Linet/matched_duplicate. force NEVER bypasses this ruling.
    let recomputedHash = null;
    if (filePresent && needsFileHashRecompute(intake)) {
      recomputedHash = await calculateFileHash(intake.file).catch(() => null);
    }
    const probeHash = trustedFileHash({ ...intake, file_hash: recomputedHash || intake.file_hash });
    const candidates = probeHash
      ? await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ file_hash: probeHash }, 'id', 1000)
      : [];
    const preflight = planExtractionRoutePreflight({ intake, invoiceId: invoice.id, candidates, recomputedHash, force: body.force === true });

    if (preflight.is_duplicate) {
      // Report only, zero writes: no shell creation, deletion, rejection, re-linking or overwrite.
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Technical file duplicate',
        reason_code: preflight.reason_code,
        original_intake_id: preflight.original_intake_id,
        original_invoice_id: preflight.original_invoice_id,
        records_unchanged: true
      });
    }

    // Not a duplicate → the deferred writes may now run, in the original order.
    for (const write of preflight.planned_writes) {
      intake.file_hash = write.data.file_hash;
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(write.id, write.data);
    }
    if (isFinalized) {
      await base44.asServiceRole.entities.Invoices.update(invoice.id, { extraction_status: 'ממתין לאימות' });
    }
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_input_file_present: filePresent });

    if (!filePresent) {
      const errMsg = 'אין קובץ בשדה file בקליטה / הקובץ לא זמין ל-AI';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'דולג',
        ai_debug_last_error_he: errMsg
      });
      return Response.json({ success: false, skipped: true, reason: 'No file on intake', ai_debug_last_error_he: errMsg });
    }

    const earlySkipReason = getEarlyNonInvoiceReason(intake);
    if (earlySkipReason && !body.force) {
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { status: 'דולג', status_reason: earlySkipReason });
      await base44.asServiceRole.entities.Invoices.update(invoice.id, { extraction_status: 'נדחה', notes: earlySkipReason });
      return Response.json({ success: true, skipped: true, reason: 'Early non-invoice filter' });
    }

    // Idempotency: run only if doc_number OR total_with_vat missing (unless force re-run)
    // If older records already have extracted data but kept an outdated review status, normalize them here.
    const hasDocNumber = !!(invoice.doc_number && String(invoice.doc_number).trim());
    const hasTotal = typeof invoice.total_with_vat === 'number' && !Number.isNaN(invoice.total_with_vat);
    if (hasDocNumber && hasTotal && !body.force) {
      let parsedValidation = null;
      let parsedExtraction = null;
      try { parsedValidation = invoice.ai_debug_last_validation_json ? JSON.parse(invoice.ai_debug_last_validation_json) : null; } catch (_) {}
      try { parsedExtraction = invoice.ai_debug_last_extraction_json ? JSON.parse(invoice.ai_debug_last_extraction_json) : null; } catch (_) {}
      const lineCheck = getLineItemsCheck(parsedExtraction);
      const missingFields = parsedValidation?.missing_critical_fields || [];
      const validationOk = !parsedValidation || (
        parsedValidation.is_math_consistent !== false &&
        missingFields.length === 0 &&
        parsedValidation.recommended_extraction_status_he !== 'ממתין לאימות' &&
        !lineCheck.hasAnyFailure
      );
      // P0.1: never approve an existing record based on AI self-confidence.
      // Re-running the deterministic gate on the stored values is the only approval path.
      // Identity comes ONLY from stored document evidence — never synthesized from the linked Supplier record.
      const existingSuppliers = await base44.asServiceRole.entities.Suppliers.list('-created_date', 1000);
      const existingPatterns = await base44.asServiceRole.entities.SupplierPattern.filter({ is_active: true }, undefined, 1000);
      const existingResolution = resolveSupplier({
        vat_id: parsedExtraction?.supplier_vat_id,
        supplier_name: parsedExtraction?.supplier_name,
        supplier_name_normalized: parsedExtraction?.supplier_name_normalized
      }, { suppliers: existingSuppliers, patterns: existingPatterns });
      const existingSupplier = existingResolution.supplier;
      const existingDuplicates = existingResolution.supplier_id
        ? await base44.asServiceRole.entities.Invoices.filter({ supplier: existingResolution.supplier_id }, undefined, 200)
        : [];
      const existingGate = validateInvoiceForAutoApproval({
        supplier_name: parsedExtraction?.supplier_name,
        supplier_vat_id: parsedExtraction?.supplier_vat_id,
        doc_number: invoice.doc_number,
        invoice_date: invoice.doc_date,
        due_date: invoice.due_date,
        subtotal_before_vat: invoice.subtotal_before_vat,
        vat_amount: invoice.vat_amount,
        total_with_vat: invoice.total_with_vat,
        doc_type_he: invoice.doc_type
      }, {
        supplier: existingSupplier,
        supplier_match_method: existingResolution.method,
        supplier_resolution: existingResolution,
        duplicates: existingDuplicates,
        invoice_id: invoice.id,
        line_check: lineCheck
      });
      const canAutoApproveExisting = validationOk && existingGate.passed && !lineCheck.hasAnyFailure;
      const normalizedStatus = canAutoApproveExisting ? 'אושר' : 'ממתין לאימות';

      if (invoice.extraction_status !== normalizedStatus) {
        const lineNote = (lineCheck.failures || []).length
          ? `נדרש אימות שורות מוצרים: ${lineCheck.failures.join(' | ')}`
          : '';
        await base44.asServiceRole.entities.Invoices.update(invoice.id, {
          extraction_status: normalizedStatus,
          validation_passed: existingGate.passed,
          validation_failures: existingGate.failures.join(' | ') || undefined,
          validation_warnings: existingGate.warnings.join(' | ') || undefined,
          validated_fields: existingGate.validated_fields.join(',') || undefined,
          validation_version: existingGate.validation_version,
          auto_approved: canAutoApproveExisting,
          normalized_doc_number: normalizeInvoiceNumber(invoice.doc_number) || undefined,
          notes: canAutoApproveExisting
            ? ((invoice.notes || '').includes('אושר אוטומטית') ? invoice.notes : `${invoice.notes || ''}\nאושר אוטומטית לאחר מעבר כל בדיקות התקינות (${INVOICE_VALIDATION_VERSION}).`.trim())
            : `${lineNote || invoice.notes || ''}\nנדרש אימות ידני: ${existingGate.failures.join(' | ') || 'תוצאות ניתוח לא תקינות.'}`.trim()
        });
      }
      if (invoice.source_intake) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(invoice.source_intake, {
          status: 'עובד',
          status_reason: 'החשבונית כבר נותחה; הסטטוס סונכרן לפי תוצאות הניתוח.'
        });
      }
      return Response.json({ success: true, skipped: true, reason: 'Already populated', normalized_status: normalizedStatus });
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
        model: 'gpt_5_mini'
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
              model: 'gpt_5_mini'
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

    // Unwrap if LLM wrapped response in a 'response' key (happens with some models like Claude)
    if (extraction && typeof extraction === 'object' && extraction.response && typeof extraction.response === 'object' && extraction.response.classification) {
      console.log('Unwrapping nested response object from LLM');
      extraction = extraction.response;
    }

    if (!extraction || typeof extraction !== 'object') {
      const errMsg = 'תגובת AI לא תקינה או ריקה';
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { ai_debug_last_error_he: errMsg });
      throw new Error('Invalid extraction response');
    }

    // Post-process: if prices_include_vat is true, ensure line item prices are correctly split
    // The AI sometimes puts the VAT-inclusive price into unit_price_before_vat even when it knows prices include VAT
    const VAT_RATE = 0.18;
    if (extraction.prices_include_vat === true) {
      console.log('prices_include_vat=true detected, post-processing line items...');
      const items = extraction.line_items || [];
      for (const item of items) {
        // If unit_price_with_vat is set, use it as the source of truth
        if (item.unit_price_with_vat && item.unit_price_with_vat > 0) {
          item.unit_price_before_vat = Math.round((item.unit_price_with_vat / (1 + VAT_RATE)) * 100) / 100;
        } else if (item.unit_price_before_vat && item.unit_price_before_vat > 0) {
          // AI likely put the VAT-inclusive price in unit_price_before_vat — fix it
          item.unit_price_with_vat = item.unit_price_before_vat;
          item.unit_price_before_vat = Math.round((item.unit_price_with_vat / (1 + VAT_RATE)) * 100) / 100;
        }
        // Same for line totals
        if (item.line_total_with_vat && item.line_total_with_vat > 0) {
          item.line_total_before_vat = Math.round((item.line_total_with_vat / (1 + VAT_RATE)) * 100) / 100;
        } else if (item.line_total_before_vat && item.line_total_before_vat > 0) {
          item.line_total_with_vat = item.line_total_before_vat;
          item.line_total_before_vat = Math.round((item.line_total_with_vat / (1 + VAT_RATE)) * 100) / 100;
        }
      }
      
      // Also verify header amounts: if subtotal ≈ total (no VAT gap), the AI probably put total in subtotal
      if (typeof extraction.subtotal_before_vat === 'number' && typeof extraction.total_with_vat === 'number') {
        const ratio = extraction.subtotal_before_vat / extraction.total_with_vat;
        // If subtotal is very close to total (within 5%), it means subtotal was actually the total
        if (ratio > 0.95 && ratio <= 1.05) {
          console.log(`Header amounts look like both are VAT-inclusive (ratio=${ratio.toFixed(3)}). Recalculating subtotal.`);
          extraction.subtotal_before_vat = Math.round((extraction.total_with_vat / (1 + VAT_RATE)) * 100) / 100;
          extraction.vat_amount = Math.round((extraction.total_with_vat - extraction.subtotal_before_vat) * 100) / 100;
        }
      }
      console.log('Post-processing complete.');
    }

    // P0.3: invoice date and due date are separate. The due date must NEVER become the invoice date.
    normalizeExtractionDates(extraction);

    // P0.4: evidence-based monetary audit (second pass on the original file).
    // Turnover / balance / account-summary figures can never become the payable total;
    // missing or conflicting label evidence nulls the amounts so the gate sends to review.
    const amountSelection = await auditAndApplyAmounts(base44, extraction, fileUrlToUse);
    console.log('Monetary audit:', JSON.stringify(amountSelection.provenance));

    // DEBUG: Save raw extraction JSON (after post-processing)
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
      
      // Math consistency: subtotal + vat ≈ total (rounding tolerance only)
      let isMathConsistent = true;
      let mathDelta = null;
      
      if (typeof sub === 'number' && typeof vat === 'number' && typeof total === 'number') {
        mathDelta = Math.abs((sub + vat) - total);
        mathDelta = Math.round(mathDelta * 100) / 100;
        isMathConsistent = mathDelta <= ARITHMETIC_TOLERANCE;
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
      
      const lineCheck = getLineItemsCheck(extraction);
      
      // Determine status
      const allGood = missing.length === 0 && isMathConsistent && !lineCheck.hasAnyFailure;
      const reviewReasons = [];
      if (!isMathConsistent) reviewReasons.push(`סכום כולל אינו תואם לסכום לפני מע"מ וסכום המע"מ (הפרש: ${mathDelta} ש"ח).`);
      // Concrete per-line failures (including qty × unit ≠ line total) instead of a generic sum claim.
      for (const failure of (lineCheck.failures || [])) reviewReasons.push(failure);
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

    // Step 4: Supplier resolution ONLY — deterministic, shared, and never creates/renames a supplier.
    const allSuppliers = await base44.asServiceRole.entities.Suppliers.list('-created_date', 1000);
    const learnedPatterns = await base44.asServiceRole.entities.SupplierPattern.filter({ is_active: true }, undefined, 1000);
    const supplierResolution = resolveSupplier({
      vat_id: extraction.supplier_vat_id,
      supplier_name: extraction.supplier_name,
      supplier_name_normalized: extraction.supplier_name_normalized
    }, { suppliers: allSuppliers, patterns: learnedPatterns });

    const supplierId = supplierResolution.supplier_id;
    const supplierMatchMethod = supplierResolution.method;
    const rawVatId = extraction.supplier_vat_id && String(extraction.supplier_vat_id).trim();
    const isOurVatId = isOurBuyerVatId(rawVatId);
    const normalizedVatId = isOurVatId ? null : (normalizeVatId(rawVatId) || null);
    console.log(`Supplier resolution: ${supplierMatchMethod} / ${supplierResolution.evidence_strength} → ${supplierId || 'UNRESOLVED'} (${supplierResolution.reason_code || 'ok'})`);

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
          subtotal_before_vat: roundMoney(extraction.subtotal_before_vat),
          vat_amount: roundMoney(extraction.vat_amount),
          total_with_vat: roundMoney(extraction.total_with_vat),
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

    // Step 5: Classify every extracted line, then summarize the invoice.
    const lineItems = extraction.line_items || [];
    const matchedSupplier = supplierResolution.supplier;
    const learnedLinePatterns = learnedPatterns.filter((pattern) => pattern.supplier_id === supplierId && pattern.classification);
    const classificationResult = classifyInvoiceLines({ invoice, supplier: matchedSupplier, lineItems, learnedLinePatterns });
    const classifiedByLineNumber = new Map(classificationResult.lines.map((line, index) => [Number(line.line_number || index + 1), line]));

    const baseNotes = `${extraction.display_summary_he || ''}\n${validation.display_validation_he || ''}`.trim();

    // P0.1 + P0.2: auto approval is decided ONLY by the deterministic validation gate.
    // extraction.overall_confidence is stored for telemetry and is NOT part of this decision.
    const normalizedDocNumber = normalizeInvoiceNumber(extraction.doc_number);
    const duplicateCandidates = extraction.doc_number && supplierId
      ? await base44.asServiceRole.entities.Invoices.filter({ supplier: supplierId }, undefined, 200)
      : [];
    const gate = validateInvoiceForAutoApproval({
      supplier_name: extraction.supplier_name,
      supplier_vat_id: extraction.supplier_vat_id,
      doc_number: extraction.doc_number,
      invoice_date: extraction.invoice_date,
      due_date: extraction.due_date,
      subtotal_before_vat: extraction.subtotal_before_vat,
      vat_amount: extraction.vat_amount,
      total_with_vat: extraction.total_with_vat,
      doc_type_he: extraction.doc_type_he
    }, {
      supplier: matchedSupplier,
      supplier_match_method: supplierMatchMethod,
      supplier_resolution: supplierResolution,
      duplicates: duplicateCandidates,
      invoice_id: invoice.id,
      line_check: getLineItemsCheck(extraction)
    });
    console.log('Validation gate:', JSON.stringify(gate));

    const canAutoApprove = gate.passed && validation.recommended_extraction_status_he === 'נקרא בהצלחה';
    const finalStatus = canAutoApprove ? 'אושר' : 'ממתין לאימות';
    const finalNotes = canAutoApprove
      ? `${baseNotes}\nאושר אוטומטית לאחר מעבר כל בדיקות התקינות (${gate.validation_version}).`
      : `${baseNotes}\nנדרש אימות ידני: ${(gate.failures.length ? gate.failures : validation.review_reasons_he).join(' | ')}${supplierId ? '' : `\n${supplierResolution.reason_code}: ${supplierResolution.reason}`}`;

    const updatePayload = {
      // Unresolved/ambiguous identity clears the link explicitly so no stale supplier can survive.
      supplier: supplierId ?? null,
      doc_type: extraction.doc_type_he || undefined,
      doc_number: extraction.doc_number || undefined,
      doc_date: extraction.doc_date || undefined,
      due_date: extraction.due_date || undefined,
      normalized_doc_number: normalizedDocNumber || undefined,
      currency: extraction.currency || undefined,
      subtotal_before_vat: extraction.subtotal_before_vat ?? undefined,
      vat_amount: extraction.vat_amount ?? undefined,
      total_with_vat: extraction.total_with_vat ?? undefined,
      confidence_score: extraction.overall_confidence ?? undefined,
      validation_passed: gate.passed,
      validation_failures: gate.failures.join(' | ') || undefined,
      validation_warnings: gate.warnings.join(' | ') || undefined,
      validated_fields: gate.validated_fields.join(',') || undefined,
      validation_version: gate.validation_version,
      auto_approved: canAutoApprove,
      extraction_status: finalStatus,
      notes: finalNotes,
      invoice_classification: classificationResult.invoice_classification || undefined,
      classification_status: classificationResult.classification_status,
      classification_reason: classificationResult.classification_reason
    };

    await base44.asServiceRole.entities.Invoices.update(invoice.id, updatePayload);

    // Step 6: persist EVERY usable line (service/subscription lines without SKU included) BEFORE
    // reconciliation can influence the flow. Upsert by invoice_id + line_number, so a retry never duplicates.
    const lineRecords = buildInvoiceLineRecords(extraction, { invoiceId: invoice.id, supplierId, classifiedByLineNumber });
    const linePersistence = await persistInvoiceLines(base44, invoice.id, lineRecords);
    console.log('Invoice lines persisted:', JSON.stringify(linePersistence));

    const priceAlerts = [];

    for (const item of lineItems) {
      // Price tracking only: no SKU or no resolved supplier means there is no price identity to track.
      if (!item.sku || !supplierId) continue;
      
      // Check/update SupplierProductPrice
      const existingPrice = await base44.asServiceRole.entities.SupplierProductPrice.filter({
        supplier_id: supplierId,
        sku: item.sku
      }, undefined, 1);
      
      const newPrice = roundMoney(item.unit_price_before_vat || (item.line_total_before_vat && item.quantity ? item.line_total_before_vat / item.quantity : null));
      
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

    // Step 6b: targeted reconciliation AFTER lines are stored. matched/conflict/possible are
    // consumed as information only — a Linet match never terminates this flow.
    let reconciliationResult = null;
    try {
      const reconciliation = await base44.asServiceRole.functions.invoke('reconcileLinetInvoices', { invoice_ids: [invoice.id] });
      const result = reconciliation?.data || reconciliation;
      reconciliationResult = result?.stats || null;
      const invoiceResult = (result?.results || []).find((row) => row.invoice_id === invoice.id);
      if (invoiceResult?.status === 'matched') {
        const refreshed = (await base44.asServiceRole.entities.Invoices.filter({ id: invoice.id }, undefined, 1))?.[0];
        const purchase = refreshed?.linet_purchase_document_id
          ? (await base44.asServiceRole.entities.LinetPurchaseDocument.filter({ id: refreshed.linet_purchase_document_id }, undefined, 1))?.[0]
          : null;
        if (purchase) {
          const linetLines = parseLinetLines(purchase);
          const applyResult = await applyLinetLinesToInvoice(base44, invoice.id, linetLines, { level: 'confirmed', values: { rule_version: LINET_MATCH_RULE_VERSION } });
          console.log('Linet line application:', JSON.stringify(applyResult));
        }
      }
    } catch (reconciliationError) {
      console.log('Linet reconciliation skipped without blocking intake:', reconciliationError.message);
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
      lines_persisted: linePersistence,
      reconciliation: reconciliationResult,
      extraction, 
      validation 
    });
  } catch (error) {
    try {
      const invoiceId = body?.invoice_id;
      if (invoiceId) {
        const invList = await base44.asServiceRole.entities.Invoices.filter({ id: invoiceId });
        const invoice = invList?.[0];
        if (invoice?.source_intake) {
          await base44.asServiceRole.entities.InvoiceIntakeRaw.update(invoice.source_intake, {
            status: 'מוכן לניתוח',
            status_reason: `שגיאת ניתוח אוטומטי: ${error?.message || String(error)}`
          });
        }
      }
    } catch (_) {}
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});