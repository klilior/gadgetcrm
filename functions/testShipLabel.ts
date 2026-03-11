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
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const { tracking_number } = await req.json();
  const token = await getToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': '*/*'
  };

  // Try many different endpoint patterns
  const endpoints = [
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-waybill-by-tracking?trackingNumber=${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/print-waybill/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/print/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/waybill/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/domestic-shipment/label/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/domestic-shipment/print/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/label/domestic/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-label/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-label/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-label-by-tracking?trackingNumber=${tracking_number}`, method: 'GET' },
    // POST variants
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-label`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/print-label`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-label`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/label`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-waybill`, method: 'POST', body: { TrackingNumber: tracking_number } },
  ];

  const results = [];
  for (const ep of endpoints) {
    try {
      const opts = {
        method: ep.method,
        headers,
        signal: AbortSignal.timeout(5000)
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);
      
      const res = await fetch(ep.url, opts);
      const contentType = res.headers.get('content-type') || '';
      let body;
      if (contentType.includes('application/pdf') || contentType.includes('image/')) {
        body = `[BINARY: ${contentType}, size: ${res.headers.get('content-length')}]`;
      } else {
        body = await res.text();
        if (body.length > 200) body = body.substring(0, 200) + '...';
      }
      
      console.log(`${ep.method} ${ep.url} -> ${res.status} (${contentType}): ${body}`);
      results.push({ url: ep.url, method: ep.method, status: res.status, contentType, body });
    } catch (e) {
      console.log(`${ep.method} ${ep.url} -> ERROR: ${e.message}`);
      results.push({ url: ep.url, method: ep.method, error: e.message });
    }
  }

  return Response.json({ results });
});