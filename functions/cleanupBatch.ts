import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { threadId, maxToDelete = 20 } = await req.json();
        
        console.log(`🧹 Cleaning thread: ${threadId}, max: ${maxToDelete}`);
        
        // מצא טיקטים עם thread_id זה
        const tickets = await base44.asServiceRole.entities.Ticket.filter({
            thread_id: threadId
        }, 'created_date', maxToDelete + 1);
        
        if (tickets.length <= 1) {
            return new Response(JSON.stringify({
                success: true,
                deletedCount: 0,
                remaining: 0,
                message: 'No duplicates found'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // שמור את הראשון, מחק את השאר (עד maxToDelete)
        const [keep, ...toDelete] = tickets;
        const actualToDelete = toDelete.slice(0, maxToDelete);
        
        console.log(`Keeping ticket #${keep.ticket_number}`);
        console.log(`Deleting ${actualToDelete.length} duplicates...`);
        
        let deleted = 0;
        for (const ticket of actualToDelete) {
            try {
                await base44.asServiceRole.entities.Ticket.delete(ticket.id);
                deleted++;
                await sleep(200); // 200ms בין מחיקות
            } catch (err) {
                console.error(`Failed to delete ${ticket.id}:`, err.message);
            }
        }
        
        const remaining = tickets.length - deleted - 1;
        
        return new Response(JSON.stringify({
            success: true,
            deletedCount: deleted,
            remaining: remaining > 0 ? remaining : 0,
            keptTicket: keep.ticket_number,
            message: `Deleted ${deleted} tickets. ${remaining > 0 ? remaining + ' remaining' : 'All done!'}`
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