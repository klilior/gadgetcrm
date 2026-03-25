import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    console.log("🔍 Checking recent messages and webhooks...");
    
    // Check webhook logs from the last 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const [webhookLogs, recentActivities, recentTickets] = await Promise.all([
      base44.asServiceRole.entities.WebhookLog.filter({
        source: { $in: ['botit', 'botit-direct'] },
        created_date: { $gte: thirtyMinutesAgo }
      }, '-created_date', 20),
      
      base44.asServiceRole.entities.Activity.filter({
        activity_type: { $in: ["וואטסאפ נכנס", "וואטסאפ יוצא"] },
        created_date: { $gte: thirtyMinutesAgo }
      }, '-created_date', 10),
      
      base44.asServiceRole.entities.Ticket.filter({
        updated_date: { $gte: thirtyMinutesAgo }
      }, '-updated_date', 10)
    ]);
    
    console.log(`📨 Found ${webhookLogs.length} webhook logs`);
    console.log(`📝 Found ${recentActivities.length} WhatsApp activities`);
    console.log(`🎫 Found ${recentTickets.length} updated tickets`);
    
    // Analyze webhook logs
    const processedWebhooks = webhookLogs.map(log => ({
      id: log.id,
      timestamp: log.created_date,
      method: log.payload?.method || 'unknown',
      hasValidData: !!(log.payload?.body?.param1 && log.payload?.body?.param2 && log.payload?.body?.param3),
      senderName: log.payload?.body?.param1,
      messagePreview: log.payload?.body?.param2?.substring(0, 50) + "...",
      senderPhone: log.payload?.body?.param3,
      rawPayload: log.payload
    }));
    
    // Check if ticket 1012 exists and its recent activities
    const ticket1012 = await base44.asServiceRole.entities.Ticket.filter({ ticket_number: 1012 });
    let ticket1012Activities = [];
    if (ticket1012.length > 0) {
      ticket1012Activities = await base44.asServiceRole.entities.Activity.filter({
        ticket_id: ticket1012[0].id,
        created_date: { $gte: thirtyMinutesAgo }
      }, '-created_date', 10);
    }
    
    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      analysis: {
        webhookLogsFound: webhookLogs.length,
        whatsappActivitiesFound: recentActivities.length,
        updatedTicketsFound: recentTickets.length,
        ticket1012Exists: ticket1012.length > 0,
        ticket1012RecentActivities: ticket1012Activities.length
      },
      details: {
        webhookLogs: processedWebhooks,
        activities: recentActivities.map(activity => ({
          id: activity.id,
          timestamp: activity.created_date,
          type: activity.activity_type,
          ticketId: activity.ticket_id,
          content: activity.content?.substring(0, 100) + "..."
        })),
        ticket1012Info: ticket1012.length > 0 ? {
          id: ticket1012[0].id,
          status: ticket1012[0].status,
          lastUpdated: ticket1012[0].updated_date,
          recentActivities: ticket1012Activities.map(a => ({
            type: a.activity_type,
            timestamp: a.created_date,
            content: a.content?.substring(0, 50) + "..."
          }))
        } : null
      }
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('❌ Error checking recent messages:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
});