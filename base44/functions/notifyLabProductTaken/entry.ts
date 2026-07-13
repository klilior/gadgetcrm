import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Sends a short control SMS to the Hello-Hello / Gadget-Team lab owner
// whenever a product is taken from the lab. Uses the same owner phone
// that repair-intake notifications go to (Settings: gadget_team_sms_phone).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const productName = body.product_name || 'לא צוין';
    const amount = body.amount != null ? String(body.amount) : 'לא צוין';
    const takenBy = body.taken_by || 'לא ידוע';
    const creditId = body.credit_id || '';

    // Read owner phone from Settings (same source as repair intake SMS)
    const allSettings = await base44.asServiceRole.entities.Settings.filter({});
    const getVal = (name, def) => {
      const s = allSettings.find((s) => s.setting_name === name);
      return s?.setting_value || def;
    };

    const phone = getVal('gadget_team_sms_phone', '0506675766');
    if (!phone) {
      return Response.json({ success: false, error: 'No owner phone configured' });
    }

    const message = `בקרה - נלקח מוצר מהמעבדה:\nמוצר: ${productName}\nעלות: ₪${amount}\nנלקח ע״י: ${takenBy}`;

    const smsResult = await base44.asServiceRole.functions.invoke('sendTextMeSMS', {
      action: 'send',
      to_phone: phone,
      message,
      event_type: 'lab_product_taken',
      fingerprint: `lab_product_taken|${creditId || `${productName}|${Date.now()}`}`,
    });

    const smsData = smsResult?.data ?? smsResult;
    return Response.json({ success: true, sent_to: phone, sms_success: smsData?.success, sms_error: smsData?.error || null });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});