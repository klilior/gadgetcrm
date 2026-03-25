import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🧹 Starting duplicate tickets cleanup...");
        
        // מצא טיקטים עם אותו thread_id
        const allTickets = await base44.asServiceRole.entities.Ticket.list('-created_date', 1000);
        
        const threadGroups = new Map();
        
        allTickets.forEach(ticket => {
            if (ticket.thread_id) {
                if (!threadGroups.has(ticket.thread_id)) {
                    threadGroups.set(ticket.thread_id, []);
                }
                threadGroups.get(ticket.thread_id).push(ticket);
            }
        });
        
        let deletedCount = 0;
        let keptCount = 0;
        const batchSize = 10; // מחק 10 בכל פעם
        
        for (const [threadId, tickets] of threadGroups.entries()) {
            if (tickets.length > 1) {
                // מיין לפי תאריך יצירה (הכי ישן קודם)
                tickets.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                
                // שמור את הראשון, מחק את השאר
                const [keep, ...toDelete] = tickets;
                keptCount++;
                
                console.log(`Thread ${threadId}: Found ${tickets.length} duplicates`);
                console.log(`Keeping ticket #${keep.ticket_number}, deleting ${toDelete.length} others`);
                
                // מחק בקבוצות קטנות
                for (let i = 0; i < toDelete.length; i++) {
                    try {
                        await base44.asServiceRole.entities.Ticket.delete(toDelete[i].id);
                        deletedCount++;
                        
                        // כל 10 מחיקות - המתן 2 שניות
                        if (deletedCount % batchSize === 0) {
                            console.log(`⏳ Deleted ${deletedCount} so far, waiting 2 seconds...`);
                            await sleep(2000);
                        }
                    } catch (deleteError) {
                        console.error(`Failed to delete ticket ${toDelete[i].id}:`, deleteError.message);
                    }
                }
            }
        }
        
        console.log(`✅ Cleanup complete: Deleted ${deletedCount} duplicate tickets, kept ${keptCount}`);
        
        return new Response(JSON.stringify({
            success: true,
            deletedCount,
            keptCount,
            message: `Deleted ${deletedCount} duplicate tickets, kept ${keptCount} unique tickets`
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