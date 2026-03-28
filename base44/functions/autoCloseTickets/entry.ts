import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🔍 Checking for tickets to auto-close...");
        
        // חשב תאריך לפני 14 יום
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const cutoffDate = fourteenDaysAgo.toISOString();
        
        // מצא טיקטים פתוחים שלא עודכנו 14 יום
        const ticketsToClose = await base44.asServiceRole.entities.Ticket.filter({
            status: { $nin: ["נסגר", "נסגר ללא מענה"] },
            updated_date: { $lt: cutoffDate }
        });
        
        console.log(`Found ${ticketsToClose.length} tickets to auto-close`);
        
        let closedCount = 0;
        
        for (const ticket of ticketsToClose) {
            try {
                // סגור את הטיקט
                await base44.asServiceRole.entities.Ticket.update(ticket.id, {
                    status: 'נסגר ללא מענה',
                    closed_date: new Date().toISOString()
                });
                
                // צור פעילות
                await base44.asServiceRole.entities.Activity.create({
                    summary: 'הטיקט נסגר אוטומטית - אין מענה מהלקוח למעלה מ-14 יום',
                    activity_type: 'שינוי סטטוס',
                    content: `הטיקט נסגר אוטומטית לאחר 14 יום ללא מענה. עודכן לאחרונה ב-${new Date(ticket.updated_date).toLocaleDateString('he-IL')}`,
                    ticket_id: ticket.id
                });
                
                closedCount++;
                console.log(`✅ Closed ticket #${ticket.ticket_number}`);
            } catch (error) {
                console.error(`❌ Error closing ticket ${ticket.id}:`, error);
            }
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: `Auto-closed ${closedCount} tickets`,
            closedCount: closedCount
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error("❌ Error in autoCloseTickets:", error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});