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

  // Try the OPSI get-label endpoint (used by WooCommerce plugin)
  const endpoints = [
    // OPSI plugin endpoints
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-label-by-customer`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-label-by-customer`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-label-by-customer/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-label-by-customer/${tracking_number}`, method: 'GET' },
    // Try with LabelFormat parameter
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-label-by-customer`, method: 'POST', body: { TrackingNumber: tracking_number, LabelFormat: "PDF" } },
    // Try shipment info endpoints
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-by-tracking`, method: 'POST', body: { TrackingNumber: tracking_number } },
    { url: `${PLUGINS_BASE}/api/v1/shipment/get-domestic-wb-by-tracking?TrackingNumber=${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/tracking/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/track/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/info/${tracking_number}`, method: 'GET' },
    { url: `${PLUGINS_BASE}/api/v1/shipment/${tracking_number}`, method: 'GET' },
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