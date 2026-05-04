import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // Call the main API function with bulkRefreshStatuses action
    const result = await base44.asServiceRole.functions.invoke('getPackageApi', {
      action: 'bulkRefreshStatuses'
    });
    console.log('[GetPackage Auto-Refresh]', JSON.stringify(result));
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[GetPackage Auto-Refresh] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});