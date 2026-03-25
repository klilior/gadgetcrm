import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🎯 Cleaning up worst duplicates only...");
        
        // מחק רק את 2 הקבוצות הגדולות ביותר:
        // 1. "מוצר פגום" - thread_id: 199e7c0230a2e331
        // 2. "Welcome to Resend!" - thread_id: 199d4856a760b346
        
        const targetThreads = [
            '199e7c0230a2e331', // מוצר פגום
            '199d4856a760b346'  // Welcome to Resend
        ];
        
        let totalDeleted = 0;
        
        for (const threadId of targetThreads) {
            console.log(`\n🔍 Processing thread: ${threadId}`);
            
            const tickets = await base44.asServiceRole.entities.Ticket.filter({
                thread_id: threadId
            }, 'created_date', 500);
            
            if (tickets.length <= 1) {
                console.log(`✅ No duplicates for thread ${threadId}`);
                continue;
            }
            
            console.log(`Found ${tickets.length} tickets with thread_id ${threadId}`);
            
            // שמור את הראשון
            const [keep, ...toDelete] = tickets;
            console.log(`Keeping ticket #${keep.ticket_number} (${keep.id})`);
            console.log(`Deleting ${toDelete.length} duplicates...`);
            
            // מחק לאט לאט
            for (let i = 0; i < toDelete.length; i++) {
                try {
                    await base44.asServiceRole.entities.Ticket.delete(toDelete[i].id);
                    totalDeleted++;
                    
                    if ((i + 1) % 5 === 0) {
                        console.log(`  Deleted ${i + 1}/${toDelete.length} for this thread...`);
                        await sleep(1000); // המתן שנייה כל 5 מחיקות
                    }
                } catch (err) {
                    console.error(`Failed to delete ${toDelete[i].id}:`, err.message);
                }
            }
            
            console.log(`✅ Finished thread ${threadId}: deleted ${toDelete.length} tickets`);
            await sleep(3000); // המתן 3 שניות לפני thread הבא
        }
        
        return new Response(JSON.stringify({
            success: true,
            deletedCount: totalDeleted,
            threadsProcessed: targetThreads.length,
            message: `Deleted ${totalDeleted} duplicate tickets from ${targetThreads.length} problematic threads`
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Cleanup error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});