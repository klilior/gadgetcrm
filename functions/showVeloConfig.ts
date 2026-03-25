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
                email: config.email,
                apiKey: config.apiKey ? `${config.apiKey.substring(0, 8)}...` : 'לא הוגדר',
                apiSecret: config.apiSecret ? `${config.apiSecret.substring(0, 8)}...` : 'לא הוגדר',
                password: config.password ? '****** (הוגדר)' : 'לא הוגדר',
                baseUrl: config.baseUrl || 'לא הוגדר',
                
                // Full lengths for debugging
                lengths: {
                    email: config.email?.length || 0,
                    apiKey: config.apiKey?.length || 0,
                    apiSecret: config.apiSecret?.length || 0,
                    password: config.password?.length || 0
                }
            }
        });
        
    } catch (error) {
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});