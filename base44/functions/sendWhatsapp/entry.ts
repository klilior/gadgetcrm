import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const GATEWAY_URL = 'https://gadget-team.co.il/whatsapp-send.php';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}

function bytesFromHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g).map((part) => parseInt(part, 16)));
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function validEmployeeSession(token, employeeId, secret) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return false;
  const signatureBytes = bytesFromHex(signature);
  if (!signatureBytes) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(encoded)
  );
  if (!valid) return false;

  try {
    const payload = JSON.parse(decodeBase64Url(encoded));
    const now = Math.floor(Date.now() / 1000);
    return payload?.version === 1
      && String(payload?.subject || '') === String(employeeId || '')
      && Number(payload?.issued_at) <= now + 30
      && Number(payload?.expires_at) >= now;
  } catch {
    return false;
  }
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  else if (!digits.startsWith('972')) digits = '972' + digits;
  return digits;
}

function cleanMessage(value) {
  if (!value || typeof value !== 'object') return null;
  const type = String(value.type || '');
  if (type === 'text') {
    const body = String(value.text?.body || '').trim();
    if (!body || body.length > 4096) return null;
    return { type: 'text', text: { body } };
  }

  if (!['image', 'video', 'audio', 'document'].includes(type)) return null;
  const media = value[type];
  const link = String(media?.link || '').trim();
  if (!link.startsWith('https://') || link.length > 2048) return null;

  const cleaned = { link };
  const caption = String(media?.caption || '').trim();
  if (caption) cleaned.caption = caption.slice(0, 1024);
  if (type === 'document') {
    const filename = String(media?.filename || '').trim();
    if (filename) cleaned.filename = filename.slice(0, 240);
  }
  return { type, [type]: cleaned };
}

async function hmacHex(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  );
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

  const base44 = createClientFromRequest(req);
  const employeeId = String(body?.employeeId || '');
  let authorized = await validEmployeeSession(
    body?.whatsappSessionToken,
    employeeId,
    secret
  );

  if (!authorized) {
    try {
      authorized = Boolean(await base44.auth.me());
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    return json({
      success: false,
      error: 'employee_session_required',
      message: 'יש לצאת ולהתחבר מחדש לפני שליחת הודעת WhatsApp.'
    }, 401);
  }

  const to = normalizePhone(body?.to);
  const message = cleanMessage(body?.messageObject);
  if (to.length < 10 || to.length > 15 || !message) {
    return json({ success: false, error: 'invalid_message' }, 400);
  }

  const suppliedRequestId = String(body?.requestId || '');
  const requestId = /^[a-zA-Z0-9_-]{8,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();

  const outbound = {
    version: 1,
    request_id: requestId,
    to,
    operator_id: employeeId.slice(0, 128),
    message
  };
  const raw = JSON.stringify(outbound);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacHex(timestamp + '.' + raw, secret);

  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GT-Timestamp': timestamp,
        'X-GT-Signature': 'sha256=' + signature
      },
      body: raw,
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success !== true) {
      console.error('Official WhatsApp send failed', response.status, result?.error || 'unknown');
      return json({
        success: false,
        error: result?.error || 'send_failed',
        message: 'השליחה דרך WhatsApp נכשלה. אפשר לנסות שוב.'
      }, response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    return json({
      success: true,
      message: 'ההודעה נשלחה בהצלחה',
      messageId: result.message_id,
      requestId
    });
  } catch (error) {
    console.error('Official WhatsApp gateway unavailable', error?.name || 'unknown');
    return json({
      success: false,
      error: 'gateway_unavailable',
      message: 'שירות WhatsApp אינו זמין כרגע. אפשר לנסות שוב.'
    }, 503);
  }
});
