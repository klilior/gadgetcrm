import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Automation handler for InvoiceIntakeRaw entity creation
 * This function is called by entity automations when a new intake is created
 */

function isValidFile(intake) {
  const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  if (!intake?.file) return false;
  if (intake?.file_mime && allowed.includes(intake.file_mime.toLowerCase())) return true;
  try {
    const name = (intake?.file_name || '').toLowerCase();
    return ['.pdf', '.jpg', '.jpeg', '.png'].some((ext) => name.endsWith(ext));
  } catch (_) { return false; }
}

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
    
    // Always fetch full intake data to ensure we have current state
    const list = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = list?.[0];
    
    if (!intake) {
      console.error(`Intake not found: ${intakeId}`);
      return Response.json({ success: false, error: 'Intake not found' }, { status: 404 });
    }
    
    console.log(`Intake status: ${intake.status}, has file: ${!!intake.file}, linked_invoice: ${intake.linked_invoice || 'none'}`);
    
    const updates = {};

    // C1: initialize status
    if (!isValidFile(intake)) {
      updates.status = 'דולג';
      updates.status_reason = 'אין קובץ תקין לעיבוד.';
    } else if (intake.status === 'חדש' || !intake.status) {
      updates.status = 'מוכן לניתוח';
    }

    // Apply C1 updates first if needed
    if (Object.keys(updates).length) {
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, updates);
      Object.assign(intake, updates);
      console.log(`Applied status updates: ${JSON.stringify(updates)}`);
    }

    // C2: duplicate by file_hash (60 days)
    if (intake.file_hash && intake.status !== 'דולג') {
      const others = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ file_hash: intake.file_hash }, '-received_at', 100);
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const dup = (others || []).find((r) => r.id !== intakeId && r.received_at && new Date(r.received_at) >= sixtyDaysAgo);
      if (dup && intake.status !== 'כפילות') {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, {
          status: 'כפילות',
          status_reason: 'זוהתה כפילות לפי חתימת קובץ.'
        });
        intake.status = 'כפילות';
        console.log(`Marked as duplicate, original: ${dup.id}`);
        return Response.json({ success: true, status: 'duplicate', original_id: dup.id });
      }
    }

    // C3: ensure invoice shell exists
    let invoiceId = intake.linked_invoice;
    
    if (invoiceId) {
      // Link exists, ensure bidirectional link
      try { 
        await base44.asServiceRole.entities.Invoices.update(invoiceId, { source_intake: intakeId }); 
      } catch (_) {}
    } else {
      // Check if invoice already exists for this intake
      const existing = await base44.asServiceRole.entities.Invoices.filter({ source_intake: intakeId }, undefined, 1);
      invoiceId = existing?.[0]?.id || null;

      const validForCreation = isValidFile(intake) && intake.status !== 'דולג' && intake.status !== 'כפילות';

      if (!invoiceId && validForCreation) {
        const created = await base44.asServiceRole.entities.Invoices.create({
          source_intake: intakeId,
          extraction_status: 'ממתין לאימות',
          notes: 'נוצר אוטומטית ממסמך שנקלט. ממתין לניתוח/הזנה.'
        });
        invoiceId = created.id;
        console.log(`Created invoice: ${invoiceId}`);
      }

      if (invoiceId) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { linked_invoice: invoiceId });
      }
    }

    if (!invoiceId) {
      console.log('No invoice created (invalid file or skipped status)');
      return Response.json({ success: true, status: 'skipped', reason: intake.status_reason || 'No valid file' });
    }

    // Update intake status to show processing
    await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { status: 'עובד' });
    
    // Trigger AI extraction pipeline
    let extractionResult = null;
    let extractionError = null;
    try { 
      console.log(`Triggering AI extraction for invoice: ${invoiceId}`);
      extractionResult = await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: invoiceId }); 
      
      if (extractionResult?.data?.success) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { 
          status: 'עובד', 
          status_reason: 'ניתוח AI הושלם בהצלחה' 
        });
        console.log(`AI extraction successful for invoice: ${invoiceId}`);
      }
    } catch (extractErr) {
      extractionError = extractErr?.message || String(extractErr);
      console.error('Extraction pipeline error:', extractionError);
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intakeId, { 
        status: 'מוכן לניתוח', 
        status_reason: `שגיאה בניתוח אוטומטי: ${extractionError}` 
      });
    }
    
    return Response.json({ 
      success: true, 
      intake_id: intakeId,
      invoice_id: invoiceId,
      extraction_triggered: true,
      extraction_success: extractionResult?.data?.success || false,
      extraction_error: extractionError
    });
    
  } catch (error) {
    console.error('Automation error:', error.message, error.stack);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});