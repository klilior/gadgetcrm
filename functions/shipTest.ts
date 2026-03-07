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
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { endpoint, method, body } = await req.json();
    
    // Step 1: Get token
    const tokenData = await getToken();
    console.log('Token OK:', !!tokenData.access_token, 'Customer:', tokenData.customerNumber);
    
    if (!tokenData.access_token) {
      return Response.json({ error: 'No token', tokenData });
    }

    // Step 2: Make single API call
    const url = `${API_BASE}${endpoint}`;
    const httpMethod = (method || 'GET').toUpperCase();
    
    const opts = {
      method: httpMethod,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (httpMethod === 'POST' && body) {
      opts.body = JSON.stringify(body);
    }
    
    console.log(`${httpMethod} ${url}`);
    if (body) console.log('Body:', JSON.stringify(body).substring(0, 500));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    opts.signal = controller.signal;
    
    const res = await fetch(url, opts);
    clearTimeout(timeout);
    
    const text = await res.text();
    console.log(`Response status: ${res.status}`);
    console.log(`Response headers:`, JSON.stringify(Object.fromEntries(res.headers.entries())));
    console.log(`Response body (first 1000):`, text.substring(0, 1000));
    
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    
    return Response.json({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      data: parsed
    });
  } catch (e) {
    console.error('Error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
});