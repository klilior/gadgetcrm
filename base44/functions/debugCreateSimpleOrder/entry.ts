import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    const log = (message, data) => {
        console.log(message, data ? JSON.stringify(data, null, 2) : '');
    };

    try {
        log("🔬 [Isolation Test] Attempting to create a single, simple order...");
        
        const simpleOrderData = {
            external_order_number: `SIMPLE_TEST_${Date.now()}`,
            source: "WooCommerce",
            order_date: new Date().toISOString(),
            fulfillment_status: "חדש",
            shipping_method: "שליח עד הבית",
            total_amount: "99.90"
        };
        
        log("📝 Data to be created:", simpleOrderData);

        const createdOrder = await base44.entities.Order.create(simpleOrderData);
        log("✅ SUCCESS: Simple order created successfully!", createdOrder);
        
        // Verify it exists
        const verifiedOrder = await base44.entities.Order.get(createdOrder.id);
        log("🔍 VERIFIED: Found the newly created order in DB.", verifiedOrder);
        
        return Response.json({ 
            success: true, 
            message: "Simple order created and verified successfully.",
            createdOrder: verifiedOrder
        }, { status: 200 });

    } catch (error) {
        log("❌ FAILED: An error occurred during the simple order creation test.", {
            errorMessage: error.message,
            errorStack: error.stack,
        });

        return Response.json({ 
            success: false, 
            error: "Failed the simple order creation test.",
            details: {
                errorMessage: error.message,
                errorStack: error.stack,
            }
        }, { status: 500 });
    }
});