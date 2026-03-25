import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🧪 Test Send START');
        
        // Get provider
        const providers = await base44.asServiceRole.entities.WhatsappProvider.filter({ 
            is_active: true 
        });
        
        if (providers.length === 0) {
            return Response.json({ error: 'No active provider' });
        }

        const provider = providers[0];
        const apiKey = provider.config?.apiKey;
        
        if (!apiKey) {
            return Response.json({ error: 'No API key' });
        }

        // Test send
        const testPhone = '972525052175';
        const testMessage = '🧪 בדיקה - ' + new Date().toLocaleTimeString('he-IL');
        
        const response = await fetch('https://botit.to/api/qr/rest', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: testPhone,
                text: testMessage
            })
        });

        const responseText = await response.text();
        
        return Response.json({
            success: true,
            botit_status: response.status,
            botit_response: responseText,
            provider: {
                name: provider.name,
                phone: provider.phone_number
            }
        });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        });
    }
});