import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Helper: get short repair ID (last digits after last dash)
function getShortRepairId(repairId) {
  if (!repairId) return '----';
  const parts = repairId.split('-');
  if (parts.length >= 3) return parts[parts.length - 1];
  const match = repairId.match(/(\d{4})$/);
  return match ? match[1] : repairId.slice(-4);
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