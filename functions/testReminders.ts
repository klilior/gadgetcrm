import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    console.log("🔍 [TEST] Starting comprehensive reminder system diagnostics...");
    
    try {
        // 1. Test basic connectivity
        console.log("1️⃣ Testing base44 connectivity...");
        const testUser = await base44.asServiceRole.entities.Employee.list("", 1);
        console.log(`✅ Connected successfully. Found ${testUser.length} employees.`);
        
        // 2. Check all pending tasks
        console.log("2️⃣ Checking all pending tasks...");
        const allTasks = await base44.asServiceRole.entities.Task.filter({ status: 'pending' });
        console.log(`✅ Found ${allTasks.length} pending tasks:`);
        
        allTasks.forEach(task => {
            console.log(`   - Task ${task.id}: "${task.title}" due at ${task.due_date}`);
        });
        
        // 3. Test current time calculation
        console.log("3️⃣ Testing time calculations...");
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const nowString = `${israelTime.getFullYear()}-${String(israelTime.getMonth() + 1).padStart(2, '0')}-${String(israelTime.getDate()).padStart(2, '0')}T${String(israelTime.getHours()).padStart(2, '0')}:${String(israelTime.getMinutes()).padStart(2, '0')}:${String(israelTime.getSeconds()).padStart(2, '0')}`;
        
        console.log(`✅ Current Israel time: ${israelTime.toLocaleString('he-IL')}`);
        console.log(`✅ Formatted for comparison: ${nowString}`);
        
        // 4. Check for overdue tasks
        console.log("4️⃣ Checking for overdue tasks...");
        const overdueTasks = allTasks.filter(task => task.due_date <= nowString);
        console.log(`✅ Found ${overdueTasks.length} overdue tasks.`);
        
        // 5. Test WhatsApp function availability
        console.log("5️⃣ Testing WhatsApp function...");
        try {
            const testResponse = await base44.asServiceRole.functions.invoke('sendWhatsapp', {
                to: '972525052175', // Your number for testing
                messageObject: {
                    type: "text",
                    text: { body: "🧪 TEST: Reminder system diagnostic check - " + new Date().toLocaleTimeString('he-IL') }
                }
            });
            console.log(`✅ WhatsApp function test result:`, testResponse);
        } catch (error) {
            console.log(`❌ WhatsApp function test failed:`, error.message);
        }
        
        // 6. Summary
        const summary = {
            timestamp: israelTime.toLocaleString('he-IL'),
            pendingTasks: allTasks.length,
            overdueTasks: overdueTasks.length,
            tasks: allTasks.map(t => ({ id: t.id, title: t.title, due: t.due_date }))
        };
        
        console.log("📊 DIAGNOSTIC SUMMARY:", JSON.stringify(summary, null, 2));
        
        return new Response(JSON.stringify({
            success: true,
            message: "Diagnostic completed",
            ...summary
        }), { status: 200 });
        
    } catch (error) {
        console.error("❌ DIAGNOSTIC FAILED:", error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            stack: error.stack
        }), { status: 500 });
    }
});