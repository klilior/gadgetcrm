import { stableLinePattern, reviewArithmetic } from '../../shared/invoiceReviewPolicy.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/actorResolver.ts';
import { resolveCorrelationId } from '../../shared/correlation.ts';
import { logAudit } from '../../shared/audit.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
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

    const actor = await resolveActor(base44);
    const correlationId = resolveCorrelationId(req, body.correlation_id, 'invoice_review');

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
      const arithmetic = reviewArithmetic(invoice);
      if (!arithmetic.ok) return Response.json({error:arithmetic.reason},{status:400});
      await base44.asServiceRole.entities.Invoices.update(invoice.id, {
        extraction_status: 'אושר',
        reviewed_by: userEmail,
        reviewed_at: now,
      });
      
      // Persist an explicit manual classification as the learned supplier default.
      const hasManualOverride = String(invoice.notes || '').includes('[manual_classification_override]') || invoice.classification_status === 'manually_corrected';
      if (invoice.supplier && hasManualOverride) {
        const category = invoice.is_goods_invoice === true || invoice.expense_category === 'goods'
          ? 'goods'
          : invoice.is_recurring_expense === true || ['communication', 'payment_fee', 'rent', 'software', 'service'].includes(invoice.expense_category)
            ? 'fixed'
            : null;
        if (category) {
          await base44.asServiceRole.entities.Suppliers.update(invoice.supplier, {
            learned_classification: category,
            classification_learned_from_invoice: invoice.id
          });
        }
      }

      // Learn exact SKU/product-line classifications. These override keyword rules on future invoices.
      if (invoice.supplier && hasManualOverride) {
        const correctedLines = await base44.asServiceRole.entities.InvoiceLine.filter({ invoice_id: invoice.id }, 'line_number', 500);
        for (const line of correctedLines) {
          const category = line.line_category;
          if (category !== 'goods' && category !== 'fixed') continue;
          const candidates = [
            line.sku ? { pattern_type: 'line_sku_classification', pattern_value: stableLinePattern(line.sku) } : null,
            line.product_name ? { pattern_type: 'line_name_classification', pattern_value: stableLinePattern(line.product_name) } : null
          ].filter((item) => item?.pattern_value);
          for (const candidate of candidates) {
            const found = await base44.asServiceRole.entities.SupplierPattern.filter({ supplier_id: invoice.supplier, pattern_type: candidate.pattern_type, pattern_value: candidate.pattern_value }, undefined, 1);
            const data = { ...candidate, supplier_id: invoice.supplier, classification: category, confidence: 100, learned_from_invoice: invoice.id, is_active: true };
            if (found?.[0]) await base44.asServiceRole.entities.SupplierPattern.update(found[0].id, data);
            else await base44.asServiceRole.entities.SupplierPattern.create(data);
          }
        }
      }

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
        reviewed_by: userEmail,
        reviewed_at: now,
      });
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    await logAudit(base44, {
      actor_user_id: actor.authenticated_user_id,
      actor_employee_id: actor.employee_id,
      entity_type: 'Invoices',
      entity_id: invoice.id,
      action: action === 'approve' ? 'APPROVE' : 'REJECT',
      before_data: { extraction_status: invoice.extraction_status, reviewed_by: invoice.reviewed_by || null },
      after_data: { extraction_status: action === 'approve' ? 'אושר' : 'נדחה', reviewed_by: userEmail },
      field_changes: {
        extraction_status: {
          before: invoice.extraction_status,
          after: action === 'approve' ? 'אושר' : 'נדחה'
        }
      },
      source: actor.authenticated_user_id ? 'USER' : 'SYSTEM',
      correlation_id: correlationId,
      request_context: { actor_type: actor.actor_type }
    });

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