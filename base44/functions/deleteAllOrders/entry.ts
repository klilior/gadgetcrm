import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    try {
        console.log("🗑️ Starting to delete all orders...");

        // Delete all order products first
        const existingProducts = await base44.entities.OrderProduct.filter({});
        console.log(`📋 Found ${existingProducts.length} order products to delete`);
        
        if (Array.isArray(existingProducts) && existingProducts.length > 0) {
            for (const product of existingProducts) {
                try {
                    await base44.entities.OrderProduct.delete(product.id);
                } catch (err) {
                    console.error(`Failed to delete product ${product.id}:`, err.message);
                }
            }
            console.log(`✅ Deleted ${existingProducts.length} products`);
        }

        // Then delete all orders
        const existingOrders = await base44.entities.Order.filter({});
        console.log(`📦 Found ${existingOrders.length} orders to delete`);
        
        if (Array.isArray(existingOrders) && existingOrders.length > 0) {
            for (const order of existingOrders) {
                try {
                    await base44.entities.Order.delete(order.id);
                } catch (err) {
                    console.error(`Failed to delete order ${order.id}:`, err.message);
                }
            }
            console.log(`✅ Deleted ${existingOrders.length} orders`);
        }

        return Response.json({ 
            success: true, 
            message: "כל ההזמנות נמחקו בהצלחה",
            deleted: {
                orders: existingOrders.length,
                products: existingProducts.length
            }
        });

    } catch (error) {
        console.error("❌ Delete Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});