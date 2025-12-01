import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🔍 Analyzing duplicate tickets...");
        
        // מצא את כל הטיקטים לפי נושא
        const allTickets = await base44.asServiceRole.entities.Ticket.list('-created_date', 500);
        
        // קבץ לפי נושא
        const subjectGroups = {};
        
        allTickets.forEach(ticket => {
            const subject = ticket.subject || 'NO_SUBJECT';
            if (!subjectGroups[subject]) {
                subjectGroups[subject] = [];
            }
            subjectGroups[subject].push({
                id: ticket.id,
                ticket_number: ticket.ticket_number,
                customer_id: ticket.customer_id,
                created_date: ticket.created_date,
                email_message_id: ticket.email_message_id,
                thread_id: ticket.thread_id
            });
        });
        
        // מצא נושאים עם כפילויות
        const duplicates = [];
        
        for (const [subject, tickets] of Object.entries(subjectGroups)) {
            if (tickets.length > 5) { // יותר מ-5 טיקטים עם אותו נושא
                duplicates.push({
                    subject,
                    count: tickets.length,
                    tickets: tickets.slice(0, 10), // רק 10 הראשונים
                    customer_ids: [...new Set(tickets.map(t => t.customer_id))],
                    message_ids: [...new Set(tickets.map(t => t.email_message_id).filter(Boolean))],
                    thread_ids: [...new Set(tickets.map(t => t.thread_id).filter(Boolean))]
                });
            }
        }
        
        // בדוק webhook logs
        const recentLogs = await base44.asServiceRole.entities.WebhookLog.filter({
            source: 'gmail'
        }, '-created_date', 100);
        
        const messageIdCounts = {};
        recentLogs.forEach(log => {
            const msgId = log.payload?.messageId;
            if (msgId) {
                messageIdCounts[msgId] = (messageIdCounts[msgId] || 0) + 1;
            }
        });
        
        const repeatedMessages = Object.entries(messageIdCounts)
            .filter(([_, count]) => count > 1)
            .map(([msgId, count]) => ({ messageId: msgId, count }));
        
        return new Response(JSON.stringify({
            success: true,
            totalTickets: allTickets.length,
            duplicateGroups: duplicates.length,
            topDuplicates: duplicates.slice(0, 5),
            repeatedWebhooks: repeatedMessages.slice(0, 10),
            webhookLogsCount: recentLogs.length
        }, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Debug error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});