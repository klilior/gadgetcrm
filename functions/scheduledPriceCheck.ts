import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // Call scrapeAndCheck with refresh_all action using service role
    // The service_call flag tells scrapeAndCheck to skip user auth
    const result = await base44.asServiceRole.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
      run_mode: 'אוטומטי',
      service_call: true,
    });

    console.log('scheduledPriceCheck result:', JSON.stringify(result?.data || result));
    return Response.json({ success: true, result: result?.data || result });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});