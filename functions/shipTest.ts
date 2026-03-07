import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

async function getToken() {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const res = await fetch('https://api.ship.co.il/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { endpoint, method, body, base } = await req.json();
    
    console.log('Step 1: Getting token...');
    const tokenData = await getToken();
    console.log('Token OK:', !!tokenData.access_token);
    
    if (!tokenData.access_token) {
      return Response.json({ error: 'No token', tokenData });
    }

    const apiBase = base || 'https://api.ship.co.il';
    const url = `${apiBase}${endpoint}`;
    const httpMethod = (method || 'GET').toUpperCase();
    
    console.log(`Step 2: ${httpMethod} ${url}`);
    
    const opts = {
      method: httpMethod,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(3000)
    };
    
    if (httpMethod === 'POST' && body) {
      opts.body = JSON.stringify(body);
      console.log('Body:', JSON.stringify(body).substring(0, 300));
    }
    
    let res;
    try {
      res = await fetch(url, opts);
    } catch (fetchErr) {
      console.log('Fetch error:', fetchErr.name, fetchErr.message);
      return Response.json({ 
        error: fetchErr.message, 
        errorType: fetchErr.name,
        url 
      });
    }
    
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text.substring(0, 500)}`);
    
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    
    return Response.json({ status: res.status, data: parsed });
  } catch (e) {
    console.error('Error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
});