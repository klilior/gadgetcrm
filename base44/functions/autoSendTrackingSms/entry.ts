import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const body = await req.json();
  const base44 = createClientFromRequest(req);
  const sr = base44.asServiceRole;

  const { event, data, old_data } = body;

  // Only process if tracking_number was just added (didn't exist before, exists now)
  const newTrack = data?.tracking_number;
  const oldTrack = old_data?.tracking_number;

  if (!newTrack || newTrack === oldTrack) {
    console.log('[AutoTrackingSMS] No new tracking number, skipping.');
    return Response.json({ skipped: true, reason: 'no_new_tracking' });
  }

  // Check business hours: 9:00-21:00 Israel time
  const now = new Date();
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const hour = israelTime.getHours();

  if (hour < 9 || hour >= 21) {
    console.log(`[AutoTrackingSMS] Outside business hours (${hour}:00 Israel), skipping.`);
    return Response.json({ skipped: true, reason: 'outside_hours', hour });
  }

  // Get customer phone from the linked client
  const clientId = data.client_id;
  let customerPhone = '';
  let customerName = '';

  if (clientId) {
    try {
      const clients = await sr.entities.Client.filter({ id: clientId }, null, 1);
      if (clients.length > 0) {
        customerPhone = clients[0].phone || '';
        customerName = clients[0].full_name || '';
      }
    } catch (e) {
      console.error('[AutoTrackingSMS] Error fetching client:', e.message);
    }
  }

  // Fallback: try to get phone from billing data
  if (!customerPhone && data.raw_data_billing) {
    try {
      const billing = JSON.parse(data.raw_data_billing);
      customerPhone = billing.phone || '';
      if (!customerName) customerName = [billing.first_name, billing.last_name].filter(Boolean).join(' ');
    } catch (_) {}
  }

  if (!customerPhone) {
    console.log('[AutoTrackingSMS] No customer phone found, skipping.');
    return Response.json({ skipped: true, reason: 'no_phone' });
  }

  // Check if we already sent SMS for this tracking number (prevent duplicates)
  try {
    const existing = await sr.entities.Activity.filter({
      order_id: event.entity_id,
      activity_type: 'הודעה',
    }, '-created_date', 10);
    const alreadySent = existing.some(a => 
      a.summary?.includes(newTrack) && a.summary?.includes('SMS מעקב')
    );
    if (alreadySent) {
      console.log('[AutoTrackingSMS] SMS already sent for this tracking number, skipping.');
      return Response.json({ skipped: true, reason: 'already_sent' });
    }
  } catch (_) {}

  // Send the tracking SMS via the existing function
  console.log(`[AutoTrackingSMS] Sending tracking SMS to ${customerPhone} for order ${data.external_order_number}, tracking: ${newTrack}`);
  
  try {
    await sr.functions.invoke('sendTrackingSms', {
      order_id: event.entity_id,
      customer_phone: customerPhone,
      customer_name: customerName,
      tracking_number: newTrack,
      tracking_carrier: data.tracking_carrier || '',
      tracking_url: data.tracking_url || '',
      order_number: data.external_order_number || '',
    });

    console.log('[AutoTrackingSMS] SMS sent successfully.');
    return Response.json({ success: true, phone: customerPhone, tracking: newTrack });
  } catch (error) {
    console.error('[AutoTrackingSMS] Error sending SMS:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});