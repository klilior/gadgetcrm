import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { secrets } from 'base44:runtime';

const SESSION_SECONDS = 90 * 60;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
function base64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}
function bytesFromHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g).map((part) => parseInt(part, 16)));
}
async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signSession(employeeId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = base64Url(JSON.stringify({ version: 1, subject: String(employeeId), issued_at: now, expires_at: now + SESSION_SECONDS }));
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(secret), new TextEncoder().encode(encoded)));
  const signature = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { token: encoded + '.' + signature, expiresAt: now + SESSION_SECONDS };
}
async function sessionEmployeeId(token, secret) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [encoded, signature, extra] = token.split('.');
  const signatureBytes = bytesFromHex(signature || '');
  if (!encoded || !signatureBytes || extra) return null;
  const valid = await crypto.subtle.verify('HMAC', await sessionKey(secret), signatureBytes, new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded));
    const now = Math.floor(Date.now() / 1000);
    if (payload?.version !== 1 || Number(payload?.issued_at) > now + 30 || Number(payload?.expires_at) < now) return null;
    return String(payload.subject || '') || null;
  } catch {
    return null;
  }
}
function safeEmployee(employee) {
  if (!employee) return null;
  const { password_hash: _password, ...safe } = employee;
  return safe;
}

export default async function(req) {
  try {
    if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);
    const secret = secrets.get('WHATSAPP_GATEWAY_SHARED_SECRET') || '';
    if (!secret) return json({ success: false, error: 'not_configured' }, 503);
    const body = await req.json().catch(() => null);
    if (!body) return json({ success: false, error: 'invalid_json' }, 400);

    const base44 = createClientFromRequest(req);
    const employees = base44.asServiceRole.entities.Employee;

    if (body.action === 'restore_session') {
      const employeeId = await sessionEmployeeId(body.session_token, secret);
      if (!employeeId || String(body.employee_id || '') !== employeeId) return json({ success: false, error: 'invalid_session' }, 401);
      const employee = await employees.get(employeeId).catch(() => null);
      if (!employee?.is_active) return json({ success: false, error: 'invalid_session' }, 401);
      return json({ success: true, employee: safeEmployee(employee) });
    }

    const identifier = String(body.identifier || '').trim();
    const password = String(body.password || '');
    if (!identifier || identifier.length > 160 || !password || password.length > 256) return json({ success: false, error: 'invalid_credentials' }, 401);
    const filter = identifier.includes('@') ? { email: identifier.toLowerCase() } : { username: identifier.toUpperCase() };
    const matches = await employees.filter(filter);
    const employee = matches?.[0] || null;
    const valid = employee && employee.is_active && String(employee.password_hash || '') === password;
    if (!valid) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return json({ success: false, error: 'invalid_credentials' }, 401);
    }

    const session = await signSession(employee.id, secret);
    await employees.update(employee.id, { last_login: new Date().toISOString() });
    return json({ success: true, employee: safeEmployee(employee), session_token: session.token, expires_at: session.expiresAt });
  } catch (error) {
    console.error('Employee session issue failed', error?.message || 'unknown');
    return json({ success: false, error: 'login_failed' }, 500);
  }
}