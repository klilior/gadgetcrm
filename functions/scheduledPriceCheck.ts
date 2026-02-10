import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // Get all active products
    const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
    
    if (!products || products.length === 0) {
      return Response.json({ success: true, message: 'אין מוצרים פעילים לבדיקה', checked: 0 });
    }

    console.log(`[scheduledPriceCheck] Starting check for ${products.length} products`);

    // Call scrapeAndCheck via the function's own invoke mechanism
    // Use the base44 functions invoke which passes proper auth context
    const result = await base44.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
      run_mode: 'אוטומטי',
      service_call: true,
    });

    const data = result?.data || result;
    console.log('[scheduledPriceCheck] Result:', JSON.stringify(data));
    return Response.json({ success: true, result: data });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});