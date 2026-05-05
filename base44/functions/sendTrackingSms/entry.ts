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
  const autoUrl = getTrackingUrl(tracking_carrier, tracking_number);
  const finalUrl = tracking_url || autoUrl;

  // Build a friendly, clear SMS message
  let message = `שלום ${firstName} 👋\n\n`;
  message += `ההזמנה שלך מ-GADGET-TEAM`;
  if (order_number) message += ` (מספר ${order_number})`;
  message += ` יצאה לדרך! 🚚\n\n`;
  message += `📦 מספר מעקב: ${tracking_number}\n`;
  message += `🏢 חברת משלוח: ${carrierName}\n`;

  if (finalUrl) {
    message += `\n🔗 למעקב אחרי המשלוח שלך:\n${finalUrl}\n`;
  }

  message += `\nזמן משלוח משוער: 1-3 ימי עסקים`;
  message += `\n\n❓ יש שאלות? אפשר להשיב להודעה הזאת ואנחנו כאן בשבילך!`;
  message += `\n\nתודה שבחרת ב-GADGET-TEAM 💜`;

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

    return Response.json({ success: true, message: 'SMS מעקב נשלח בהצלחה' });
  } catch (error) {
    console.error('[TrackingSMS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});