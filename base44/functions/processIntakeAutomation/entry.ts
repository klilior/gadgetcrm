import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { calculateFileHash, getEarlyNonInvoiceReason, isValidInvoiceFile } from '../../shared/invoiceIntakeGuards.ts';
import { FILE_HASH_ALGORITHM, decideIntakeShellAction, needsFileHashRecompute } from '../../shared/invoiceIntakeIdentity.ts';
import { loadIntakeDuplicateCandidates } from '../../shared/invoiceIntakeCandidates.ts';
import { SHELL_CALLERS, planShellOwnership } from '../../shared/invoiceShellOwnership.ts';

// D2b1: this automation is the SINGLE automatic owner of invoice-shell creation.
const OWNERSHIP = planShellOwnership(SHELL_CALLERS.AUTOMATION);

/**
 * Automation handler for InvoiceIntakeRaw entity creation
 * This function is called by entity automations when a new intake is created
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    let body = {};
    try {
      const bodyText = await req.text();
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (parseErr) {
      console.error('Body parse error:', parseErr.message);
    }
    
    console.log('Automation received payload keys:', Object.keys(body));
    
    // Entity automation format: { event: { type, entity_name, entity_id }, data: {...} }
    const event = body.event;
    const data = body.data;
    
    if (!event || !event.entity_id) {
      console.error('Invalid automation payload - missing event.entity_id');
      return Response.json({ success: false, error: 'Invalid automation payload' }, { status: 400 });
    }
    
    const intakeId = event.entity_id;
    console.log(`Processing intake from automation: ${intakeId}, event type: ${event.type}`);
    
    // Small delay to ensure the entity is fully persisted
    await new Promise(r => setTimeout(r, 2000));
    
    // Always fetch full intake data to ensure we have current state
    const list = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = list?.[0];
    
    if (!intake) {
      console.error(`Intake not found: ${intakeId}`);
      return Response.json({ success: false, error: 'Intake not found' }, { status: 404 });
    }
    
    console.log(`Intake status: ${intake.status}, has file: ${!!intake.file}, linked_invoice: ${intake.linked_invoice || 'none'}`);
    // Legacy/non-64-hex values are untrusted: recompute from the actual bytes before any dedupe.
    if (needsFileHashRecompute(intake)) {
      const hash = await calculateFileHash(intake.file).catch(() => null);
      if (hash) {
        intake.file_hash = hash;
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { file_hash: hash, file_hash_algorithm: FILE_HASH_ALGORITHM });
      }
    }
    
    const updates = {};

    // C1: initialize status
    const earlySkipReason = getEarlyNonInvoiceReason(intake);
    if (!isValidInvoiceFile(intake)) {
      updates.status = 'דולג';
      updates.status_reason = 'אין קובץ תקין לעיבוד.';
    } else if (earlySkipReason) {
      updates.status = 'דולג';
      updates.status_reason = earlySkipReason;
    } else if (intake.status === 'חדש' || !intake.status) {
      updates.status = 'מוכן לניתוח';
    }

    // Apply C1 updates first if needed
    if (Object.keys(updates).length) {
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, updates);
      Object.assign(intake, updates);
      console.log(`Applied status updates: ${JSON.stringify(updates)}`);
    }

    // C2 + C3 via the SHARED decision function (same logic as processIntake), so a sequential
    // retry of the same intake returns the existing invoice and never creates a second shell.
    const decision = decideIntakeShellAction({
      intake,
      invoicesForIntake: await base44.asServiceRole.entities.Invoices.filter({ source_intake: intakeId }, undefined, 5),
      duplicateCandidates: intake.status === 'דולג' ? [] : await loadIntakeDuplicateCandidates(base44, intake),
      isValidFile: isValidInvoiceFile(intake)
    });

    if (decision.action === 'reuse_duplicate') {
      // Technical duplicate: reuse the original intake's invoice and extraction. No new shell,
      // no rejection, and never a Linet/matched_duplicate concern.
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, {
        status: 'כפילות',
        status_reason: decision.reason,
        duplicate_reason_code: decision.reason_code,
        linked_invoice: decision.invoice_id,
        ai_debug_last_extraction_json: decision.reuse_extraction_json || undefined
      });
      console.log(`Reused duplicate (${decision.reason_code}) from intake: ${decision.original_intake_id}`);
      return Response.json({ success: true, status: 'duplicate_cached', reason_code: decision.reason_code, original_id: decision.original_intake_id, invoice_id: decision.invoice_id, extraction_triggered: false });
    }

    if (decision.action === 'skip') {
      console.log('No invoice created (invalid file or skipped status)');
      return Response.json({ success: true, status: 'skipped', reason: decision.reason || 'No valid file' });
    }

    let invoiceId = decision.invoice_id;
    if (invoiceId) {
      try { await base44.asServiceRole.entities.Invoices.update(invoiceId, { source_intake: intakeId }); } catch (_) {}
      if (!intake.linked_invoice) await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { linked_invoice: invoiceId });
    } else {
      const created = await base44.asServiceRole.entities.Invoices.create({
        source_intake: intakeId,
        extraction_status: 'ממתין לאימות',
        notes: 'נוצר אוטומטית ממסמך שנקלט. ממתין לניתוח/הזנה.'
      });
      invoiceId = created.id;
      console.log(`Created invoice: ${invoiceId}`);
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { linked_invoice: invoiceId });
    }

    // Update intake status to show processing
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { status: 'עובד' });
    
    // Trigger AI extraction pipeline with retry on rate limit
    let extractionResult = null;
    let extractionError = null;
    const MAX_RETRIES = 3;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try { 
        console.log(`Triggering AI extraction for invoice: ${invoiceId} (attempt ${attempt}/${MAX_RETRIES})`);
        extractionResult = await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: invoiceId }); 
        
        if (extractionResult?.data?.success) {
          await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { 
            status: 'עובד', 
            status_reason: 'ניתוח AI הושלם בהצלחה' 
          });
          console.log(`AI extraction successful for invoice: ${invoiceId}`);
        }
        extractionError = null;
        break; // Success - exit retry loop
      } catch (extractErr) {
        extractionError = extractErr?.message || String(extractErr);
        const isRateLimit = extractionError.includes('429') || extractionError.includes('Rate limit');
        console.error(`Extraction attempt ${attempt} failed: ${extractionError}`);
        
        if (isRateLimit && attempt < MAX_RETRIES) {
          const delay = attempt * 5000; // 5s, 10s
          console.log(`Rate limited, waiting ${delay/1000}s before retry...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          break;
        }
      }
    }
    
    if (extractionError) {
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { 
        status: 'מוכן לניתוח', 
        status_reason: `שגיאה בניתוח אוטומטי: ${extractionError}` 
      });
    }
    
    return Response.json({ 
      success: true, 
      intake_id: intakeId,
      invoice_id: invoiceId,
      shell_owner: OWNERSHIP,
      extraction_triggered: true,
      extraction_success: extractionResult?.data?.success || false,
      extraction_error: extractionError
    });
    
  } catch (error) {
    console.error('Automation error:', error.message, error.stack);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});