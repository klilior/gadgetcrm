import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// ─── Helpers ───
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  if (p.startsWith('972')) p = '0' + p.slice(3);
  if (/^5\d{8}$/.test(p)) p = '0' + p;
  if (!/^05\d{8}$/.test(p)) return null;
  return p;
}

function validateSource(src) {
  if (!src || src.length > 11) return false;
  return /^[0-9A-Za-z]+$/.test(src);
}

function isWithinAllowedHours(startStr, endStr) {
  const now = new Date();
  const jerusalemTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const currentMinutes = jerusalemTime.getHours() * 60 + jerusalemTime.getMinutes();
  const [sh, sm] = (startStr || '08:00').split(':').map(Number);
  const [eh, em] = (endStr || '22:00').split(':').map(Number);
  return currentMinutes >= (sh * 60 + sm) && currentMinutes <= (eh * 60 + em);
}

// ─── Internal send (reusable) ───
async function sendSMSInternal(base44, config, params) {
  const { to_phone, message, event_type, fingerprint, linked_product, linked_alert } = params;
  const now = new Date().toISOString();

  if (!config.is_enabled) return { success: false, error: 'disabled' };

  const normalizedPhone = normalizePhone(to_phone);
  if (!normalizedPhone) {
    await base44.asServiceRole.entities.NotificationLog.create({
      event_type: event_type || 'unknown', to_phone: to_phone || '', message,
      status: 'נכשל', fingerprint: fingerprint || '', sent_at: now,
      provider_response: `טלפון לא תקין: ${to_phone}`,
    });
    return { success: false, error: 'bad phone' };
  }

  // Allowed hours
  if (!isWithinAllowedHours(config.allowed_hours_start, config.allowed_hours_end)) {
    await base44.asServiceRole.entities.NotificationLog.create({
      event_type: event_type || 'unknown', to_phone: normalizedPhone, message,
      status: 'נחסם-שעות', fingerprint: fingerprint || '', sent_at: now,
      provider_response: 'מחוץ לשעות מותרות',
      linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
    });
    return { success: false, error: 'blocked hours' };
  }

  // Dedup
  if (fingerprint) {
    const recentLogs = await base44.asServiceRole.entities.NotificationLog.filter(
      { fingerprint, to_phone: normalizedPhone, status: 'נשלח' }, '-sent_at', 5
    );
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (recentLogs.some(l => l.sent_at && l.sent_at > oneHourAgo)) {
      await base44.asServiceRole.entities.NotificationLog.create({
        event_type: event_type || 'unknown', to_phone: normalizedPhone, message,
        status: 'כפילות', fingerprint, sent_at: now,
        provider_response: 'כפילות ב-60 דקות',
        linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
      });
      return { success: false, error: 'dedup' };
    }
  }

  const apiToken = Deno.env.get('TEXTME_API_TOKEN');
  if (!apiToken) return { success: false, error: 'no token' };

  const endpoint = config.test_mode ? 'https://my.textme.co.il/api/test' : 'https://my.textme.co.il/api';
  const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;

  const payload = {
    sms: {
      user: { username: config.username },
      source: config.default_source,
      destinations: { phone: apiPhone },
      message,
    },
  };

  console.log(`[SMS] Sending to ${apiPhone} via ${endpoint} (test=${config.test_mode})`);
  console.log(`[SMS] Payload: ${JSON.stringify(payload)}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  console.log(`[SMS] Response ${res.status}: ${responseText.substring(0, 500)}`);

  await base44.asServiceRole.entities.NotificationLog.create({
    event_type: event_type || 'alert', to_phone: normalizedPhone, message,
    status: res.ok ? 'נשלח' : 'נכשל',
    fingerprint: fingerprint || '', sent_at: now,
    provider_response: `HTTP ${res.status}: ${responseText.substring(0, 500)}`,
    linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
  });

  return { success: res.ok, provider_response: responseText.substring(0, 300) };
}

// ─── Main handler ───
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Skip base44 auth entirely - this app uses custom Employee auth
    // All entity operations use asServiceRole which doesn't require user auth

    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error('[SMS] Failed to parse body:', parseErr.message);
      return Response.json({ error: 'Failed to parse request body' }, { status: 400 });
    }
    const { action } = body;
    console.log(`[SMS] Action: ${action}, body keys: ${Object.keys(body).join(', ')}`);

    // Load config once
    const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
    if (!configs || configs.length === 0) {
      return Response.json({ success: false, error: 'לא נמצאה הגדרת TextMe. יש ליצור רשומת הגדרות קודם.' });
    }
    const config = configs[0];

    // ═══════ ACTION: send ═══════
    if (action === 'send') {
      const { to_phone, message, source, timing, event_type, fingerprint, linked_product, linked_alert } = body;
      const now = new Date().toISOString();

      if (!config.is_enabled) {
        return Response.json({ success: false, status: 'disabled', error: 'שירות SMS מושבת' });
      }

      const normalizedPhone = normalizePhone(to_phone);
      if (!normalizedPhone) {
        return Response.json({ success: false, error: `טלפון לא תקין: ${to_phone}` });
      }

      const finalSource = source || config.default_source;
      if (!validateSource(finalSource)) {
        return Response.json({ success: false, error: `שם שולח לא תקין: ${finalSource}` });
      }

      if (!message || message.length === 0) return Response.json({ success: false, error: 'הודעה ריקה' });
      if (message.length > 1005) return Response.json({ success: false, error: `הודעה ארוכה מדי (${message.length}/1005)` });

      // Allowed hours
      if (!isWithinAllowedHours(config.allowed_hours_start, config.allowed_hours_end)) {
        await base44.asServiceRole.entities.NotificationLog.create({
          event_type: event_type || 'unknown', to_phone: normalizedPhone, message,
          status: 'נחסם-שעות', fingerprint: fingerprint || '', sent_at: now,
          provider_response: `מחוץ לשעות מותרות (${config.allowed_hours_start}-${config.allowed_hours_end})`,
          linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
        });
        return Response.json({ success: false, status: 'blocked_hours', error: 'מחוץ לשעות שליחה מותרות' });
      }

      // Dedup
      if (fingerprint) {
        const recentLogs = await base44.asServiceRole.entities.NotificationLog.filter(
          { fingerprint, to_phone: normalizedPhone, status: 'נשלח' }, '-sent_at', 5
        );
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        if (recentLogs.some(l => l.sent_at && l.sent_at > oneHourAgo)) {
          return Response.json({ success: false, status: 'dedup', error: 'הודעה זהה נשלחה ב-60 דק האחרונות' });
        }
      }

      // Rate limit
      const recentSends = await base44.asServiceRole.entities.NotificationLog.filter({ status: 'נשלח' }, '-sent_at', 50);
      const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const sendsInLastMinute = recentSends.filter(l => l.sent_at && l.sent_at > oneMinAgo).length;
      if (sendsInLastMinute >= (config.rate_limit_per_minute || 10)) {
        return Response.json({ success: false, status: 'rate_limited', error: 'חריגת מגבלת שליחות' });
      }

      // Send
      const apiToken = Deno.env.get('TEXTME_API_TOKEN');
      if (!apiToken) return Response.json({ success: false, error: 'חסר TEXTME_API_TOKEN' });

      const endpoint = config.test_mode ? 'https://my.textme.co.il/api/test' : 'https://my.textme.co.il/api';
      const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;

      const payloadObj = {
        sms: {
          user: { username: config.username }, source: finalSource,
          destinations: { phone: apiPhone }, message,
        },
      };
      if (timing) payloadObj.sms.timing = timing;

      console.log(`[SMS] Sending to ${apiPhone} via ${endpoint}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payloadObj),
      });

      const responseText = await res.text();
      console.log(`[SMS] Response ${res.status}: ${responseText.substring(0, 500)}`);

      await base44.asServiceRole.entities.NotificationLog.create({
        event_type: event_type || 'manual', to_phone: normalizedPhone, message,
        status: res.ok ? 'נשלח' : 'נכשל', fingerprint: fingerprint || '', sent_at: now,
        provider_response: `HTTP ${res.status}: ${responseText.substring(0, 500)}`,
        linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
      });

      return Response.json({ success: res.ok, test_mode: config.test_mode, provider_response: responseText.substring(0, 300) });
    }

    // ═══════ ACTION: send_alert_sms ═══════
    if (action === 'send_alert_sms') {
      const { alert_id } = body;
      if (!alert_id) return Response.json({ success: false, error: 'חסר alert_id' });

      const alert = await base44.asServiceRole.entities.PriceAlert.get(alert_id);
      if (!alert) return Response.json({ success: false, error: 'התראה לא נמצאה' });

      if (!['קריטי', 'גבוה'].includes(alert.priority) || !alert.requires_action || alert.is_read) {
        return Response.json({ success: true, status: 'skipped', reason: 'לא עומד בקריטריונים' });
      }

      const product = alert.linked_product
        ? await base44.asServiceRole.entities.ProductsMonitor.get(alert.linked_product) : null;

      let snapshot = null;
      if (alert.source_snapshot) {
        snapshot = await base44.asServiceRole.entities.PriceSnapshot.get(alert.source_snapshot);
      }

      const pName = product?.product_name || 'מוצר';
      const pos = alert.new_position || snapshot?.my_position || '?';
      const desPos = product?.desired_position || '?';
      const myPrice = snapshot?.my_price_on_site || product?.my_current_price || '?';
      const abvStore = snapshot?.position_above_me_store || '-';
      const abvPrice = snapshot?.position_above_me_price || '-';
      const blwStore = snapshot?.position_below_me_store || '-';
      const blwPrice = snapshot?.position_below_me_price || '-';

      const smsMsg = `התראת Zap: ${pName} | מיקום #${pos} (יעד #${desPos}). מחיר באתר: ₪${myPrice}. מעליך: ${abvStore} ₪${abvPrice}. מתחתיך: ${blwStore} ₪${blwPrice}. היכנס לדשבורד לטיפול.`;
      const smsFP = `alert_sms|${alert_id}|pos:${pos}|price:${myPrice}`;

      if (!config.admin_phones) {
        return Response.json({ success: false, error: 'לא הוגדרו טלפונים לקבלת התראות' });
      }

      const phones = config.admin_phones.split(',').map(p => p.trim()).filter(Boolean);
      let sent = 0, failed = 0;

      for (const phone of phones) {
        const r = await sendSMSInternal(base44, config, {
          to_phone: phone, message: smsMsg,
          event_type: `zap_alert_${alert.alert_type}`,
          fingerprint: `${smsFP}|${phone}`,
          linked_product: alert.linked_product || undefined,
          linked_alert: alert_id,
        });
        if (r.success) sent++; else failed++;
      }

      return Response.json({ success: true, sent, failed, total: phones.length });
    }

    // ═══════ ACTION: test ═══════
    if (action === 'test') {
      const to_phone = body.to_phone || body.phone;
      const message = body.message;
      console.log(`[SMS-TEST] to_phone=${to_phone}, message=${message}`);
      if (!to_phone || !message) return Response.json({ success: false, error: 'חסר טלפון או הודעה' });

      const normalizedPhone = normalizePhone(to_phone);
      if (!normalizedPhone) return Response.json({ success: false, error: `טלפון לא תקין: ${to_phone}` });

      const apiToken = Deno.env.get('TEXTME_API_TOKEN');
      if (!apiToken) return Response.json({ success: false, error: 'חסר TEXTME_API_TOKEN' });

      const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;
      const payload = {
        sms: {
          user: { username: config.username }, source: config.default_source,
          destinations: { phone: apiPhone }, message,
        },
      };

      const testEndpoint = config.test_mode ? 'https://my.textme.co.il/api/test' : 'https://my.textme.co.il/api';
      console.log(`[SMS-TEST] Sending to ${apiPhone} via ${testEndpoint} (test_mode=${config.test_mode}), payload: ${JSON.stringify(payload)}`);
      const res = await fetch(testEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload),
      });
      const responseText = await res.text();
      console.log(`[SMS-TEST] ${res.status}: ${responseText}`);

      await base44.asServiceRole.entities.NotificationLog.create({
        event_type: 'test', to_phone: normalizedPhone, message,
        status: res.ok ? 'נשלח' : 'נכשל',
        fingerprint: `test|${Date.now()}`, sent_at: new Date().toISOString(),
        provider_response: `[TEST] HTTP ${res.status}: ${responseText.substring(0, 500)}`,
      });

      return Response.json({ success: res.ok, test_mode: true, http_status: res.status, provider_response: responseText.substring(0, 500) });
    }

    return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });

  } catch (error) {
    console.error('[SMS] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});