import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🧪 Testing Bot.it connection...');
        
        // Get provider
        const providers = await base44.asServiceRole.entities.WhatsappProvider.filter({ is_active: true });
        
        if (providers.length === 0) {
            return Response.json({
                success: false,
                message: 'No active provider found'
            });
        }
        
        const provider = providers[0];
        const config = provider.config;
        
        console.log('Provider:', provider.name);
        console.log('API Key exists:', !!config.apiKey);
        console.log('API Key (first 10 chars):', config.apiKey?.substring(0, 10));
        
        // Test sending a message
        const testResponse = await fetch('https://botit.to/api/qr/rest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: '972525052175',
                text: '🧪 TEST MESSAGE from GadgetCRM - ' + new Date().toLocaleTimeString('he-IL')
            })
        });
        
        const responseText = await response.text();
        console.log('Bot.it response:', responseText);
        
        return Response.json({
            success: true,
            provider: provider.name,
            apiKeySet: !!config.apiKey,
            botitResponse: responseText
        });
        
    } catch (error) {
        console.error('Error:', error);
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});