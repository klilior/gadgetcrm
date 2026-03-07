import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const API_BASE = 'https://api.ship.co.il';

async function getToken() {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const res = await fetch(`${API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const data = await res.json();
  console.log('Token response:', JSON.stringify(data));
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { action, endpoint } = await req.json();

  // Step 1: Get token
  const token = await getToken();
  if (!token) {
    return Response.json({ error: 'Failed to get token' });
  }

  // Step 2: Explore different endpoints
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Try various endpoints to discover the API structure
  const endpoints = endpoint ? [endpoint] : [
    // Try to get something that reveals the API structure
    '/api/Shipment/GetShipments',
    '/api/Pickup/GetPickups',
    '/api/B2C/GetShipments',
    '/api/B2C/CreateShipment',
    '/api/Customer/GetDetails',
    '/api/Dashboard/GetDashboard',
    '/api/Shipment/GetLabels',
    '/api/Common/GetCities',
    '/api/Common/GetStreets',
    '/api/Address/GetCities',
    '/api/Domestic/CreatePickup',
    '/api/International/CreateShipment',
  ];

  const results = {};
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${API_BASE}${ep}`, { headers });
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      results[ep] = { status: res.status, data: parsed };
    } catch (e) {
      results[ep] = { error: e.message };
    }
  }

  return Response.json({ token_received: !!token, results });
});