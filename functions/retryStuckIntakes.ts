import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 401 });
    }

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const limit = body.limit || 10; // Process max 10 at a time to avoid timeout

    // Find intakes stuck in "מוכן לניתוח" with linked invoices
    const stuckIntakes = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter(
      { status: 'מוכן לניתוח' },
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

        // Reset invoice for re-extraction if needed
        if (invoice.extraction_status !== 'ממתין לאימות' && invoice.extraction_status !== 'נקרא בהצלחה') {
          await base44.asServiceRole.entities.Invoices.update(invoice.id, {
            extraction_status: 'ממתין לאימות'
          });
        }

        // Call the extraction function using direct HTTP call (service role doesn't pass user context)
        const extractionResult = await base44.functions.invoke('runInvoiceExtractionByInvoice', {
          invoice_id: intake.linked_invoice
        });

        results.push({ 
          intake_id: intake.id, 
          invoice_id: intake.linked_invoice,
          status: 'processed', 
          extraction_result: extractionResult?.data || extractionResult
        });

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