import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    const intakeId = body.intake_id;
    if (!intakeId) return Response.json({ error: 'Missing intake_id' }, { status: 400 });

    const list = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intakeId });
    const intake = list?.[0];
    if (!intake) return Response.json({ error: 'Intake not found' }, { status: 404 });

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
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, updates);
      Object.assign(intake, updates);
    }

    // C2: duplicate by file_hash (60 days)
    if (intake.file_hash && intake.status !== 'דולג') {
      const others = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ file_hash: intake.file_hash }, '-received_at', 1000);
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const dup = (others || []).find((r) => r.id !== intake.id && r.received_at && new Date(r.received_at) >= sixtyDaysAgo);
      if (dup && intake.status !== 'כפילות') {
        await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
          status: 'כפילות',
          status_reason: 'זוהתה כפילות לפי חתימת קובץ.'
        });
        intake.status = 'כפילות';
        intake.status_reason = 'זוהתה כפילות לפי חתימת קובץ.';
      }
    }

    // C3 (reliable): ensure invoice shell exists exactly once when intake is created with a valid file
    let createdInvoice = null;

    // If link already exists, enforce both-way link and trigger pipeline idempotently
    if (intake.linked_invoice) {
      try { await base44.asServiceRole.entities.Invoices.update(intake.linked_invoice, { source_intake: intake.id }); } catch (_) {}
      try { await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: intake.linked_invoice }); } catch (_) {}
    } else {
      // Avoid duplicates by checking existing invoice with this intake
      const existing = await base44.asServiceRole.entities.Invoices.filter({ source_intake: intake.id }, undefined, 1);
      let invoiceId = existing?.[0]?.id || null;

      const validForCreation = isValidFile(intake) && intake.status !== 'דולג' && intake.status !== 'כפילות';

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
        // Trigger AI pipeline on the invoice (Option A, idempotent) - await to ensure it runs
        let extractionResult = null;
        try { 
          extractionResult = await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: invoiceId }); 
        } catch (extractErr) {
          console.error('Extraction pipeline error:', extractErr);
        }
        return Response.json({ 
          success: true, 
          updates_applied: updates, 
          created_invoice_id: createdInvoice?.id || invoiceId, 
          intake_id: intake.id,
          extraction_triggered: true,
          extraction_result: extractionResult?.data || null
        });
      }
    }

    return Response.json({ success: true, updates_applied: updates, created_invoice_id: createdInvoice?.id || null, intake_id: intake.id });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});