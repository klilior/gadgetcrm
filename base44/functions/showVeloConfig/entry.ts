import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        
        const providers = await base44.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });
        
        if (!providers || providers.length === 0) {
            return Response.json({
                success: false,
                error: 'No Velo provider found'
            });
        }
        
        const config = providers[0].config || {};
        
        return Response.json({
            success: true,
            config: {
                email_present: !!config.email,
                api_key_present: !!config.apiKey,
                api_secret_present: !!config.apiSecret,
                password_present: !!config.password,
                base_url_present: !!config.baseUrl
            }
        });
        
    } catch (error) {
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});