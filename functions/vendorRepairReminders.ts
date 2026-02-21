import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Helper: get short repair ID (last digits after last dash)
function getShortRepairId(repairId) {
  if (!repairId) return '----';
  const parts = repairId.split('-');
  if (parts.length >= 3) return parts[parts.length - 1];
  const match = repairId.match(/(\d{4})$/);
  return match ? match[1] : repairId.slice(-4);
}

// Direct SMS send helper (avoids cross-function auth issues)
async function sendSMS(base44, to_phone, message, event_type, fingerprint) {
  try {
    // Normalize phone
    let p = String(to_phone).replace(/[\s\-\(\)]/g, '');
    if (p.startsWith('+972')) p = '0' + p.slice(4);
    if (p.startsWith('972')) p = '0' + p.slice(3);
    if (/^5\d{8}$/.test(p)) p = '0' + p;
    if (!/^05\d{8}$/.test(p)) {
      console.log(`[SMS] Invalid phone: ${to_phone}`);
      return { success: false, error: 'bad phone' };
    }

    const configs = await base44.asServiceRole.entities.TextMeConfig.list('-created_date', 1);
    if (!configs?.length || !configs[0].is_enabled) return { success: false, error: 'disabled' };
    const config = configs[0];

    const apiToken = Deno.env.get('TEXTME_API_TOKEN');
    if (!apiToken) return { success: false, error: 'no token' };

    const apiPhone = p.startsWith('0') ? p.slice(1) : p;
    const endpoint = config.test_mode ? 'https://my.textme.co.il/api/test' : 'https://my.textme.co.il/api';

    const payload = {
      sms: {
        user: { username: config.username },
        source: config.default_source,
        destinations: { phone: apiPhone },
        message,
      },
    };

    console.log(`[SMS] Sending to ${apiPhone} via ${endpoint}`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify(payload),
    });
    const responseText = await res.text();
    console.log(`[SMS] Response ${res.status}: ${responseText.substring(0, 300)}`);

    await base44.asServiceRole.entities.NotificationLog.create({
      event_type, to_phone: p, message,
      status: res.ok ? 'נשלח' : 'נכשל',
      fingerprint: fingerprint || '', sent_at: new Date().toISOString(),
      provider_response: `HTTP ${res.status}: ${responseText.substring(0, 500)}`,
    });

    return { success: res.ok };
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, error: err.message };
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Auth check
    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = { role: 'user' }; }

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const action = body.action || 'daily_7day_check';

    console.log(`[VendorReminders] Action: ${action}`);

    // Load all repairs at importer
    const atImporterRepairs = await base44.asServiceRole.entities.Repair.filter(
      { status: 'At_Importer' }, '-created_date', 500
    );
    console.log(`[VendorReminders] Found ${atImporterRepairs.length} repairs at importer`);

    if (atImporterRepairs.length === 0) {
      return Response.json({ success: true, message: 'No repairs at importer', sent: 0 });
    }

    // Load vendors and devices
    const vendors = await base44.asServiceRole.entities.RepairVendor.filter({ active: true });
    const vendorsMap = vendors.reduce((acc, v) => ({ ...acc, [v.id]: v }), {});

    const deviceIds = [...new Set(atImporterRepairs.map(r => r.device_id).filter(Boolean))];
    let devicesMap = {};
    if (deviceIds.length > 0) {
      const devices = await base44.asServiceRole.entities.RepairDevice.list('-created_date', 500);
      devicesMap = devices.reduce((acc, d) => ({ ...acc, [d.id]: d }), {});
    }

    // Load clients for names
    const clientIds = [...new Set(atImporterRepairs.map(r => r.client_id).filter(Boolean))];
    let clientsMap = {};
    if (clientIds.length > 0) {
      const clients = await base44.asServiceRole.entities.Client.list('-created_date', 1000);
      clientsMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});
    }

    const now = new Date();
    let totalSent = 0;
    let totalFailed = 0;

    // ═══════ ACTION: daily_7day_check ═══════
    // Send reminder for each repair that has been at importer for 7+ days
    if (action === 'daily_7day_check') {
      for (const repair of atImporterRepairs) {
        const createdDate = new Date(repair.created_date);
        const daysAtImporter = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

        if (daysAtImporter < 7) continue;

        const vendor = vendorsMap[repair.vendor_id];
        if (!vendor || !vendor.mobile) continue;

        const device = devicesMap[repair.device_id];
        const client = clientsMap[repair.client_id];
        const shortId = getShortRepairId(repair.repair_id);
        const model = device?.model || 'מכשיר לא ידוע';
        const clientName = client?.full_name || 'לקוח';

        const message = `שלום ${vendor.name}, תזכורת מ-Gadget-Team: תיקון #${shortId} נמצא אצלכם כבר ${daysAtImporter} ימים. לקוח: ${clientName}, מכשיר: ${model}. נודה לעדכון סטטוס. תודה!`;
        const fingerprint = `vendor_7day|${repair.id}|day${daysAtImporter}`;

        // Send to main mobile + additional phones
        const phones = [vendor.mobile, ...(vendor.additional_phones || [])].filter(Boolean);

        for (const phone of phones) {
          const result = await sendSMS(base44, phone, message, 'vendor_reminder_7day', `${fingerprint}|${phone}`);
          if (result.success) totalSent++; else totalFailed++;
        }
      }

      return Response.json({
        success: true,
        action: 'daily_7day_check',
        repairs_checked: atImporterRepairs.length,
        sent: totalSent,
        failed: totalFailed,
      });
    }

    // ═══════ ACTION: weekly_summary ═══════
    // Send summary of all open repairs per vendor (Tuesday 11:00)
    if (action === 'weekly_summary') {
      // Group repairs by vendor
      const repairsByVendor = {};
      for (const repair of atImporterRepairs) {
        if (!repair.vendor_id) continue;
        if (!repairsByVendor[repair.vendor_id]) repairsByVendor[repair.vendor_id] = [];
        repairsByVendor[repair.vendor_id].push(repair);
      }

      for (const [vendorId, vendorRepairs] of Object.entries(repairsByVendor)) {
        const vendor = vendorsMap[vendorId];
        if (!vendor || !vendor.mobile) continue;
        if (vendorRepairs.length === 0) continue;

        // Build summary message
        let message = `שלום ${vendor.name}, ריכוז תיקונים פתוחים מ-Gadget-Team:\n`;

        for (let i = 0; i < vendorRepairs.length; i++) {
          const repair = vendorRepairs[i];
          const device = devicesMap[repair.device_id];
          const shortId = getShortRepairId(repair.repair_id);
          const model = device?.model || 'מכשיר';
          const createdDate = new Date(repair.created_date);
          const days = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
          message += `${i + 1}. #${shortId} - ${model} - ${days} ימים\n`;
        }

        message += `סה"כ ${vendorRepairs.length} תיקונים פתוחים. נודה לעדכון. תודה!`;

        const fingerprint = `vendor_weekly|${vendorId}|${now.toISOString().slice(0, 10)}`;
        const phones = [vendor.mobile, ...(vendor.additional_phones || [])].filter(Boolean);

        for (const phone of phones) {
          const result = await sendSMS(base44, phone, message, 'vendor_weekly_summary', `${fingerprint}|${phone}`);
          if (result.success) totalSent++; else totalFailed++;
        }
      }

      return Response.json({
        success: true,
        action: 'weekly_summary',
        vendors_notified: Object.keys(repairsByVendor).length,
        repairs_total: atImporterRepairs.length,
        sent: totalSent,
        failed: totalFailed,
      });
    }

    return Response.json({ error: 'Unknown action. Use daily_7day_check or weekly_summary' }, { status: 400 });

  } catch (error) {
    console.error('[VendorReminders] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});