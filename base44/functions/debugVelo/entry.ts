import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        
        console.log('🔍 [DebugVelo] === START ===');
        
        // Check providers
        console.log('📊 [DebugVelo] Checking providers...');
        const providers = await base44.entities.ShippingProvider.list();
        console.log('📊 [DebugVelo] Total providers:', providers.length);
        
        providers.forEach(p => {
            console.log('  - Name:', p.name);
            console.log('    Type:', p.provider_type);
            console.log('    Active:', p.is_active);
            console.log('    Config:', JSON.stringify(p.config, null, 2));
        });
        
        // Check active Velo
        const veloProviders = await base44.entities.ShippingProvider.filter({
            provider_type: 'velo',
            is_active: true
        });
        
        console.log('📊 [DebugVelo] Active Velo providers:', veloProviders.length);
        
        if (veloProviders.length > 0) {
            const config = veloProviders[0].config || {};
            console.log('✅ [DebugVelo] Velo config present:');
            console.log('  - Has apiKey:', !!config.apiKey);
            console.log('  - Has apiSecret:', !!config.apiSecret);
            console.log('  - Has email:', !!config.email);
            console.log('  - Has password:', !!config.password);
            console.log('  - baseUrl:', config.baseUrl);
        }
        
        // Check sessions
        console.log('📊 [DebugVelo] Checking sessions...');
        const sessions = await base44.entities.VeloSession.list();
        console.log('📊 [DebugVelo] Total sessions:', sessions.length);
        
        return Response.json({
            success: true,
            providers: providers.length,
            activeVelo: veloProviders.length,
            sessions: sessions.length,
            config: veloProviders.length > 0 ? {
                hasApiKey: !!veloProviders[0].config?.apiKey,
                hasApiSecret: !!veloProviders[0].config?.apiSecret,
                hasEmail: !!veloProviders[0].config?.email,
                hasPassword: !!veloProviders[0].config?.password
            } : null
        });
        
    } catch (error) {
        console.error('❌ [DebugVelo] Error:', error);
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});