import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    const { invoice_id, action } = body;
    if (!invoice_id || !action) return Response.json({ error: 'Missing params' }, { status: 400 });

    // Only higher-privilege roles
    const allowed = (user.role === 'מנהל') || (user.role === 'admin');
    if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const invList = await base44.asServiceRole.entities.Invoices.filter({ id: invoice_id });
    const invoice = invList?.[0];
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });

    const now = new Date().toISOString();
    if (action === 'approve') {
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        extraction_status: 'אושר',
        reviewed_by: user.email,
        reviewed_at: now,
      });
    } else if (action === 'reject') {
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        extraction_status: 'נדחה',
        reviewed_by: user.email,
        reviewed_at: now,
      });
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    // C5: mark related intake as processed
    if (invoice.source_intake) {
      await base44.asServiceRole.entities.InvoiceIntakeRaw.update(invoice.source_intake, {
        status: 'עובד',
        status_reason: 'החשבונית טופלה (אושרה/נדחתה).'
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});