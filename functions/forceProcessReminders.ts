import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    console.log("🚨 [FORCE] Manual reminder processing started...");
    
    try {
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const nowString = `${israelTime.getFullYear()}-${String(israelTime.getMonth() + 1).padStart(2, '0')}-${String(israelTime.getDate()).padStart(2, '0')}T${String(israelTime.getHours()).padStart(2, '0')}:${String(israelTime.getMinutes()).padStart(2, '0')}:${String(israelTime.getSeconds()).padStart(2, '0')}`;
        
        console.log(`Current time: ${nowString}`);
        
        // Get all pending tasks
        const allTasks = await base44.asServiceRole.entities.Task.filter({ status: 'pending' });
        console.log(`Found ${allTasks.length} pending tasks`);
        
        // Find ALL overdue tasks (not just current minute)
        const overdueTasks = allTasks.filter(task => task.due_date <= nowString);
        console.log(`Found ${overdueTasks.length} overdue tasks`);
        
        if (overdueTasks.length === 0) {
            return new Response(JSON.stringify({
                success: true,
                message: "No overdue tasks found",
                allTasks: allTasks.map(t => ({ id: t.id, title: t.title, due: t.due_date }))
            }));
        }
        
        // Process each overdue task
        const results = [];
        
        for (const task of overdueTasks) {
            console.log(`Processing task ${task.id}: ${task.title}`);
            
            try {
                if (!task.assigned_to_id) {
                    throw new Error("No agent assigned");
                }
                
                const agent = await base44.asServiceRole.entities.Employee.get(task.assigned_to_id);
                if (!agent) {
                    throw new Error(`Agent not found: ${task.assigned_to_id}`);
                }
                
                console.log(`Found agent: ${agent.employee_name} (${agent.phone})`);
                
                // Build message
                let message = `🔔 תזכורת מהמערכת\n\nהיי ${agent.employee_name}!\n\n📋 *משימה:* ${task.title}`;
                
                if (task.ticket_id) {
                    const ticket = await base44.asServiceRole.entities.Ticket.get(task.ticket_id);
                    if (ticket) {
                        message += `\n\n🎫 *טיקט:* "${ticket.subject}" (#${ticket.ticket_number})`;
                        
                        if (ticket.customer_id) {
                            const customer = await base44.asServiceRole.entities.Customer.get(ticket.customer_id);
                            if (customer) {
                                message += `\n👤 *לקוח:* ${customer.full_name}`;
                                if (customer.phone) {
                                    message += `\n📞 *טלפון לחזרה:* ${customer.phone}`;
                                }
                            }
                        }
                    }
                }
                
                console.log(`Sending message to ${agent.phone}: ${message.substring(0, 100)}...`);
                
                // Send WhatsApp
                const response = await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                    to: agent.phone,
                    messageObject: {
                        type: "text",
                        text: { body: message }
                    }
                });
                
                if (response.error) {
                    throw new Error(response.error.message);
                }
                
                console.log(`✅ Message sent successfully to ${agent.employee_name}`);
                
                // Mark as completed
                await base44.asServiceRole.entities.Task.update(task.id, { status: 'completed' });
                console.log(`✅ Task ${task.id} marked as completed`);
                
                results.push({
                    taskId: task.id,
                    success: true,
                    agent: agent.employee_name
                });
                
            } catch (error) {
                console.error(`❌ Error processing task ${task.id}:`, error);
                results.push({
                    taskId: task.id,
                    success: false,
                    error: error.message
                });
                
                // Mark as completed to prevent retry
                await base44.asServiceRole.entities.Task.update(task.id, { 
                    status: 'completed',
                    title: `[ERROR: ${error.message}] ${task.title}`
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        
        return new Response(JSON.stringify({
            success: true,
            processed: overdueTasks.length,
            sent: successCount,
            results: results
        }));
        
    } catch (error) {
        console.error("❌ Force process failed:", error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), { status: 500 });
    }
});