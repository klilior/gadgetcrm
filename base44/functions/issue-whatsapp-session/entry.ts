import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const SESSION_SECONDS = 90 * 60;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}

function base64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signSession(employeeId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = base64Url(JSON.stringify({
    version: 1,
    subject: String(employeeId),
    issued_at: now,
    expires_at: now + SESSION_SECONDS
  }));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(encoded))
  );
  const signature = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { token: encoded + '.' + signature, expiresAt: now + SESSION_SECONDS };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('WHATSAPP_GATEWAY_SHARED_SECRET') || '';
  if (!secret) return json({ success: false, error: 'not_configured' }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const identifier = String(body?.identifier || '').trim();
  const password = String(body?.password || '');
  if (!identifier || identifier.length > 160 || !password || password.length > 256) {
    return json({ success: false, error: 'invalid_credentials' }, 401);
  }

  const base44 = createClientFromRequest(req);
  const employees = base44.asServiceRole.entities.Employee;
  const filter = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { username: identifier.toUpperCase() };

  try {
    const matches = await employees.filter(filter);
    const employee = matches?.[0] || null;
    const valid = employee
      && employee.is_active
      && String(employee.password_hash || '') === password;

    if (!valid) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return json({ success: false, error: 'invalid_credentials' }, 401);
    }

    const { password_hash: _password, ...safeEmployee } = employee;
    const session = await signSession(employee.id, secret);
    await employees.update(employee.id, { last_login: new Date().toISOString() });

    return json({
      success: true,
      employee: safeEmployee,
      session_token: session.token,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error('WhatsApp session issue failed', error?.message || 'unknown');
    return json({ success: false, error: 'login_failed' }, 500);
  }
});
