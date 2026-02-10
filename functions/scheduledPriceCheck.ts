import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // Parse body safely - automations may send empty body
    let body = {};
    try { body = await req.json(); } catch (_) {}

    console.log('[scheduledPriceCheck] Starting...');

    // Get all active products using service role
    const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
    
    if (!products || products.length === 0) {
      console.log('[scheduledPriceCheck] No active products found');
      return Response.json({ success: true, message: 'אין מוצרים פעילים', checked: 0 });
    }

    console.log(`[scheduledPriceCheck] Found ${products.length} active products, calling scrapeAndCheck...`);

    // Call scrapeAndCheck using service role functions invoke
    const result = await base44.asServiceRole.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
      run_mode: 'אוטומטי',
      service_call: true,
    });

    const data = result?.data || result;
    console.log('[scheduledPriceCheck] Completed:', JSON.stringify(data));
    return Response.json({ success: true, result: data });
  } catch (error) {
    console.error('[scheduledPriceCheck] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});