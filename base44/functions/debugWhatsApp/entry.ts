import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🔍 Starting WhatsApp Debug...');
        
        // Check provider
        const providers = await base44.asServiceRole.entities.WhatsappProvider.filter({ is_active: true });
        
        if (providers.length === 0) {
            return Response.json({
                success: false,
                error: 'No active provider found',
                step: 'provider_check'
            });
        }
        
        const provider = providers[0];
        console.log('✅ Provider found:', provider.name);
        console.log('📋 Config:', {
            hasApiKey: !!provider.config.apiKey,
            apiKeyPreview: provider.config.apiKey?.substring(0, 10) + '...',
            phone: provider.phone_number
        });
        
        // Test Bot.it API
        const testPhone = '972525052175'; // מספר לבדיקה
        const testMessage = `🧪 בדיקה אוטומטית - ${new Date().toLocaleTimeString('he-IL')}`;
        
        console.log('📤 Sending test message to bot.it...');
        
        const botitResponse = await fetch('https://botit.to/api/qr/rest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${provider.config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: testPhone,
                text: testMessage
            })
        });
        
        const responseText = await botitResponse.text();
        console.log('📡 Bot.it response:', responseText);
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(responseText);
        } catch (e) {
            parsedResponse = { raw: responseText };
        }
        
        // Check webhook configuration
        const webhookUrl = `${new URL(req.url).origin}/functions/botitWebhook`;
        
        return Response.json({
            success: true,
            checks: {
                provider: {
                    name: provider.name,
                    type: provider.provider_type,
                    phone: provider.phone_number,
                    hasApiKey: !!provider.config.apiKey
                },
                botit_test: {
                    sent: true,
                    response: parsedResponse,
                    status: botitResponse.status
                },
                webhook: {
                    url: webhookUrl,
                    instructions: 'Copy this URL to bot.it webhook settings'
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Debug error:', error);
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});