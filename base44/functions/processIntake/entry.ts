import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { calculateFileHash, findReusableDuplicate, getEarlyNonInvoiceReason, isValidInvoiceFile } from '../../shared/invoiceIntakeGuards.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Support both user-triggered and automation-triggered calls
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_) {
      // May be called by automation without user context
    }

    let body = {};
    try {
      const bodyText = await req.text();
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (parseErr) {
      console.error('Body parse error:', parseErr.message);
    }
    
    console.log('Received payload:', JSON.stringify(body));
    
    // Handle multiple payload formats:
    // 1. Direct: { intake_id: "..." }
    // 2. Entity automation: { event: { type, entity_name, entity_id }, data: {...}, old_data: {...} }
    let intakeId = body.intake_id;
    
    // Entity automation format - entity_id is in event object
    if (!intakeId && body.event && body.event.entity_id) {
      intakeId = body.event.entity_id;
      console.log(`Processing intake from entity automation event: ${intakeId}`);
    }
    
    // Fallback: data.id from automation
    if (!intakeId && body.data && body.data.id) {
      intakeId = body.data.id;
      console.log(`Processing intake from automation data.id: ${intakeId}`);
    }
    
    if (!intakeId) {
      console.error('Missing intake_id. Body keys:', Object.keys(body), 'Full body:', JSON.stringify(body).substring(0, 500));
      return Response.json({ error: 'Missing intake_id', body_keys: Object.keys(body) }, { status: 400 });
    }
    
    console.log(`Processing intake_id: ${intakeId}`);

    const list = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = list?.[0];
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });
    if (!intake.file_hash && intake.file) {
      const hash = await calculateFileHash(intake.file).catch(() => null);
      if (hash) {
        intake.file_hash = hash;
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { file_hash: hash });
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
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, updates);
      Object.assign(intake, updates);
    }

    // C2: permanent cache by exact file hash.
    if (intake.file_hash && intake.status !== 'דולג') {
      const matches = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ file_hash: intake.file_hash }, 'id', 1000);
      const dup = findReusableDuplicate(matches, intake.id);
      if (dup?.linked_invoice) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
          status: 'כפילות',
          status_reason: 'זוהתה כפילות לפי חתימת קובץ; נעשה שימוש בתוצאת החילוץ הקיימת.',
          linked_invoice: dup.linked_invoice || undefined,
          ai_debug_last_extraction_json: dup.ai_debug_last_extraction_json || undefined
        });
        return Response.json({ success: true, status: 'duplicate_cached', original_id: dup.id, invoice_id: dup.linked_invoice || null, needs_extraction: false });
      }
    }

    // C3 (reliable): ensure invoice shell exists exactly once when intake is created with a valid file
    let createdInvoice = null;

    // If link already exists, enforce both-way link
    if (intake.linked_invoice) {
      try { await base44.asServiceRole.entities.Invoices.update(intake.linked_invoice, { source_intake: intake.id }); } catch (_) {}
      return Response.json({ 
        success: true, 
        updates_applied: updates, 
        invoice_id: intake.linked_invoice, 
        intake_id: intake.id,
        needs_extraction: true
      });
    } else {
      // Avoid duplicates by checking existing invoice with this intake
      const existing = await base44.asServiceRole.entities.Invoices.filter({ source_intake: intake.id }, undefined, 1);
      let invoiceId = existing?.[0]?.id || null;

      const validForCreation = isValidInvoiceFile(intake) && intake.status !== 'דולג' && intake.status !== 'כפילות';

      if (!invoiceId && validForCreation) {
        const created = await base44.asServiceRole.entities.Invoices.create({
          source_intake: intake.id,
          extraction_status: 'ממתין לאימות',
          notes: 'נוצר אוטומטית ממסמך שנקלט. ממתין לניתוח/הזנה.'
        });
        invoiceId = created.id;
        createdInvoice = created;
      }

      if (invoiceId) {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { linked_invoice: invoiceId });
        try { await base44.asServiceRole.entities.Invoices.update(invoiceId, { source_intake: intake.id }); } catch (_) {}
        
        // Update intake status - mark as ready for extraction
        // The processIntakeAutomation will handle the actual AI extraction
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { status: 'מוכן לניתוח' });
        
        return Response.json({ 
          success: true, 
          updates_applied: updates, 
          created_invoice_id: createdInvoice?.id || invoiceId, 
          intake_id: intake.id
        });
      }
    }

    return Response.json({ success: true, updates_applied: updates, created_invoice_id: createdInvoice?.id || null, intake_id: intake.id });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});