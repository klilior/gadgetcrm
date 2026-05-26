import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const body = await req.json();
    console.log('[GadgetTeam SMS] Received:', JSON.stringify(body));

    // Support both automation trigger and manual call
    const repairId = body.data?.id || body.repair_id;
    const eventType = body.event?.type;

    if (!repairId) {
      return Response.json({ success: false, error: 'No repair ID' });
    }

    // Get the repair
    const repair = body.data || await base44.asServiceRole.entities.Repair.get(repairId);

    // Only proceed if repair_type is Gadget-Team
    if (repair.repair_type !== 'מעבדת Gadget-Team') {
      console.log('[GadgetTeam SMS] Skipping - not Gadget-Team type:', repair.repair_type);
      return Response.json({ success: true, skipped: true, reason: 'Not Gadget-Team repair' });
    }

    // Load settings
    const allSettings = await base44.asServiceRole.entities.Settings.filter({});
    const getVal = (name, def) => {
      const s = allSettings.find(s => s.setting_name === name);
      return s?.setting_value || def;
    };

    const enabled = getVal('gadget_team_sms_enabled', 'true');
    if (enabled !== 'true') {
      console.log('[GadgetTeam SMS] Disabled');
      return Response.json({ success: true, skipped: true, reason: 'Disabled' });
    }

    const phone = getVal('gadget_team_sms_phone', '0506675766');
    const template = getVal('gadget_team_sms_template', 
      'תיקון חדש מ-GADGET-TEAM:\nדגם: {device_model}\nתקלות: {issues}\nהצעת מחיר: ₪{price}\nמספר תיקון: {repair_id}');

    if (!phone) {
      return Response.json({ success: false, error: 'No phone configured' });
    }

    // Get device info
    let deviceModel = 'לא ידוע';
    if (repair.device_id) {
      try {
        const device = await base44.asServiceRole.entities.RepairDevice.get(repair.device_id);
        if (device) {
          const manufacturer = device.manufacturer || '';
          const model = device.model || '';
          deviceModel = `${manufacturer} ${model}`.trim() || 'לא ידוע';
        }
      } catch (e) {
        console.log('[GadgetTeam SMS] Could not load device:', e.message);
      }
    }

    // Build message from template
    const issues = [repair.issue_category, repair.issue_description].filter(Boolean).join(' - ') || 'לא פורט';
    const price = repair.expected_price != null ? String(repair.expected_price) : 'לא צוין';
    
    const message = template
      .replace(/\{device_model\}/g, deviceModel)
      .replace(/\{issues\}/g, issues)
      .replace(/\{price\}/g, price)
      .replace(/\{repair_id\}/g, repair.repair_id || repairId)
      .replace(/\{issue_category\}/g, repair.issue_category || '')
      .replace(/\{issue_description\}/g, repair.issue_description || '');

    console.log(`[GadgetTeam SMS] Sending to ${phone}: ${message}`);

    // Send via sendTextMeSMS function
    const smsResult = await base44.asServiceRole.functions.invoke('sendTextMeSMS', {
      action: 'send',
      to_phone: phone,
      message: message,
      event_type: 'gadget_team_repair',
      fingerprint: `gadget_team|${repairId}|${new Date().toISOString().split('T')[0]}`,
    });

    console.log('[GadgetTeam SMS] SMS result:', JSON.stringify(smsResult));

    return Response.json({ success: true, sms_result: smsResult });
  } catch (error) {
    console.error('[GadgetTeam SMS] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});