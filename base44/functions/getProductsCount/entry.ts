import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me().catch(() => null);
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Try to get cached count from settings
        const cachedCount = await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'product_total_count' 
        });
        
        if (cachedCount.length > 0) {
            try {
                const count = parseInt(cachedCount[0].setting_value);
                return Response.json({ count });
            } catch (e) {
                console.error('Failed to parse cached count:', e);
            }
        }
        
        // If no cached count, do a simple fetch of first 10k
        const products = await base44.asServiceRole.entities.Product.list('-created_date', 10000);
        const count = products.length;
        const isEstimate = count >= 10000;
        
        return Response.json({ 
            count, 
            isEstimate,
            message: isEstimate ? '10,000+' : count.toString()
        });
    } catch (error) {
        console.error('Error counting products:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});