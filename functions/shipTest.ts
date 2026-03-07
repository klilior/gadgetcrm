import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

async function getToken(baseUrl) {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const tokenUrl = `${baseUrl}/token`;
  console.log('Getting token from:', tokenUrl);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(5000)
  });

  const data = await res.json();
  console.log('Token response status:', res.status);
  console.log('Token data:', JSON.stringify(data).substring(0, 300));
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { endpoint, method, body, base } = await req.json();
    const apiBase = base || 'https://plugins.ship.co.il';
    
    const tokenData = await getToken(apiBase);
    
    if (!tokenData.access_token) {
      return Response.json({ error: 'No token', tokenData });
    }

    const url = `${apiBase}${endpoint}`;
    const httpMethod = (method || 'GET').toUpperCase();
    
    console.log(`${httpMethod} ${url}`);
    
    const opts = {
      method: httpMethod,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    };
    
    if (httpMethod === 'POST' && body) {
      opts.body = JSON.stringify(body);
      console.log('Body:', JSON.stringify(body).substring(0, 500));
    }
    
    let res;
    try {
      res = await fetch(url, opts);
    } catch (fetchErr) {
      return Response.json({ error: fetchErr.message, errorType: fetchErr.name, url });
    }
    
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text.substring(0, 1000)}`);
    
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    
    return Response.json({ status: res.status, data: parsed, base: apiBase });
  } catch (e) {
    console.error('Error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
});