import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { url } = await req.json();
        
        if (!url || !url.trim()) {
            throw new Error('URL cannot be empty');
        }
        
        // Find existing setting or create new one
        const existingSettings = await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'WOOCOMMERCE_SITE_URL' 
        });
        
        if (existingSettings.length > 0) {
            // Update existing setting
            await base44.asServiceRole.entities.Settings.update(existingSettings[0].id, {
                setting_value: url.trim()
            });
        } else {
            // Create new setting
            await base44.asServiceRole.entities.Settings.create({
                setting_name: 'WOOCOMMERCE_SITE_URL',
                setting_value: url.trim(),
                notes: 'כתובת אתר WooCommerce'
            });
        }
        
        return new Response(JSON.stringify({
            success: true,
            message: 'WooCommerce URL updated successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Error updating WooCommerce URL:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});