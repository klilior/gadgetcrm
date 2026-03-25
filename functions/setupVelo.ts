import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    console.log('🚀 [SetupVelo] Starting Velo setup...');
    
    try {
        // Check if Velo provider exists
        const existingProviders = await base44.entities.ShippingProvider.filter({
            provider_type: 'velo'
        });
        
        const veloConfig = {
            name: 'Velo',
            provider_type: 'velo',
            is_active: true,
            api_url: 'https://api.veloapp.io/api/enterprise',
            supported_carriers: [
                'באליקספרס',
                'UPS',
                'DHL',
                'FedEx',
                'Israel Post',
                'Lionwheel',
                'Chita',
                'Cargo Plus'
            ],
            config: {
                apiKey: Deno.env.get('VELO_API_KEY') || '',
                apiSecret: Deno.env.get('VELO_API_SECRET') || '',
                email: Deno.env.get('VELO_EMAIL') || '',
                password: Deno.env.get('VELO_PASSWORD') || '',
                baseUrl: 'https://api.veloapp.io/api/enterprise'
            },
            notes: 'ספק משלוחים מרכזי המאגד מספר חברות משלוח בינלאומיות ומקומיות'
        };
        
        let providerId;
        
        if (existingProviders.length > 0) {
            // Update existing
            console.log('🔄 [SetupVelo] Updating existing Velo provider...');
            providerId = existingProviders[0].id;
            await base44.entities.ShippingProvider.update(providerId, veloConfig);
            console.log('✅ [SetupVelo] Updated successfully');
        } else {
            // Create new
            console.log('🆕 [SetupVelo] Creating new Velo provider...');
            const created = await base44.entities.ShippingProvider.create(veloConfig);
            providerId = created.id;
            console.log('✅ [SetupVelo] Created successfully');
        }
        
        // Check if secrets are configured
        const secretsConfigured = 
            Deno.env.get('VELO_API_KEY') &&
            Deno.env.get('VELO_API_SECRET') &&
            Deno.env.get('VELO_EMAIL') &&
            Deno.env.get('VELO_PASSWORD');
        
        if (!secretsConfigured) {
            console.warn('⚠️ [SetupVelo] Secrets not fully configured');
            return Response.json({
                success: true,
                providerId,
                warning: 'ספק Velo נוצר, אך חסרים Secrets. נא להגדיר במערכת.',
                missingSecrets: [
                    !Deno.env.get('VELO_API_KEY') && 'VELO_API_KEY',
                    !Deno.env.get('VELO_API_SECRET') && 'VELO_API_SECRET',
                    !Deno.env.get('VELO_EMAIL') && 'VELO_EMAIL',
                    !Deno.env.get('VELO_PASSWORD') && 'VELO_PASSWORD'
                ].filter(Boolean)
            });
        }
        
        // Test authentication
        console.log('🔐 [SetupVelo] Testing authentication...');
        try {
            const authResponse = await fetch(`${new URL(req.url).origin}/functions/veloAuth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (authResponse.ok) {
                const authData = await authResponse.json();
                if (authData.success) {
                    console.log('✅ [SetupVelo] Authentication successful!');
                    return Response.json({
                        success: true,
                        providerId,
                        message: '✅ Velo הוגדר בהצלחה! החיבור תקין.',
                        authenticated: true
                    });
                }
            }
            
            console.warn('⚠️ [SetupVelo] Authentication test failed');
            return Response.json({
                success: true,
                providerId,
                warning: 'ספק Velo נוצר, אך האימות נכשל. נא לבדוק את הפרטים.',
                authenticated: false
            });
            
        } catch (authError) {
            console.error('❌ [SetupVelo] Auth test error:', authError.message);
            return Response.json({
                success: true,
                providerId,
                warning: 'ספק Velo נוצר, אך לא ניתן לבדוק אימות כרגע.',
                authenticated: false
            });
        }
        
    } catch (error) {
        console.error('❌ [SetupVelo] Setup failed:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});