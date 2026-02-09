import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Call scrapeAndCheck with refresh_all action
    const result = await base44.asServiceRole.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
    });

    return Response.json({ success: true, result: result?.data || result });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});