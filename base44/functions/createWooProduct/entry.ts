import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🆕 [CreateWooProduct] Starting...');
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const body = await req.json();
        const { productData } = body;
        
        if (!productData) {
            return Response.json({ error: 'Missing product data' }, { status: 400 });
        }
        
        // Get WooCommerce credentials
        const urlSettings = await base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_SITE_URL' });
        const keySettings = await base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_CONSUMER_KEY' });
        const secretSettings = await base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_CONSUMER_SECRET' });
        
        if (!urlSettings.length || !keySettings.length || !secretSettings.length) {
            return Response.json({ 
                success: false, 
                error: 'WooCommerce credentials not configured' 
            });
        }
        
        const WOO_URL = urlSettings[0].setting_value;
        const WOO_KEY = keySettings[0].setting_value;
        const WOO_SECRET = secretSettings[0].setting_value;
        
        // Prepare WooCommerce product data
        const wooProductData = {
            name: productData.name,
            type: 'simple',
            status: productData.status || 'draft',
            featured: productData.featured || false,
            description: productData.description || '',
            short_description: productData.short_description || '',
            sku: productData.sku || '',
            regular_price: productData.regular_price || '',
            sale_price: productData.sale_price || '',
            manage_stock: productData.manage_stock || false,
            stock_quantity: productData.stock_quantity || null,
            stock_status: productData.stock_status || 'instock',
            categories: productData.categories || [],
            tags: productData.tags || [],
            images: productData.images || []
        };
        
        console.log('📤 Sending to WooCommerce:', wooProductData);
        
        // Create product in WooCommerce
        const url = `${WOO_URL}/wp-json/wc/v3/products`;
        const auth = btoa(`${WOO_KEY}:${WOO_SECRET}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(wooProductData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ WooCommerce API Error:`, errorText);
            return Response.json({
                success: false,
                error: `WooCommerce API failed: ${response.status}`,
                details: errorText
            }, { status: 500 });
        }
        
        const wooProduct = await response.json();
        console.log('✅ Product created in WooCommerce:', wooProduct.id);
        
        // Save to local database
        const localProductData = {
            woo_product_id: wooProduct.id,
            name: wooProduct.name,
            slug: wooProduct.slug,
            permalink: wooProduct.permalink,
            type: wooProduct.type,
            status: wooProduct.status,
            featured: wooProduct.featured,
            description: wooProduct.description,
            short_description: wooProduct.short_description,
            sku: wooProduct.sku,
            price: wooProduct.price,
            regular_price: wooProduct.regular_price,
            sale_price: wooProduct.sale_price,
            cost_price: productData.cost_price || null,
            cost_price_vat: productData.cost_price_vat || null,
            on_sale: wooProduct.on_sale,
            manage_stock: wooProduct.manage_stock,
            stock_quantity: wooProduct.stock_quantity,
            stock_status: wooProduct.stock_status,
            categories: wooProduct.categories,
            tags: wooProduct.tags,
            images: wooProduct.images,
            brands: productData.brands || [],
            date_created: wooProduct.date_created,
            date_modified: wooProduct.date_modified,
            raw_data: JSON.stringify(wooProduct)
        };
        
        const localProduct = await base44.asServiceRole.entities.Product.create(localProductData);
        console.log('✅ Product saved locally:', localProduct.id);
        
        return Response.json({
            success: true,
            product: localProduct,
            woo_product_id: wooProduct.id,
            permalink: wooProduct.permalink
        });
        
    } catch (error) {
        console.error('❌ [CreateWooProduct] Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});