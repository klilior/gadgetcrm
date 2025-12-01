import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    const results = {
        timestamp: new Date().toISOString(),
        checks: {}
    };
    
    try {
        // ✅ Check 1: Provider Configuration
        console.log('🔍 Check 1: Provider Configuration');
        const providers = await base44.asServiceRole.entities.WhatsappProvider.list();
        const activeProviders = providers.filter(p => p.is_active);
        
        results.checks.provider = {
            status: activeProviders.length > 0 ? 'ok' : 'error',
            message: activeProviders.length > 0 
                ? `נמצא ספק פעיל: ${activeProviders[0].name}`
                : 'לא נמצא ספק פעיל במערכת',
            details: {
                totalProviders: providers.length,
                activeProviders: activeProviders.length,
                providers: activeProviders.map(p => ({
                    name: p.name,
                    type: p.provider_type,
                    phone: p.phone_number,
                    hasApiKey: !!p.config?.apiKey,
                    apiKeyPreview: p.config?.apiKey ? p.config.apiKey.substring(0, 10) + '...' : null
                }))
            }
        };
        
        if (activeProviders.length === 0) {
            return Response.json({ success: true, results });
        }
        
        const provider = activeProviders[0];
        
        // ✅ Check 2: API Key
        console.log('🔍 Check 2: API Key');
        results.checks.apiKey = {
            status: provider.config?.apiKey ? 'ok' : 'error',
            message: provider.config?.apiKey ? 'API Key קיים' : 'חסר API Key',
            details: {
                exists: !!provider.config?.apiKey,
                preview: provider.config?.apiKey ? provider.config.apiKey.substring(0, 15) + '...' : null
            }
        };
        
        if (!provider.config?.apiKey) {
            return Response.json({ success: true, results });
        }
        
        // ✅ Check 3: Bot.it Connection
        console.log('🔍 Check 3: Bot.it API Connection');
        try {
            const testResponse = await fetch('https://botit.to/api/qr/rest', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${provider.config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to: '972525052175',
                    text: '🧪 בדיקה אוטומטית - ' + new Date().toLocaleTimeString('he-IL')
                })
            });
            
            const responseText = await testResponse.text();
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(responseText);
            } catch (e) {
                parsedResponse = { raw: responseText };
            }
            
            const hasError = parsedResponse.error || 
                           parsedResponse.message?.includes('No active') ||
                           parsedResponse.message?.includes('Invalid') ||
                           testResponse.status !== 200;
            
            results.checks.botit = {
                status: hasError ? 'error' : 'ok',
                message: hasError 
                    ? `שגיאה בחיבור: ${parsedResponse.message || parsedResponse.error || 'שגיאה לא ידועה'}`
                    : 'חיבור תקין ל-Bot.it',
                details: {
                    httpStatus: testResponse.status,
                    response: parsedResponse
                }
            };
        } catch (e) {
            results.checks.botit = {
                status: 'error',
                message: `שגיאת רשת: ${e.message}`,
                details: { error: e.message }
            };
        }
        
        // ✅ Check 4: Webhook Configuration
        console.log('🔍 Check 4: Webhook');
        const webhookUrl = `${new URL(req.url).origin}/functions/botitWebhook`;
        results.checks.webhook = {
            status: 'info',
            message: 'ודא שה-URL הזה מוגדר ב-Bot.it',
            details: {
                url: webhookUrl,
                instructions: 'העתק את ה-URL ל-Bot.it Dashboard → Settings → Webhooks'
            }
        };
        
        // ✅ Check 5: Recent Webhook Logs
        console.log('🔍 Check 5: Recent Webhook Activity');
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const recentLogs = await base44.asServiceRole.entities.WebhookLog.filter({
            source: 'botit',
            created_date: { $gte: fiveMinutesAgo }
        }, '-created_date', 5);
        
        results.checks.webhookActivity = {
            status: recentLogs.length > 0 ? 'ok' : 'warning',
            message: recentLogs.length > 0 
                ? `התקבלו ${recentLogs.length} webhook-ים ב-5 דקות אחרונות`
                : 'לא התקבלו webhook-ים ב-5 דקות אחרונות',
            details: {
                count: recentLogs.length,
                recent: recentLogs.slice(0, 3).map(log => ({
                    timestamp: log.created_date,
                    hasMessages: !!(log.payload?.messages?.length)
                }))
            }
        };
        
        // ✅ Check 6: Recent Activities
        console.log('🔍 Check 6: Recent WhatsApp Activities');
        const recentActivities = await base44.asServiceRole.entities.Activity.filter({
            activity_type: { $in: ['וואטסאפ נכנס', 'וואטסאפ יוצא'] },
            created_date: { $gte: fiveMinutesAgo }
        }, '-created_date', 5);
        
        results.checks.activities = {
            status: 'info',
            message: `נמצאו ${recentActivities.length} פעילויות ב-5 דקות אחרונות`,
            details: {
                count: recentActivities.length,
                incoming: recentActivities.filter(a => a.activity_type === 'וואטסאפ נכנס').length,
                outgoing: recentActivities.filter(a => a.activity_type === 'וואטסאפ יוצא').length,
                recent: recentActivities.slice(0, 3).map(a => ({
                    type: a.activity_type,
                    timestamp: a.created_date,
                    content: a.content?.substring(0, 50) + '...'
                }))
            }
        };
        
        // ✅ Check 7: Open Tickets
        console.log('🔍 Check 7: Open Tickets');
        const openTickets = await base44.asServiceRole.entities.Ticket.filter({
            status: { $in: ['חדש', 'בטיפול', 'ממתין ללקוח'] }
        }, '-updated_date', 10);
        
        results.checks.tickets = {
            status: 'info',
            message: `${openTickets.length} טיקטים פתוחים`,
            details: {
                count: openTickets.length,
                byStatus: {
                    new: openTickets.filter(t => t.status === 'חדש').length,
                    inProgress: openTickets.filter(t => t.status === 'בטיפול').length,
                    waiting: openTickets.filter(t => t.status === 'ממתין ללקוח').length
                }
            }
        };
        
        return Response.json({ success: true, results });
        
    } catch (error) {
        console.error('❌ System check error:', error);
        results.checks.error = {
            status: 'error',
            message: error.message,
            stack: error.stack
        };
        return Response.json({ success: false, results }, { status: 500 });
    }
});