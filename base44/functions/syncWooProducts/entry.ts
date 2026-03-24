import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log('🔄 [SyncProducts] Starting product sync...');
        
        const user = await base44.auth.me().catch(() => null);
        if (!user) {
            console.error('❌ User not authenticated');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        // Get WooCommerce URL from settings
        const [urlSettings, keySettings, secretSettings] = await Promise.all([
            base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_SITE_URL' }).catch(() => []),
            base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_CONSUMER_KEY' }).catch(() => []),
            base44.asServiceRole.entities.Settings.filter({ setting_name: 'WOOCOMMERCE_CONSUMER_SECRET' }).catch(() => [])
        ]);
        
        if (!urlSettings.length || !keySettings.length || !secretSettings.length) {
            console.error('❌ Missing WooCommerce credentials');
            return Response.json({ 
                success: false, 
                error: 'WooCommerce credentials not configured. Please add them in Settings.' 
            }, { status: 400 });
        }
        
        const WOO_URL = urlSettings[0].setting_value;
        const WOO_KEY = keySettings[0].setting_value;
        const WOO_SECRET = secretSettings[0].setting_value;
        
        let page = 1;
        const perPage = 100;
        let created = 0;
        let updated = 0;
        let errors = 0;
        let totalProcessed = 0;
        const batchSize = 25;
        
        console.log('🚀 Starting product sync with streaming approach...');
        
        // Initialize progress tracking
        await base44.asServiceRole.entities.Settings.filter({ setting_name: 'product_sync_progress' })
            .then(async (existing) => {
                if (existing.length > 0) {
                    await base44.asServiceRole.entities.Settings.update(existing[0].id, {
                        setting_value: JSON.stringify({ 
                            status: 'running', 
                            page: 0, 
                            total: 0, 
                            created: 0, 
                            updated: 0, 
                            errors: 0,
                            shouldStop: false
                        })
                    });
                } else {
                    await base44.asServiceRole.entities.Settings.create({
                        setting_name: 'product_sync_progress',
                        setting_value: JSON.stringify({ 
                            status: 'running', 
                            page: 0, 
                            total: 0, 
                            created: 0, 
                            updated: 0, 
                            errors: 0,
                            shouldStop: false
                        })
                    });
                }
            });
        
        // Retry helper function
        const fetchWithRetry = async (url, auth, maxRetries = 3) => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const response = await fetch(url, {
                        headers: {
                            'Authorization': `Basic ${auth}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (response.status === 503) {
                        console.warn(`⚠️ Server busy (503), attempt ${attempt}/${maxRetries}`);
                        if (attempt < maxRetries) {
                            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                            console.log(`⏳ Waiting ${delay}ms before retry...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }
                    }
                    
                    return response;
                } catch (error) {
                    if (attempt === maxRetries) throw error;
                    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                    console.warn(`⚠️ Fetch error, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };
        
        // Process products page by page
        while (true) {
            // Check if stop was requested
            const progressCheck = await base44.asServiceRole.entities.Settings.filter({ 
                setting_name: 'product_sync_progress' 
            });
            
            if (progressCheck.length > 0) {
                const progress = JSON.parse(progressCheck[0].setting_value);
                if (progress.shouldStop) {
                    console.log('⏸️ Sync stopped by user');
                    await base44.asServiceRole.entities.Settings.update(progressCheck[0].id, {
                        setting_value: JSON.stringify({
                            status: 'paused',
                            page,
                            total: totalProcessed,
                            created,
                            updated,
                            errors,
                            shouldStop: false
                        })
                    });
                    
                    return Response.json({
                        success: true,
                        message: 'Sync paused',
                        created,
                        updated,
                        errors,
                        totalProcessed
                    });
                }
            }
            
            try {
                console.log(`📥 Fetching page ${page}...`);
                
                const url = `${WOO_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}`;
                const auth = btoa(`${WOO_KEY}:${WOO_SECRET}`);
                
                const response = await fetchWithRetry(url, auth);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ WooCommerce API Error (${response.status}):`, errorText);
                    
                    if (response.status === 503) {
                        console.log('⏸️ Server overloaded, waiting 30 seconds...');
                        await new Promise(resolve => setTimeout(resolve, 30000));
                        continue; // Retry same page
                    }
                    
                    throw new Error(`WooCommerce API failed: ${response.status}`);
                }
                
                const products = await response.json();
                
                if (!products || products.length === 0) {
                    console.log('✅ No more products to fetch');
                    break;
                }
                
                console.log(`📦 Processing ${products.length} products from page ${page}...`);
                
                // Process in batches to avoid overwhelming the database
                for (let i = 0; i < products.length; i += batchSize) {
                    const batch = products.slice(i, i + batchSize);
                    
                    await Promise.allSettled(batch.map(async (wooProduct) => {
                        try {
                            const productData = {
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
                                on_sale: wooProduct.on_sale,
                                manage_stock: wooProduct.manage_stock,
                                stock_quantity: wooProduct.stock_quantity,
                                stock_status: wooProduct.stock_status,
                                categories: wooProduct.categories || [],
                                tags: wooProduct.tags || [],
                                images: wooProduct.images || [],
                                attributes: wooProduct.attributes || [],
                                date_created: wooProduct.date_created,
                                date_modified: wooProduct.date_modified,
                                raw_data: JSON.stringify(wooProduct)
                            };
                            
                            const existing = await base44.asServiceRole.entities.Product.filter({ 
                                woo_product_id: wooProduct.id 
                            });
                            
                            if (existing.length > 0) {
                                await base44.asServiceRole.entities.Product.update(existing[0].id, productData);
                                updated++;
                            } else {
                                await base44.asServiceRole.entities.Product.create(productData);
                                created++;
                            }
                            
                        } catch (error) {
                            console.error(`❌ Error syncing product ${wooProduct.id}:`, error.message);
                            errors++;
                        }
                    }));
                    
                    totalProcessed += batch.length;
                    console.log(`⏳ Progress: ${totalProcessed} products processed (${created} created, ${updated} updated, ${errors} errors)`);
                    
                    // Update progress
                    const progressSettings = await base44.asServiceRole.entities.Settings.filter({ 
                        setting_name: 'product_sync_progress' 
                    });
                    if (progressSettings.length > 0) {
                        await base44.asServiceRole.entities.Settings.update(progressSettings[0].id, {
                            setting_value: JSON.stringify({
                                status: 'running',
                                page,
                                total: totalProcessed,
                                created,
                                updated,
                                errors,
                                shouldStop: false
                            })
                        });
                    }
                }
                
                if (products.length < perPage) {
                    console.log('✅ Reached last page');
                    break;
                }
                
                page++;
                
                // Delay between pages to avoid overwhelming server
                console.log('⏳ Waiting 2 seconds before next page...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (pageError) {
                console.error(`❌ Error processing page ${page}:`, pageError);
                errors++;
                
                // Continue to next page on error
                page++;
                
                // Stop if we hit too many consecutive errors
                if (errors > 10 && created === 0 && updated === 0) {
                    console.error('❌ Too many errors, stopping sync');
                    
                    const errorProgress = await base44.asServiceRole.entities.Settings.filter({ 
                        setting_name: 'product_sync_progress' 
                    });
                    if (errorProgress.length > 0) {
                        await base44.asServiceRole.entities.Settings.update(errorProgress[0].id, {
                            setting_value: JSON.stringify({
                                status: 'error',
                                page,
                                total: totalProcessed,
                                created,
                                updated,
                                errors,
                                shouldStop: false
                            })
                        });
                    }
                    
                    return Response.json({
                        success: false,
                        error: 'Too many errors',
                        created,
                        updated,
                        errors,
                        totalProcessed
                    }, { status: 500 });
                }
            }
        }
        
        console.log(`✅ Sync completed: ${totalProcessed} products processed, ${created} created, ${updated} updated, ${errors} errors`);
        
        // Mark as completed
        const finalProgress = await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'product_sync_progress' 
        });
        if (finalProgress.length > 0) {
            await base44.asServiceRole.entities.Settings.update(finalProgress[0].id, {
                setting_value: JSON.stringify({
                    status: 'completed',
                    page,
                    total: totalProcessed,
                    created,
                    updated,
                    errors,
                    shouldStop: false
                })
            });
        }

        // Update cached total count
        const allProducts = await base44.asServiceRole.entities.Product.list('-created_date', 10000);
        const totalCountSettings = await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'product_total_count' 
        });

        const finalCount = allProducts.length >= 10000 ? '10000+' : allProducts.length.toString();

        if (totalCountSettings.length > 0) {
            await base44.asServiceRole.entities.Settings.update(totalCountSettings[0].id, {
                setting_value: finalCount
            });
        } else {
            await base44.asServiceRole.entities.Settings.create({
                setting_name: 'product_total_count',
                setting_value: finalCount
            });
        }
        
        return Response.json({
            success: true,
            created,
            updated,
            errors,
            totalProcessed
        });
        
    } catch (error) {
        console.error('❌ [SyncProducts] Fatal Error:', error);
        
        // Try to update progress to error state
        try {
            const errorSettings = await base44.asServiceRole.entities.Settings.filter({ 
                setting_name: 'product_sync_progress' 
            });
            if (errorSettings.length > 0) {
                await base44.asServiceRole.entities.Settings.update(errorSettings[0].id, {
                    setting_value: JSON.stringify({
                        status: 'error',
                        error: error.message,
                        page: 0,
                        total: 0,
                        created: 0,
                        updated: 0,
                        errors: 1,
                        shouldStop: false
                    })
                });
            }
        } catch (updateError) {
            console.error('❌ Failed to update error state:', updateError);
        }
        
        return Response.json({
            success: false,
            error: error.message || 'Unknown error occurred',
            details: error.stack
        }, { status: 500 });
    }
});