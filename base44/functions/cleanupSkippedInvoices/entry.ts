import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || (user.role !== 'admin' && user.role !== 'מנהל')) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Find all invoices that should have been marked as rejected
    // These are invoices with "ממתין לאימות" status but have skip indication in notes or ai_debug
    const invoices = await base44.asServiceRole.entities.Invoices.filter(
      { extraction_status: { "$in": ["ממתין לאימות", "נקרא בהצלחה"] } },
      "-created_date",
      500
    );

    let cleaned = 0;
    let kept = 0;
    const cleanedIds = [];

    for (const inv of invoices || []) {
      // Check if this invoice was skipped (not a real invoice)
      let shouldReject = false;
      let reason = '';

      // Check ai_debug for skip indication
      if (inv.ai_debug_last_extraction_json) {
        try {
          const extraction = JSON.parse(inv.ai_debug_last_extraction_json);
          if (extraction.should_skip === true || extraction.classification === 'OTHER') {
            shouldReject = true;
            reason = extraction.skip_reason_he || 'המסמך אינו חשבונית/זיכוי';
          }
        } catch (_) {}
      }

      // Check if notes indicate skip
      if (!shouldReject && inv.notes?.includes('מסמך דולג')) {
        shouldReject = true;
        reason = 'מסמך דולג';
      }

      // Check if completely empty with no data
      if (!shouldReject && !inv.supplier && !inv.doc_number && !inv.doc_date && !inv.total_with_vat) {
        // Only reject if also no useful ai_debug data
        if (!inv.ai_debug_last_extraction_json) {
          shouldReject = true;
          reason = 'מסמך ללא נתונים';
        }
      }

      if (shouldReject) {
        await base44.asServiceRole.entities.Invoices.update(inv.id, {
          extraction_status: 'נדחה',
          notes: inv.notes ? `${inv.notes}\n[נדחה אוטומטית: ${reason}]` : `נדחה אוטומטית: ${reason}`
        });
        cleaned++;
        cleanedIds.push(inv.id);
      } else {
        kept++;
      }
    }

    return Response.json({
      success: true,
      total_checked: invoices?.length || 0,
      cleaned,
      kept,
      cleaned_ids: cleanedIds
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});