import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { calculateFileHash, getEarlyNonInvoiceReason, isValidInvoiceFile } from '../../shared/invoiceIntakeGuards.ts';
import { FILE_HASH_ALGORITHM, decideIntakeShellAction, needsFileHashRecompute } from '../../shared/invoiceIntakeIdentity.ts';
import { loadIntakeDuplicateCandidates } from '../../shared/invoiceIntakeCandidates.ts';

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
    // Legacy/non-64-hex values are untrusted: recompute from the actual bytes before any dedupe.
    if (needsFileHashRecompute(intake)) {
      const hash = await calculateFileHash(intake.file).catch(() => null);
      if (hash) {
        intake.file_hash = hash;
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { file_hash: hash, file_hash_algorithm: FILE_HASH_ALGORITHM });
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

    // C2 + C3 via the SHARED decision function, so a sequential retry of the same intake
    // returns the existing invoice and never creates a second shell.
    const decision = decideIntakeShellAction({
      intake,
      invoicesForIntake: await base44.asServiceRole.entities.Invoices.filter({ source_intake: intake.id }, undefined, 5),
      duplicateCandidates: intake.status === 'דולג' ? [] : await loadIntakeDuplicateCandidates(base44, intake),
      isValidFile: isValidInvoiceFile(intake)
    });

    if (decision.action === 'reuse_duplicate') {
      // Technical duplicate: reuse the original intake's invoice. Original file/document,
      // original intake and existing extraction payload are preserved; no extra shell.
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
        status: 'כפילות',
        status_reason: decision.reason,
        duplicate_reason_code: decision.reason_code,
        linked_invoice: decision.invoice_id,
        ai_debug_last_extraction_json: decision.reuse_extraction_json || undefined
      });
      return Response.json({ success: true, status: 'duplicate_cached', reason_code: decision.reason_code, original_id: decision.original_intake_id, invoice_id: decision.invoice_id, needs_extraction: false });
    }

    if (decision.action === 'reuse_existing') {
      try { await base44.asServiceRole.entities.Invoices.update(decision.invoice_id, { source_intake: intake.id }); } catch (_) {}
      if (!intake.linked_invoice) await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { linked_invoice: decision.invoice_id });
      return Response.json({ success: true, updates_applied: updates, invoice_id: decision.invoice_id, intake_id: intake.id, needs_extraction: true });
    }

    if (decision.action === 'create') {
      const created = await base44.asServiceRole.entities.Invoices.create({
        source_intake: intake.id,
        extraction_status: 'ממתין לאימות',
        notes: 'נוצר אוטומטית ממסמך שנקלט. ממתין לניתוח/הזנה.'
      });
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, { linked_invoice: created.id, status: 'מוכן לניתוח' });
      return Response.json({ success: true, updates_applied: updates, created_invoice_id: created.id, intake_id: intake.id });
    }

    return Response.json({ success: true, updates_applied: updates, status: 'skipped', reason: decision.reason, created_invoice_id: null, intake_id: intake.id });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});