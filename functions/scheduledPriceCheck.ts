import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // This function can be called by:
    // 1. Scheduled automation (no user context) - use service role
    // 2. Manual trigger from UI (user context) - verify user exists

    let isAutomation = false;
    try {
      const user = await base44.auth.me();
      if (!user) {
        // No user = likely automation, proceed with service role
        isAutomation = true;
      }
    } catch (_) {
      // Auth failed = automation context
      isAutomation = true;
    }

    // Call scrapeAndCheck with refresh_all action using service role
    const result = await base44.asServiceRole.functions.invoke('scrapeAndCheck', {
      action: 'refresh_all',
      run_mode: isAutomation ? 'אוטומטי' : 'ידני',
      service_call: true,
    });

    return Response.json({ success: true, result: result?.data || result });
  } catch (error) {
    console.error('scheduledPriceCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});