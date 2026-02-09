import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
  // Check current time in Asia/Jerusalem
  const now = new Date();
  const jerusalemTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const currentMinutes = jerusalemTime.getHours() * 60 + jerusalemTime.getMinutes();
  
  const [sh, sm] = (startStr || '08:00').split(':').map(Number);
  const [eh, em] = (endStr || '22:00').split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    
    const body = await req.json();
    const { action } = body;
    
    // ═══════ ACTION: send ═══════
    if (action === 'send') {
      const { to_phone, message, source, timing, event_type, fingerprint, linked_product, linked_alert } = body;
      const now = new Date().toISOString();
      
      // 1. Load config
      const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
      if (!configs || configs.length === 0) {
        return Response.json({ success: false, status: 'disabled', error: 'לא נמצאה הגדרת TextMe' });
      }
      const config = configs[0];
      
      if (!config.is_enabled) {
        console.log('[SMS] Service disabled');
        return Response.json({ success: false, status: 'disabled', error: 'שירות SMS מושבת' });
      }
      
      // 2. Validate phone
      const normalizedPhone = normalizePhone(to_phone);
      if (!normalizedPhone) {
        console.log(`[SMS] Invalid phone: ${to_phone}`);
        await base44.asServiceRole.entities.NotificationLog.create({
          event_type: event_type || 'unknown', to_phone: to_phone || '', message: message || '',
          status: 'נכשל', fingerprint: fingerprint || '', sent_at: now,
          provider_response: `טלפון לא תקין: ${to_phone}`,
          linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
        });
        return Response.json({ success: false, error: `טלפון לא תקין: ${to_phone}` });
      }
      
      // 3. Validate source
      const finalSource = source || config.default_source;
      if (!validateSource(finalSource)) {
        return Response.json({ success: false, error: `שם שולח לא תקין: ${finalSource} (עד 11 תווים, אנגלית/מספרים בלבד)` });
      }
      
      // 4. Validate message
      if (!message || message.length === 0) {
        return Response.json({ success: false, error: 'הודעה ריקה' });
      }
      if (message.length > 1005) {
        return Response.json({ success: false, error: `הודעה ארוכה מדי (${message.length}/1005)` });
      }
      
      // 5. Allowed hours check
      if (!isWithinAllowedHours(config.allowed_hours_start, config.allowed_hours_end)) {
        console.log(`[SMS] Outside allowed hours (${config.allowed_hours_start}-${config.allowed_hours_end})`);
        await base44.asServiceRole.entities.NotificationLog.create({
          event_type: event_type || 'unknown', to_phone: normalizedPhone, message,
          status: 'נחסם-שעות', fingerprint: fingerprint || '', sent_at: now,
          provider_response: `מחוץ לשעות מותרות (${config.allowed_hours_start}-${config.allowed_hours_end})`,
          linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
        });
        return Response.json({ success: false, status: 'blocked_hours', error: 'מחוץ לשעות שליחה מותרות' });
      }
      
      // 6. Dedup check — same fingerprint+phone with status "נשלח" in last 60 min
      if (fingerprint) {
        const recentLogs = await base44.asServiceRole.entities.NotificationLog.filter(
          { fingerprint, to_phone: normalizedPhone, status: 'נשלח' }, '-sent_at', 5
        );
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const isDup = recentLogs.some(l => l.sent_at && l.sent_at > oneHourAgo);
        if (isDup) {
          console.log(`[SMS] Dedup blocked: ${fingerprint} to ${normalizedPhone}`);
          await base44.asServiceRole.entities.NotificationLog.create({
            event_type: event_type || 'unknown', to_phone: normalizedPhone, message,
            status: 'כפילות', fingerprint, sent_at: now,
            provider_response: 'הודעה זהה נשלחה ב-60 דקות האחרונות',
            linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
          });
          return Response.json({ success: false, status: 'dedup', error: 'הודעה זהה נשלחה לאחרונה' });
        }
      }
      
      // 7. Rate limit check — count sends in last minute
      const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const recentSends = await base44.asServiceRole.entities.NotificationLog.filter(
        { status: 'נשלח' }, '-sent_at', 50
      );
      const sendsInLastMinute = recentSends.filter(l => l.sent_at && l.sent_at > oneMinAgo).length;
      const rateLimit = config.rate_limit_per_minute || 10;
      if (sendsInLastMinute >= rateLimit) {
        console.log(`[SMS] Rate limited: ${sendsInLastMinute}/${rateLimit} per minute`);
        return Response.json({ success: false, status: 'rate_limited', error: `חריגת מגבלת שליחות (${rateLimit}/דקה)` });
      }
      
      // 8. Build request
      const apiToken = Deno.env.get('TEXTME_API_TOKEN');
      if (!apiToken) {
        return Response.json({ success: false, error: 'חסר TEXTME_API_TOKEN בסביבה' });
      }
      
      const endpoint = config.test_mode 
        ? 'https://my.textme.co.il/api/test' 
        : 'https://my.textme.co.il/api';
      
      // Format phone for API: strip leading 0 → 5xxxxxxxx
      const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;
      
      const payload = {
        username: config.username,
        source: finalSource,
        destinations: { phone: apiPhone },
        message: message,
      };
      if (timing) payload.timing = timing;
      
      console.log(`[SMS] Sending to ${apiPhone} via ${endpoint} (test_mode=${config.test_mode})`);
      console.log(`[SMS] Source: ${finalSource}, Message length: ${message.length}`);
      
      // 9. Send
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });
      
      const responseText = await res.text();
      console.log(`[SMS] Response ${res.status}: ${responseText.substring(0, 500)}`);
      
      const isSuccess = res.ok;
      
      // 10. Log
      await base44.asServiceRole.entities.NotificationLog.create({
        event_type: event_type || 'manual',
        to_phone: normalizedPhone,
        message,
        status: isSuccess ? 'נשלח' : 'נכשל',
        fingerprint: fingerprint || '',
        sent_at: now,
        provider_response: `HTTP ${res.status}: ${responseText.substring(0, 500)}`,
        linked_product: linked_product || undefined,
        linked_alert: linked_alert || undefined,
      });
      
      return Response.json({
        success: isSuccess,
        status: isSuccess ? 'sent' : 'failed',
        test_mode: config.test_mode,
        provider_response: responseText.substring(0, 300),
      });
    }
    
    // ═══════ ACTION: send_alert_sms (called when PriceAlert created) ═══════
    if (action === 'send_alert_sms') {
      const { alert_id } = body;
      if (!alert_id) return Response.json({ success: false, error: 'חסר alert_id' });
      
      // Load alert
      const alert = await base44.asServiceRole.entities.PriceAlert.get(alert_id);
      if (!alert) return Response.json({ success: false, error: 'התראה לא נמצאה' });
      
      // Only send for high-priority actionable alerts
      const highPriorities = ['קריטי', 'גבוה'];
      if (!highPriorities.includes(alert.priority) || !alert.requires_action || alert.is_read) {
        console.log(`[SMS-Alert] Skipped: priority=${alert.priority} requires_action=${alert.requires_action} is_read=${alert.is_read}`);
        return Response.json({ success: true, status: 'skipped', reason: 'לא עומד בקריטריונים לשליחת SMS' });
      }
      
      // Load product
      const product = alert.linked_product 
        ? await base44.asServiceRole.entities.ProductsMonitor.get(alert.linked_product)
        : null;
      
      // Load latest snapshot for price data
      let snapshot = null;
      if (alert.source_snapshot) {
        snapshot = await base44.asServiceRole.entities.PriceSnapshot.get(alert.source_snapshot);
      }
      
      // Build deterministic Hebrew SMS
      const productName = product?.product_name || 'מוצר לא ידוע';
      const position = alert.new_position || snapshot?.my_position || '?';
      const desiredPos = product?.desired_position || '?';
      const myPrice = snapshot?.my_price_on_site || product?.my_current_price || '?';
      const aboveStore = snapshot?.position_above_me_store || '-';
      const abovePrice = snapshot?.position_above_me_price || '-';
      const belowStore = snapshot?.position_below_me_store || '-';
      const belowPrice = snapshot?.position_below_me_price || '-';
      
      const smsMessage = `התראת Zap: ${productName} | מיקום #${position} (יעד #${desiredPos}). מחיר באתר: ₪${myPrice}. מעליך: ${aboveStore} ₪${abovePrice}. מתחתיך: ${belowStore} ₪${belowPrice}. היכנס לדשבורד לטיפול.`;
      
      const smsFingerprint = `alert_sms|${alert_id}|pos:${position}|price:${myPrice}`;
      
      // Load config for admin phones
      const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
      if (!configs || configs.length === 0) {
        return Response.json({ success: false, error: 'לא נמצאה הגדרת TextMe' });
      }
      const config = configs[0];
      
      if (!config.admin_phones) {
        console.log('[SMS-Alert] No admin phones configured');
        return Response.json({ success: false, error: 'לא הוגדרו טלפונים לקבלת התראות' });
      }
      
      const phones = config.admin_phones.split(',').map(p => p.trim()).filter(Boolean);
      console.log(`[SMS-Alert] Sending to ${phones.length} admins: ${phones.join(', ')}`);
      
      let sent = 0, failed = 0;
      for (const phone of phones) {
        // Recursive call to 'send' action internally
        const sendResult = await sendSMSInternal(base44, {
          to_phone: phone,
          message: smsMessage,
          event_type: `zap_alert_${alert.alert_type}`,
          fingerprint: `${smsFingerprint}|${phone}`,
          linked_product: alert.linked_product || undefined,
          linked_alert: alert_id,
        });
        if (sendResult.success) sent++;
        else failed++;
      }
      
      return Response.json({ success: true, sent, failed, total: phones.length });
    }
    
    // ═══════ ACTION: test ═══════
    if (action === 'test') {
      const { to_phone, message } = body;
      if (!to_phone || !message) {
        return Response.json({ success: false, error: 'חסר טלפון או הודעה' });
      }
      
      // Force test mode for this call
      const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
      if (!configs || configs.length === 0) {
        return Response.json({ success: false, error: 'יש ליצור הגדרת TextMe קודם' });
      }
      const config = configs[0];
      
      const normalizedPhone = normalizePhone(to_phone);
      if (!normalizedPhone) {
        return Response.json({ success: false, error: `טלפון לא תקין: ${to_phone}` });
      }
      
      const apiToken = Deno.env.get('TEXTME_API_TOKEN');
      if (!apiToken) {
        return Response.json({ success: false, error: 'חסר TEXTME_API_TOKEN' });
      }
      
      const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;
      const payload = {
        username: config.username,
        source: config.default_source,
        destinations: { phone: apiPhone },
        message,
      };
      
      console.log(`[SMS-TEST] Sending test to ${apiPhone}`);
      
      const res = await fetch('https://my.textme.co.il/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });
      
      const responseText = await res.text();
      console.log(`[SMS-TEST] Response ${res.status}: ${responseText}`);
      
      await base44.asServiceRole.entities.NotificationLog.create({
        event_type: 'test', to_phone: normalizedPhone, message,
        status: res.ok ? 'נשלח' : 'נכשל',
        fingerprint: `test|${Date.now()}`, sent_at: new Date().toISOString(),
        provider_response: `[TEST] HTTP ${res.status}: ${responseText.substring(0, 500)}`,
      });
      
      return Response.json({
        success: res.ok,
        test_mode: true,
        http_status: res.status,
        provider_response: responseText.substring(0, 500),
      });
    }
    
    return Response.json({ error: 'פעולה לא מוכרת. השתמש ב-send, send_alert_sms, או test' }, { status: 400 });
    
  } catch (error) {
    console.error('[SMS] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ─── Internal send helper (reusable within this function) ───
async function sendSMSInternal(base44, params) {
  const { to_phone, message, event_type, fingerprint, linked_product, linked_alert } = params;
  const now = new Date().toISOString();
  
  const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
  if (!configs?.length) return { success: false, error: 'no config' };
  const config = configs[0];
  
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
      provider_response: `מחוץ לשעות מותרות`,
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
  
  // Send
  const apiToken = Deno.env.get('TEXTME_API_TOKEN');
  if (!apiToken) return { success: false, error: 'no token' };
  
  const endpoint = config.test_mode ? 'https://my.textme.co.il/api/test' : 'https://my.textme.co.il/api';
  const apiPhone = normalizedPhone.startsWith('0') ? normalizedPhone.slice(1) : normalizedPhone;
  
  const payload = {
    username: config.username,
    source: config.default_source,
    destinations: { phone: apiPhone },
    message,
  };
  
  console.log(`[SMS-Internal] Sending to ${apiPhone} via ${endpoint}`);
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });
  
  const responseText = await res.text();
  
  await base44.asServiceRole.entities.NotificationLog.create({
    event_type: event_type || 'alert', to_phone: normalizedPhone, message,
    status: res.ok ? 'נשלח' : 'נכשל',
    fingerprint: fingerprint || '', sent_at: now,
    provider_response: `HTTP ${res.status}: ${responseText.substring(0, 500)}`,
    linked_product: linked_product || undefined, linked_alert: linked_alert || undefined,
  });
  
  return { success: res.ok };
}

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