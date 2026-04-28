import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // Allow admin users or service role calls
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_) {}
    
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const limit = body.limit || 20;
    const sinceDate = body.since_date || null; // e.g. "2026-04-01"

    // Find intakes stuck in "מוכן לניתוח" or "חדש"
    const filter = { status: { $in: ['מוכן לניתוח', 'חדש'] } };
    if (sinceDate) {
      filter.created_date = { $gte: sinceDate + 'T00:00:00.000Z' };
    }

    const stuckIntakes = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter(
      filter,
      '-created_date',
      limit
    );

    if (!stuckIntakes || stuckIntakes.length === 0) {
      return Response.json({ success: true, message: 'No stuck intakes found', processed: 0 });
    }

    const results = [];
    
    for (const intake of stuckIntakes) {
      if (!intake.linked_invoice) {
        results.push({ intake_id: intake.id, status: 'skipped', reason: 'No linked invoice' });
        continue;
      }

      try {
        // Reset the invoice status to allow re-processing
        const invoices = await base44.asServiceRole.entities.Invoices.filter({ id: intake.linked_invoice });
        const invoice = invoices?.[0];
        
        if (!invoice) {
          results.push({ intake_id: intake.id, status: 'skipped', reason: 'Invoice not found' });
          continue;
        }

        // Skip if already finalized
        if (invoice.extraction_status === 'אושר' || invoice.extraction_status === 'נדחה') {
          // Update intake status to match
          await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
            status: invoice.extraction_status === 'אושר' ? 'עובד' : 'דולג',
            status_reason: 'החשבונית כבר עברה טיפול.'
          });
          results.push({ intake_id: intake.id, status: 'synced', reason: 'Invoice already finalized' });
          continue;
        }

        // Skip if already processed successfully (has data)
        const hasData = invoice.doc_number && invoice.total_with_vat;
        if (hasData && (invoice.extraction_status === 'ממתין לאימות' || invoice.extraction_status === 'נקרא בהצלחה')) {
          // Update intake status to match
          await base44.asServiceRole.entities.InvoiceIntakeRaw.update(intake.id, {
            status: 'עובד',
            status_reason: 'החשבונית נותחה בהצלחה וממתינה לאימות.'
          });
          results.push({ intake_id: intake.id, status: 'synced', reason: 'Invoice already has data, waiting for review' });
          continue;
        }

        // Reset invoice for re-extraction if needed
        if (!hasData && invoice.extraction_status !== 'ממתין לאימות' && invoice.extraction_status !== 'נקרא בהצלחה') {
          await base44.asServiceRole.entities.Invoices.update(invoice.id, {
            extraction_status: 'ממתין לאימות'
          });
        }

        // Call the extraction function via service role
        const extractionResult = await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', {
          invoice_id: intake.linked_invoice
        });

        results.push({ 
          intake_id: intake.id, 
          invoice_id: intake.linked_invoice,
          status: 'processed', 
          extraction_result: extractionResult?.data || extractionResult
        });

        // Delay between items to avoid rate limits
        await new Promise(r => setTimeout(r, 3000));

      } catch (err) {
        results.push({ 
          intake_id: intake.id, 
          status: 'error', 
          error: err?.message || String(err)
        });
      }
    }

    const processed = results.filter(r => r.status === 'processed').length;
    const errors = results.filter(r => r.status === 'error').length;

    return Response.json({ 
      success: true, 
      total: stuckIntakes.length,
      processed,
      errors,
      results 
    });

  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});