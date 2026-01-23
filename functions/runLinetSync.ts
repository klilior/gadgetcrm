import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { executeLinetSync } from './linetSyncCore.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch (_e) {}

    const result = await executeLinetSync(base44, body);
    return Response.json(result, { status: result?.success ? 200 : 500 });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});