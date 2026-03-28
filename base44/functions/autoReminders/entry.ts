import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Auto-running reminder system that checks every 30 seconds
let isRunning = false;

const checkAndSendReminders = async (base44) => {
    const getCurrentIsraelTimeString = () => {
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const year = israelTime.getFullYear();
        const month = String(israelTime.getMonth() + 1).padStart(2, '0');
        const day = String(israelTime.getDate()).padStart(2, '0');
        const hours = String(israelTime.getHours()).padStart(2, '0');
        const minutes = String(israelTime.getMinutes()).padStart(2, '0');
        const seconds = String(israelTime.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };
    
    const nowString = getCurrentIsraelTimeString();
    console.log(`🔄 [Auto Reminders] Checking at: ${nowString}`);
    
    try {
        const allTasks = await base44.asServiceRole.entities.Task.filter({ status: 'pending' });
        const overdueTasks = allTasks.filter(task => task.due_date && task.due_date <= nowString);
        
        console.log(`Found ${overdueTasks.length} overdue tasks out of ${allTasks.length} total.`);
        
        let sent = 0;
        for (const task of overdueTasks) {
            try {
                const agent = await base44.asServiceRole.entities.Employee.get(task.assigned_to_id);
                if (!agent || !agent.phone) continue;
                
                const ticket = task.ticket_id ? await base44.asServiceRole.entities.Ticket.get(task.ticket_id) : null;
                const customer = ticket && ticket.customer_id ? await base44.asServiceRole.entities.Customer.get(ticket.customer_id) : null;
                
                let message = `🔔 תזכורת מהמערכת\n\nהיי ${agent.employee_name}!\n\n📋 *משימה:* ${task.title}`;
                
                if (ticket) {
                    message += `\n\n🎫 *טיקט:* "${ticket.subject || 'ללא נושא'}" (#${ticket.ticket_number || 'ללא מספר'})`;
                }
                
                if (customer) {
                    message += `\n👤 *לקוח:* ${customer.full_name || 'לא ידוע'}`;
                    if (customer.phone) {
                        message += `\n📞 *טלפון לחזרה:* ${customer.phone}`;
                    }
                }
                
                const response = await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                    to: agent.phone,
                    messageObject: {
                        type: "text",
                        text: { body: message }
                    }
                });
                
                if (!response.error) {
                    await base44.asServiceRole.entities.Task.update(task.id, { status: 'completed' });
                    console.log(`✅ Reminder sent to ${agent.employee_name} for: ${task.title}`);
                    sent++;
                }
                
            } catch (error) {
                console.error(`❌ Error processing task ${task.id}:`, error.message);
                await base44.asServiceRole.entities.Task.update(task.id, { 
                    status: 'completed',
                    title: `[ERROR: ${error.message}] ${task.title}`
                });
            }
        }
        
        if (sent > 0) {
            console.log(`📤 [Auto Reminders] Sent ${sent} reminders successfully!`);
        }
        
    } catch (error) {
        console.error('❌ [Auto Reminders] Error:', error);
    }
};

const startAutoReminders = async (base44) => {
    if (isRunning) return;
    isRunning = true;
    
    console.log('🚀 [Auto Reminders] Starting automatic reminder system...');
    
    const runCycle = async () => {
        await checkAndSendReminders(base44);
        if (isRunning) {
            setTimeout(runCycle, 30000); // Check every 30 seconds
        }
    };
    
    runCycle();
};

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    // Start the auto reminder system
    await startAutoReminders(base44);
    
    return new Response(JSON.stringify({
        success: true,
        message: "Auto reminder system started",
        timestamp: new Date().toISOString()
    }), { status: 200 });
});