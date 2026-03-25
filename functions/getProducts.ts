import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204 });
    }

    try {
        const user = await base44.auth.me().catch(() => null);
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const page = body.page || 1;
        const limit = body.limit || 50;
        const search = body.search || "";
        const skip = (page - 1) * limit;
        
        let products = [];
        let query = {};

        if (search) {
            // Using regex for search if possible, or strict equality if regex fails/not supported
            // Trying a flexible query for name or sku
            query = {
                "$or": [
                    { "name": { "$regex": search, "$options": "i" } },
                    { "sku": { "$regex": search, "$options": "i" } },
                    { "woo_product_id": parseInt(search) || -1 } // Try exact match for ID
                ]
            };
            // Note: We use filter with limit and skip
            // Signature: filter(query, sort, limit, skip)
            products = await base44.entities.Product.filter(query, '-date_modified', limit + 1, skip);
        } else {
            // Signature: list(sort, limit, skip)
            products = await base44.entities.Product.list('-date_modified', limit + 1, skip);
        }

        // Check if there are more results than the limit (we fetched limit + 1)
        const hasMore = products.length > limit;
        const resultProducts = hasMore ? products.slice(0, limit) : products;
        
        return Response.json({
            products: resultProducts,
            hasMore,
            page
        });
    } catch (error) {
        console.error('Error in getProducts:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});