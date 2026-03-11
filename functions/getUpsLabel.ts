import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const PLUGINS_BASE = 'https://plugins.ship.co.il';

async function getToken() {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const res = await fetch(`${PLUGINS_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get token');
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tracking_number } = await req.json();
    if (!tracking_number) return Response.json({ error: 'Missing tracking number' }, { status: 400 });

    const token = await getToken();

    // Try multiple label endpoints
    const endpoints = [
      `${PLUGINS_BASE}/api/v1/shipment/label/${tracking_number}`,
      `${PLUGINS_BASE}/api/v1/shipment/print/${tracking_number}`,
      `${PLUGINS_BASE}/api/v1/shipment/get-label-by-tracking?trackingNumber=${tracking_number}`,
      `${PLUGINS_BASE}/api/v1/shipment/label?trackingNumber=${tracking_number}`,
      `${PLUGINS_BASE}/api/v1/label?trackingNumber=${tracking_number}`,
    ];

    for (const url of endpoints) {
      console.log(`Trying label endpoint: ${url}`);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/pdf,application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      console.log(`Response: ${res.status} ${res.headers.get('content-type')}`);
      
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        
        if (ct.includes('pdf')) {
          // Convert PDF to base64
          const buffer = await res.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          return Response.json({ 
            success: true, 
            label_base64: base64,
            content_type: 'application/pdf'
          });
        }
        
        if (ct.includes('json')) {
          const data = await res.json();
          console.log('JSON response:', JSON.stringify(data).substring(0, 500));
          const labelUrl = data.LabelUrl || data.Url || data.url || data.Label || data.label || null;
          if (labelUrl) {
            return Response.json({ success: true, label_url: labelUrl });
          }
          // Check if there's base64 PDF in JSON
          const b64 = data.LabelData || data.Label || data.label_data || null;
          if (b64) {
            return Response.json({ success: true, label_base64: b64, content_type: 'application/pdf' });
          }
        }
      }
    }

    // No label found - return fallback
    return Response.json({ 
      success: false, 
      error: 'לא נמצא שטר מטען. ניתן להדפיס מתוך מערכת Ship.co.il',
      tracking_number
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});