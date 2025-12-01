import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        // Get WooCommerce URL from settings
        const settings = await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'WOOCOMMERCE_SITE_URL' 
        });
        
        const url = settings[0]?.setting_value || '';
        
        return new Response(JSON.stringify({
            success: true,
            url: url
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Error fetching WooCommerce URL:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            url: ''
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});