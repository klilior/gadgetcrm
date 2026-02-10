import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    console.log('[scheduledPriceCheck] Starting scheduled price check...');

    // Get all active products using service role
    const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
    
    if (!products || products.length === 0) {
      console.log('[scheduledPriceCheck] No active products found');
      return Response.json({ success: true, message: 'אין מוצרים פעילים לבדיקה', checked: 0 });
    }

    console.log(`[scheduledPriceCheck] Found ${products.length} active products`);

    // Build the URL for scrapeAndCheck from the same origin
    // We need to call scrapeAndCheck as a regular HTTP call, forwarding the auth headers
    const scrapeUrl = req.url.replace(/\/scheduledPriceCheck\b/, '/scrapeAndCheck');
    
    const response = await fetch(scrapeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward all auth headers from the incoming request
        ...Object.fromEntries(
          [...req.headers.entries()].filter(([k]) => 
            k.startsWith('authorization') || k.startsWith('x-') || k === 'cookie'
          )
        ),
      },
      body: JSON.stringify({
        action: 'refresh_all',
        run_mode: 'אוטומטי',
        service_call: true,
      }),
    });

    const data = await response.json();
    console.log('[scheduledPriceCheck] Result:', JSON.stringify(data));
    return Response.json({ success: true, result: data });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});