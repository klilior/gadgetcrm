
import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🔍 Checking for part order reminders...");
        
        // מצא תיקונים עם סטטוס "הוזמן חלק" שעברו 24 שעות
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        const repairsWithOrderedParts = await base44.asServiceRole.entities.Repair.filter({
            status: 'הוזמן חלק',
            part_ordered_date: { $lt: twentyFourHoursAgo.toISOString() }
        });
        
        console.log(`Found ${repairsWithOrderedParts.length} repairs with parts ordered over 24 hours ago`);
        
        let remindersSent = 0;
        
        for (const repair of repairsWithOrderedParts) {
            try {
                if (!repair.technician_id) continue;
                
                const technician = await base44.asServiceRole.entities.Employee.get(repair.technician_id);
                if (!technician || !technician.phone) continue;
                
                const client = await base44.asServiceRole.entities.Client.get(repair.client_id);
                const device = await base44.asServiceRole.entities.RepairDevice.get(repair.device_id);
                
                const message = `🔔 תזכורת: חלק הוזמן לפני 24+ שעות\n\n🔧 תיקון: ${repair.repair_id}\n👤 לקוח: ${client?.full_name || 'לא ידוע'}\n📱 מכשיר: ${device ? `${device.manufacturer} ${device.model}` : 'לא ידוע'}\n\n⏰ בדוק אם החלק הגיע והמשך בתיקון`;
                
                const response = await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                    to: technician.phone,
                    messageObject: {
                        type: "text",
                        text: { body: message }
                    }
                });
                
                if (!response.error) {
                    remindersSent++;
                    console.log(`✅ Part reminder sent to ${technician.employee_name} for repair ${repair.repair_id}`);
                    
                    // רשום פעילות
                    await base44.asServiceRole.entities.RepairLog.create({
                        repair_id: repair.id,
                        actor_user_id: null,
                        action: 'תזכורת אוטומטית - חלק הוזמן לפני 24 שעות',
                        details: `נשלחה תזכורת לטכנאי ${technician.employee_name}`
                    });
                } else {
                    console.error(`❌ Failed to send reminder for repair ${repair.repair_id}:`, response.error);
                }
                
            } catch (error) {
                console.error(`❌ Error processing reminder for repair ${repair.id}:`, error);
            }
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: `Processed ${repairsWithOrderedParts.length} repairs, sent ${remindersSent} reminders`,
            repairsChecked: repairsWithOrderedParts.length,
            remindersSent: remindersSent
        }), { status: 200 });
        
    } catch (error) {
        console.error('❌ Error in checkPartReminders:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), { status: 500 });
    }
});
