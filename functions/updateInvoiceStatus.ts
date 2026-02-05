import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    const { invoice_id, action, employee_role, employee_email } = body;
    if (!invoice_id || !action) return Response.json({ error: 'Missing params' }, { status: 400 });

    // Try Base44 auth first
    let userRole = null;
    let userEmail = null;
    try {
      const user = await base44.auth.me();
      if (user) {
        userRole = user.role;
        userEmail = user.email;
      }
    } catch (authErr) {
      console.log('[updateInvoiceStatus] Base44 auth not available');
    }
    
    // If no Base44 user, use employee_role passed from frontend (Employee-based login system)
    if (!userRole && employee_role) {
      userRole = employee_role;
      userEmail = employee_email || 'employee';
      console.log('[updateInvoiceStatus] Using employee role from frontend:', userRole);
    }
    
    if (!userRole) {
      return Response.json({ error: 'Unauthorized - login required' }, { status: 401 });
    }

    // Only higher-privilege roles
    const allowed = (userRole === 'מנהל') || (userRole === 'admin');
    if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

    let invoice;
    try {
      invoice = await base44.asServiceRole.entities.Invoices.get(invoice_id);
    } catch (e) {
      console.log('[updateInvoiceStatus] Error fetching invoice:', e.message);
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });

    const now = new Date().toISOString();
    if (action === 'approve') {
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        extraction_status: 'אושר',
        reviewed_by: user.email,
        reviewed_at: now,
      });
      
      // Learn supplier patterns for future identification
      if (invoice.supplier && invoice.ai_debug_last_extraction_json) {
        try {
          const extraction = JSON.parse(invoice.ai_debug_last_extraction_json);
          const patternsToCreate = [];
          
          // Learn normalized name pattern
          const normalizedName = extraction.supplier_name_normalized?.trim();
          if (normalizedName) {
            const existingNamePattern = await base44.asServiceRole.entities.SupplierPattern.filter({
              supplier_id: invoice.supplier,
              pattern_type: 'name_pattern',
              pattern_value: normalizedName
            });
            if (!existingNamePattern || existingNamePattern.length === 0) {
              patternsToCreate.push({
                supplier_id: invoice.supplier,
                pattern_type: 'name_pattern',
                pattern_value: normalizedName,
                confidence: 100,
                learned_from_invoice: invoice.id,
                is_active: true
              });
            }
          }
          
          // Learn original supplier name pattern
          const supplierName = extraction.supplier_name?.trim();
          if (supplierName && supplierName !== normalizedName) {
            const existingOrigPattern = await base44.asServiceRole.entities.SupplierPattern.filter({
              supplier_id: invoice.supplier,
              pattern_type: 'name_pattern',
              pattern_value: supplierName
            });
            if (!existingOrigPattern || existingOrigPattern.length === 0) {
              patternsToCreate.push({
                supplier_id: invoice.supplier,
                pattern_type: 'name_pattern',
                pattern_value: supplierName,
                confidence: 100,
                learned_from_invoice: invoice.id,
                is_active: true
              });
            }
          }
          
          // Learn VAT ID pattern
          const vatId = extraction.supplier_vat_id?.trim();
          if (vatId) {
            const existingVatPattern = await base44.asServiceRole.entities.SupplierPattern.filter({
              supplier_id: invoice.supplier,
              pattern_type: 'vat_id',
              pattern_value: vatId
            });
            if (!existingVatPattern || existingVatPattern.length === 0) {
              patternsToCreate.push({
                supplier_id: invoice.supplier,
                pattern_type: 'vat_id',
                pattern_value: vatId,
                confidence: 100,
                learned_from_invoice: invoice.id,
                is_active: true
              });
            }
          }
          
          // Create all patterns
          for (const pattern of patternsToCreate) {
            await base44.asServiceRole.entities.SupplierPattern.create(pattern);
          }
          
          console.log(`Learned ${patternsToCreate.length} patterns for supplier ${invoice.supplier}`);
        } catch (patternErr) {
          console.log('Pattern learning failed:', patternErr.message);
        }
      }
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