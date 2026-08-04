import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Build carrier-specific tracking URL
function getTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) return null;
  const c = (carrier || '').toLowerCase();
  if (c === 'cargo' || c === 'קארגו') {
    return `https://www.cargo.co.il/he/tracking?trackingNumber=${trackingNumber}`;
  }
  if (c === 'ups') {
    return `https://www.ups.com/track?trackNums=${trackingNumber}&loc=he_IL`;
  }
  if (c === 'getpackage') {
    // GetPackage uses its own tracking URL from the shipment record
    return null; // Will be overridden by the tracking_url field
  }
  if (c === 'velo') {
    return `https://www.velodelivery.com/tracking/${trackingNumber}`;
  }
  return null;
}

function getCarrierDisplayName(carrier) {
  const c = (carrier || '').toLowerCase();
  if (c === 'cargo' || c === 'קארגו') return 'קארגו';
  if (c === 'ups') return 'UPS';
  if (c === 'getpackage') return 'GetPackage';
  if (c === 'velo') return 'Velo';
  return carrier || 'חברת המשלוחים';
}

function getCarrierKey(carrier) {
  return (carrier || '').toLowerCase();
}

// Hardcoded fallback message (used only if no template exists in DB)
function buildFallbackMessage(firstName, orderNumber, trackingNumber, carrierName, finalUrl, isUpsPickup, isCargoCourier) {
  let message = `שלום ${firstName} 👋\n\n`;
  message += `ההזמנה שלך מ-GADGET-TEAM`;
  if (orderNumber) message += ` (מספר ${orderNumber})`;
  message += isUpsPickup ? ` נשלחה לנקודת איסוף! 📦\n\n` : ` יצאה למשלוח עם שליח עד הבית! 🚚\n\n`;
  message += `📦 מספר מעקב: ${trackingNumber}\n`;
  message += `🏢 חברת משלוח: ${carrierName}\n`;

  if (finalUrl) {
    message += `\n🔗 למעקב אחרי המשלוח שלך:\n${finalUrl}\n`;
  }

  message += isCargoCourier ? `\nזמן משלוח משוער עם שליח: 1-3 ימי עסקים` : `\nתקבל/י עדכון כשהחבילה תהיה זמינה לאיסוף`;
  message += `\n\n❓ יש שאלות? אפשר להשיב להודעה הזאת ואנחנו כאן בשבילך!`;
  message += `\n\nתודה שבחרת ב-GADGET-TEAM 💜`;
  return message;
}

// Replace template variables with actual values
function applyTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    // Replace both {key} and {{key}} formats
    result = result.replaceAll(`{${key}}`, String(value ?? ''));
    result = result.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return result;
}

// Load a template from the database by key (active only)
async function loadTemplate(sr, key) {
  try {
    const templates = await sr.entities.NotificationTemplate.filter({ template_key: key }, null, 1);
    if (templates.length > 0 && templates[0].is_active !== false) {
      return templates[0].hebrew_template;
    }
  } catch (e) {
    console.error(`[TrackingSMS] Error loading template "${key}":`, e.message);
  }
  return null;
}

Deno.serve(async (req) => {
  const body = await req.json();
  const base44 = createClientFromRequest(req);
  const sr = base44.asServiceRole;

  const { order_id, customer_phone, customer_name, tracking_number, tracking_carrier, tracking_url, order_number } = body;

  if (!customer_phone) {
    return Response.json({ error: 'חסר מספר טלפון' }, { status: 400 });
  }
  if (!tracking_number) {
    return Response.json({ error: 'חסר מספר מעקב' }, { status: 400 });
  }

  const firstName = (customer_name || '').split(' ')[0] || 'לקוח/ה יקר/ה';
  const carrierName = getCarrierDisplayName(tracking_carrier);
  const carrierKey = getCarrierKey(tracking_carrier);
  const autoUrl = getTrackingUrl(tracking_carrier, tracking_number);
  const finalUrl = tracking_url || autoUrl;

  const isUpsPickup = carrierKey === 'ups';
  const isCargoCourier = carrierKey === 'cargo' || carrierKey === 'קארגו';

  // Build template variables
  const orderNumberText = order_number ? ` (מספר ${order_number})` : '';
  const trackingUrlBlock = finalUrl ? `\n🔗 למעקב אחרי המשלוח שלך:\n${finalUrl}\n` : '';
  const deliveryNote = isCargoCourier
    ? `\nזמן משלוח משוער עם שליח: 1-3 ימי עסקים`
    : `\nתקבל/י עדכון כשהחבילה תהיה זמינה לאיסוף`;

  const vars = {
    first_name: firstName,
    order_number: order_number || '',
    order_number_text: orderNumberText,
    tracking_number,
    carrier_name: carrierName,
    carrier_key: carrierKey,
    tracking_url: finalUrl || '',
    tracking_url_block: trackingUrlBlock,
    delivery_note: deliveryNote,
    is_pickup: isUpsPickup ? 'נקודת איסוף' : 'שליח עד הבית',
  };

  // Try to load a carrier-specific template, then fall back to default
  let template = null;
  if (carrierKey) {
    template = await loadTemplate(sr, `tracking_sms_${carrierKey}`);
  }
  if (!template) {
    template = await loadTemplate(sr, 'tracking_sms_default');
  }

  let message;
  if (template) {
    message = applyTemplate(template, vars);
  } else {
    message = buildFallbackMessage(firstName, order_number, tracking_number, carrierName, finalUrl, isUpsPickup, isCargoCourier);
  }

  try {
    await sr.functions.invoke('sendTextMeSMS', {
      action: 'send',
      to_phone: customer_phone,
      message,
      event_type: 'tracking_sms',
      fingerprint: `tracking|${order_id || order_number}|${tracking_number}`,
    });

    // Log activity
    try {
      await sr.entities.Activity.create({
        summary: `SMS מעקב נשלח - ${tracking_number} (${carrierName})`,
        activity_type: 'הודעה',
        content: message,
        order_id: order_id || '',
      });
    } catch (_) { /* activity log is optional */ }

    return Response.json({ success: true, message: 'SMS מעקב נשלח בהצלחה', used_template: !!template });
  } catch (error) {
    console.error('[TrackingSMS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});