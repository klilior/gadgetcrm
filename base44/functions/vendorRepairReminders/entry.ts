import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function getShortRepairId(repairId) {
  if (!repairId) return '----';
  const parts = repairId.split('-');
  if (parts.length >= 3) return parts[parts.length - 1];
  const match = repairId.match(/(\d{4})$/);
  return match ? match[1] : repairId.slice(-4);
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}

async function sendSMS(base44, to_phone, message, event_type, fingerprint) {
  try {
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

// Admin phone to receive copy of all reminders
const ADMIN_PHONE = '0525052175';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const action = body.action || 'daily_reminders';

    console.log(`[VendorReminders] Action: ${action}`);

    // Load all repairs at importer
    const atImporterRepairs = await base44.asServiceRole.entities.Repair.filter(
      { status: 'At_Importer' }, '-created_date', 500
    );
    console.log(`[VendorReminders] Found ${atImporterRepairs.length} repairs at importer`);

    if (atImporterRepairs.length === 0) {
      return Response.json({ success: true, message: 'No repairs at importer', sent: 0 });
    }

    // Load vendors, devices, clients
    const vendors = await base44.asServiceRole.entities.RepairVendor.filter({ active: true });
    const vendorsMap = vendors.reduce((acc, v) => ({ ...acc, [v.id]: v }), {});

    const devices = await base44.asServiceRole.entities.RepairDevice.list('-created_date', 500);
    const devicesMap = devices.reduce((acc, d) => ({ ...acc, [d.id]: d }), {});

    const clients = await base44.asServiceRole.entities.Client.list('-created_date', 1000);
    const clientsMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});

    const now = new Date();
    // Skip Friday (5) and Saturday (6)
    const israelDay = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay();
    if (israelDay === 5 || israelDay === 6) {
      console.log(`[VendorReminders] Skipping - today is ${israelDay === 5 ? 'Friday' : 'Saturday'}`);
      return Response.json({ success: true, message: 'Skipped - Friday/Saturday', sent: 0 });
    }

    let totalSent = 0;
    let totalFailed = 0;
    const adminMessages = [];

    // ═══════ ACTION: daily_reminders ═══════
    if (action === 'daily_reminders') {
      for (const repair of atImporterRepairs) {
        const createdDate = new Date(repair.created_date);
        const daysAtImporter = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

        // Determine if we should send and what type
        let reminderType = null;
        if (daysAtImporter === 7) {
          reminderType = 'first';       // First reminder at 7 days
        } else if (daysAtImporter === 10) {
          reminderType = 'second';      // Second reminder at 10 days
        } else if (daysAtImporter >= 11) {
          reminderType = 'daily';       // Daily from day 11+
        }

        if (!reminderType) continue;

        const vendor = vendorsMap[repair.vendor_id];
        if (!vendor || !vendor.mobile) continue;

        const device = devicesMap[repair.device_id];
        const client = clientsMap[repair.client_id];
        const shortId = getShortRepairId(repair.repair_id);
        const model = device?.model || 'מכשיר לא ידוע';
        const clientName = client?.full_name || 'לקוח';
        const receiveDate = formatDate(repair.created_date);

        let message = '';
        if (reminderType === 'first') {
          message = `שלום ${vendor.name}, תזכורת מ-Gadget-Team: תיקון #${shortId} ממתין אצלכם 7 ימים. לקוח: ${clientName}, דגם: ${model}, תאריך קבלה: ${receiveDate}. נודה לעדכון סטטוס. תודה!`;
        } else if (reminderType === 'second') {
          message = `שלום ${vendor.name}, תזכורת שנייה מ-Gadget-Team: תיקון #${shortId} ממתין אצלכם כבר 10 ימים. לקוח: ${clientName}, דגם: ${model}, תאריך קבלה: ${receiveDate}. נא לטפל בדחיפות. תודה!`;
        } else {
          message = `שלום ${vendor.name}, תזכורת דחופה מ-Gadget-Team: תיקון #${shortId} ממתין אצלכם ${daysAtImporter} ימים! לקוח: ${clientName}, דגם: ${model}, תאריך קבלה: ${receiveDate}. נא לעדכן מיידית. תודה!`;
        }

        const fingerprint = `vendor_reminder|${repair.id}|day${daysAtImporter}`;
        const phones = [vendor.mobile, ...(vendor.additional_phones || [])].filter(Boolean);

        for (const phone of phones) {
          const result = await sendSMS(base44, phone, message, `vendor_reminder_${reminderType}`, `${fingerprint}|${phone}`);
          if (result.success) totalSent++; else totalFailed++;
        }

        // Collect for admin summary
        adminMessages.push(`#${shortId} | ${vendor.name} | ${model} | ${clientName} | ${daysAtImporter} ימים | ${reminderType === 'first' ? 'תזכורת 1' : reminderType === 'second' ? 'תזכורת 2' : 'יומית'}`);
      }

      // Send admin summary
      if (adminMessages.length > 0) {
        let adminMsg = `סיכום תזכורות יבואנים - ${formatDate(now.toISOString())}:\n`;
        for (const line of adminMessages) {
          adminMsg += `${line}\n`;
        }
        adminMsg += `\nסה"כ: ${adminMessages.length} תזכורות נשלחו.`;

        await sendSMS(base44, ADMIN_PHONE, adminMsg, 'admin_vendor_reminder_summary', `admin_summary|${now.toISOString().slice(0,10)}`);
      }

      return Response.json({
        success: true,
        action: 'daily_reminders',
        repairs_checked: atImporterRepairs.length,
        reminders_sent: adminMessages.length,
        sms_sent: totalSent,
        sms_failed: totalFailed,
      });
    }

    // ═══════ ACTION: weekly_summary ═══════
    if (action === 'weekly_summary') {
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

        let message = `שלום ${vendor.name}, ריכוז תיקונים פתוחים מ-Gadget-Team:\n`;
        for (let i = 0; i < vendorRepairs.length; i++) {
          const repair = vendorRepairs[i];
          const device = devicesMap[repair.device_id];
          const client = clientsMap[repair.client_id];
          const shortId = getShortRepairId(repair.repair_id);
          const model = device?.model || 'מכשיר';
          const clientName = client?.full_name || 'לקוח';
          const days = Math.floor((now - new Date(repair.created_date)) / (1000 * 60 * 60 * 24));
          message += `${i + 1}. #${shortId} - ${model} - ${clientName} - ${days} ימים\n`;
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

    return Response.json({ error: 'Unknown action. Use daily_reminders or weekly_summary' }, { status: 400 });

  } catch (error) {
    console.error('[VendorReminders] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});