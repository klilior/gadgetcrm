import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    console.log("🔍 Starting WhatsApp diagnostic...");
    
    // Check all settings related to WhatsApp
    const allSettings = await base44.asServiceRole.entities.Settings.list();
    console.log("📋 All settings found:", allSettings.map(s => ({ name: s.setting_name, value: s.setting_value })));
    
    // Get specific settings
    const [apiKeySettings, senderSettings] = await Promise.all([
      base44.asServiceRole.entities.Settings.filter({ setting_name: 'BOTIT_API_KEY' }),
      base44.asServiceRole.entities.Settings.filter({ setting_name: 'WHATSAPP_PUBLIC_NUMBER' })
    ]);
    
    const apiKey = apiKeySettings[0]?.setting_value || Deno.env.get("BOTIT_API_KEY");
    const senderPhone = senderSettings[0]?.setting_value || "972515000404";
    
    console.log("🔑 API Key found:", apiKey ? "YES" : "NO");
    console.log("📱 Sender phone from DB:", senderSettings[0]?.setting_value || "NOT FOUND IN DB");
    console.log("📱 Final sender phone used:", senderPhone);
    console.log("🔧 Environment BOTIT_API_KEY:", Deno.env.get("BOTIT_API_KEY") ? "EXISTS" : "NOT EXISTS");
    
    // Check recent webhook logs (last 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recentLogs = await base44.asServiceRole.entities.WebhookLog.filter({
      source: 'botit',
      created_date: { $gte: tenMinutesAgo }
    }, '-created_date', 10);
    
    console.log(`📨 Recent webhook logs (last 10 minutes): ${recentLogs.length}`);
    recentLogs.forEach((log, index) => {
      console.log(`Log ${index + 1}:`, {
        created: log.created_date,
        payload: log.payload,
        headers: Object.keys(log.headers || {})
      });
    });
    
    // Check recent activities
    const recentActivities = await base44.asServiceRole.entities.Activity.filter({
      activity_type: "וואטסאפ נכנס",
      created_date: { $gte: tenMinutesAgo }
    }, '-created_date', 5);
    
    console.log(`📝 Recent WhatsApp activities (last 10 minutes): ${recentActivities.length}`);
    
    // Test API call to bot.it to check account status
    if (apiKey) {
      console.log("🚀 Testing bot.it API connection...");
      
      const testResponse = await fetch('https://botit.to/api/qr/rest/send_message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messageType: "text",
          requestType: "POST", 
          token: apiKey,
          from: senderPhone.replace(/\D/g, ''),
          to: "972525052175", // Test number
          text: "🧪 TEST MESSAGE - WhatsApp diagnostic check"
        })
      });
      
      const testResult = await testResponse.text();
      console.log("📡 bot.it response status:", testResponse.status);
      console.log("📡 bot.it response body:", testResult);
    }
    
    return new Response(JSON.stringify({
      success: true,
      diagnostic: {
        apiKeyExists: !!apiKey,
        senderPhoneFromDB: senderSettings[0]?.setting_value || null,
        finalSenderPhone: senderPhone,
        environmentKeyExists: !!Deno.env.get("BOTIT_API_KEY"),
        recentWebhookLogs: recentLogs.length,
        recentActivities: recentActivities.length,
        allSettings: allSettings.map(s => ({ name: s.setting_name, value: s.setting_value })),
        webhookLogs: recentLogs.map(log => ({
          created: log.created_date,
          payload: log.payload,
          headers: Object.keys(log.headers || {})
        }))
      }
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('❌ Diagnostic error:', error);
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