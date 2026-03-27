import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    console.log('🔔 [Importer Reminders] Starting check...');

    try {
        // Get settings
        const settings = await base44.asServiceRole.entities.Settings.list();
        
        // Check if reminders are enabled
        const enabledSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_ENABLED');
        const isEnabled = enabledSetting?.setting_value === 'ON';
        
        if (!isEnabled) {
            console.log('⏸️ Importer reminders are disabled');
            return Response.json({
                success: true,
                message: 'Reminders are disabled',
                checked: 0,
                remindersSent: 0
            });
        }
        
        // Get days setting (default 7)
        const daysSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_DAYS');
        const reminderDays = parseInt(daysSetting?.setting_value) || 7;
        
        console.log(`⚙️ Reminder days setting: ${reminderDays}`);

        // Get repairs at importer (At_Importer status)
        const repairs = await base44.asServiceRole.entities.Repair.filter({
            status: 'At_Importer'
        });

        console.log(`📦 Found ${repairs.length} repairs at importer`);

        const now = new Date();
        const thresholdDate = new Date(now.getTime() - reminderDays * 24 * 60 * 60 * 1000);
        
        // Get all vendors for phone lookup
        const vendors = await base44.asServiceRole.entities.RepairVendor.list();
        const vendorsMap = vendors.reduce((acc, v) => ({ ...acc, [v.id]: v }), {});

        // Get all devices for model info
        const devices = await base44.asServiceRole.entities.RepairDevice.list();
        const devicesMap = devices.reduce((acc, d) => ({ ...acc, [d.id]: d }), {});

        // Get all clients for customer name
        const clients = await base44.asServiceRole.entities.Client.list();
        const clientsMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});

        let remindersSent = 0;
        const errors = [];

        for (const repair of repairs) {
            // Check if repair has been at importer for more than the configured days
            const repairDate = new Date(repair.updated_date || repair.created_date);
            
            if (repairDate > thresholdDate) {
                // Less than configured days, skip
                continue;
            }

            const vendor = vendorsMap[repair.vendor_id];
            if (!vendor || !vendor.mobile) {
                console.log(`⚠️ Repair ${repair.repair_id}: No vendor or mobile found`);
                continue;
            }

            const device = devicesMap[repair.device_id];
            const client = clientsMap[repair.client_id];
            const deviceInfo = device ? `${device.manufacturer || ''} ${device.model || ''}`.trim() : 'מכשיר';
            const deviceColor = device?.color || '';
            const customerName = client?.full_name || 'לקוח';
            
            const daysSinceUpdate = Math.floor((now - repairDate) / (1000 * 60 * 60 * 24));

            // Get message template from settings or use default
            const messageSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_MESSAGE');
            let messageTemplate = messageSetting?.setting_value || `⚠️ *התראה דחופה - תיקון #{{repair_id}}*

המכשיר נמצא אצלכם *{{days}} ימים* ללא עדכון!

👤 לקוח: *{{customer_name}}*
📱 מכשיר: *{{device}}* {{color}}
🔧 תקלה: *{{issue_category}}*
📝 תיאור: {{issue_description}}

❗ נדרש עדכון מיידי על סטטוס התיקון.

GADGET-TEAM`;

            // Replace placeholders
            const message = messageTemplate
                .replace(/\{\{repair_id\}\}/g, repair.repair_id || '')
                .replace(/\{\{days\}\}/g, daysSinceUpdate.toString())
                .replace(/\{\{customer_name\}\}/g, customerName)
                .replace(/\{\{device\}\}/g, deviceInfo)
                .replace(/\{\{color\}\}/g, deviceColor ? `(${deviceColor})` : '')
                .replace(/\{\{issue_category\}\}/g, repair.issue_category || 'לא צוין')
                .replace(/\{\{issue_description\}\}/g, repair.issue_description || '-');

            try {
                // Send to main phone
                await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                    to: vendor.mobile,
                    messageObject: {
                        type: "text",
                        text: { body: message }
                    }
                });
                console.log(`✅ Reminder sent for repair ${repair.repair_id} to ${vendor.name} (${vendor.mobile})`);

                // Send to additional phones
                const additionalPhones = vendor.additional_phones || [];
                for (const phone of additionalPhones) {
                    if (phone && phone.trim()) {
                        await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                            to: phone.trim(),
                            messageObject: {
                                type: "text",
                                text: { body: message }
                            }
                        });
                        console.log(`✅ Reminder also sent to additional phone: ${phone}`);
                    }
                }

                remindersSent++;

                // Log the reminder
                await base44.asServiceRole.entities.RepairLog.create({
                    repair_id: repair.id,
                    actor_user_id: 'system',
                    action: 'תזכורת ליבואן',
                    details: `נשלחה תזכורת ל-${vendor.name} לאחר ${daysSinceUpdate} ימים`
                });

            } catch (sendError) {
                console.error(`❌ Error sending reminder for ${repair.repair_id}:`, sendError.message);
                errors.push({ repair_id: repair.repair_id, error: sendError.message });
            }
        }

        return Response.json({
            success: true,
            checked: repairs.length,
            remindersSent,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('❌ [Importer Reminders] Error:', error.message);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});