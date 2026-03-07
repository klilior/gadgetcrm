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

  const method = action === 'post' ? 'POST' : 'GET';
  const endpoints = endpoint ? (Array.isArray(endpoint) ? endpoint : [endpoint]) : ['/'];

  const results = {};
  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const opts = { headers, method, signal: controller.signal };
      if (method === 'POST') opts.body = JSON.stringify({});
      const res = await fetch(`${API_BASE}${ep}`, opts);
      clearTimeout(timeout);
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text.substring(0, 300); }
      results[ep] = { status: res.status, data: parsed };
    } catch (e) {
      results[ep] = { error: e.message };
    }
  }

  return Response.json({ token_received: !!token, results });
});