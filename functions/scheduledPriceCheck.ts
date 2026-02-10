import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    console.log('[scheduledPriceCheck] Starting...');

    // Get all active products using service role
    const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
    
    if (!products || products.length === 0) {
      return Response.json({ success: true, message: 'אין מוצרים פעילים לבדיקה', checked: 0 });
    }

    console.log(`[scheduledPriceCheck] Found ${products.length} active products, invoking scrapeAndCheck...`);

    // Use asServiceRole.functions.invoke to bypass user auth requirement
    const result = await base44.asServiceRole.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
      run_mode: 'אוטומטי',
      service_call: true,
    });

    const data = result?.data || result;
    console.log('[scheduledPriceCheck] Done:', JSON.stringify(data));
    return Response.json({ success: true, result: data });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});