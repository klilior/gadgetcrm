import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('📥 [ImportCSV] Starting CSV import...');
        
        const user = await base44.auth.me().catch(() => null);
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const body = await req.json();
        const content = body.fileContent;
        
        if (!content) {
            return Response.json({ 
                success: false, 
                error: 'No file content provided' 
            }, { status: 400 });
        }
        const lines = content.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            return Response.json({ 
                success: false, 
                error: 'CSV file is empty or invalid' 
            }, { status: 400 });
        }
        
        // Parse CSV headers
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        console.log('📋 Headers:', headers);
        
        let created = 0;
        let updated = 0;
        let errors = 0;
        
        // Process each line (skip header)
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
                const product = {};
                
                headers.forEach((header, idx) => {
                    product[header] = values[idx] || '';
                });
                
                // Map WooCommerce CSV fields to our schema
                const productData = {
                    name: product['Name'] || product['name'],
                    sku: product['SKU'] || product['sku'],
                    description: product['Description'] || product['description'] || '',
                    short_description: product['Short description'] || product['short_description'] || '',
                    regular_price: product['Regular price'] || product['regular_price'] || '0',
                    sale_price: product['Sale price'] || product['sale_price'] || '',
                    stock_quantity: parseInt(product['Stock'] || product['stock_quantity'] || '0'),
                    stock_status: product['In stock?'] === '1' || product['stock_status'] === 'instock' ? 'instock' : 'outofstock',
                    manage_stock: product['Stock'] ? true : false,
                    status: product['Published'] === '1' || product['status'] === 'publish' ? 'publish' : 'draft',
                    type: product['Type'] || 'simple',
                    categories: product['Categories'] ? [{ name: product['Categories'] }] : [],
                    tags: product['Tags'] ? product['Tags'].split('|').map(t => ({ name: t.trim() })) : [],
                    images: product['Images'] ? product['Images'].split('|').map(url => ({ src: url.trim() })) : []
                };
                
                if (!productData.name) {
                    console.warn(`⚠️ Line ${i + 1}: Missing product name, skipping`);
                    continue;
                }
                
                // Check if product exists by SKU
                let existing = null;
                if (productData.sku) {
                    const found = await base44.asServiceRole.entities.Product.filter({ sku: productData.sku });
                    existing = found.length > 0 ? found[0] : null;
                }
                
                if (existing) {
                    await base44.asServiceRole.entities.Product.update(existing.id, productData);
                    updated++;
                    console.log(`✅ Updated: ${productData.name}`);
                } else {
                    await base44.asServiceRole.entities.Product.create(productData);
                    created++;
                    console.log(`✅ Created: ${productData.name}`);
                }
                
            } catch (error) {
                console.error(`❌ Error processing line ${i + 1}:`, error.message);
                errors++;
            }
        }
        
        console.log(`✅ Import complete: ${created} created, ${updated} updated, ${errors} errors`);
        
        return Response.json({
            success: true,
            created,
            updated,
            errors,
            total: lines.length - 1
        });
        
    } catch (error) {
        console.error('❌ [ImportCSV] Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});