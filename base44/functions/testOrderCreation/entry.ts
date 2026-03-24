import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req).asServiceRole;
        
        console.log("🧪 Testing simple order creation...");
        
        // נתונים פשוטים מאוד לבדיקה
        const testOrderData = {
            external_order_number: "TEST_12345",
            source: "WooCommerce",
            customer_id: null,
            order_date: new Date().toISOString(),
            fulfillment_status: "pending", // באנגלית
            shipping_method: "שליח עד הבית",
            shipping_cost: "19.00",
            planned_carrier: "מהיר-לי",
            total_amount: "268.90",
            line_items: [
                {
                    name: "Test Product",
                    quantity: 1,
                    total: "249.90"
                }
            ]
        };
        
        console.log("🧪 Attempting to create order with data:", JSON.stringify(testOrderData, null, 2));
        
        try {
            const createdOrder = await base44.entities.Order.create(testOrderData);
            console.log("✅ Order created successfully:", createdOrder);
            
            // בדיקה שההזמנה באמת קיימת
            const foundOrder = await base44.entities.Order.get(createdOrder.id);
            console.log("✅ Order retrieved successfully:", foundOrder);
            
            return Response.json({ 
                success: true, 
                message: "Order created successfully",
                orderData: testOrderData,
                createdOrder: createdOrder
            });
            
        } catch (createError) {
            console.error("❌ Failed to create order:", createError);
            return Response.json({ 
                success: false, 
                error: "Failed to create order",
                errorMessage: createError.message,
                errorStack: createError.stack,
                testOrderData: testOrderData
            });
        }
        
    } catch (error) {
        console.error("❌ General error:", error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack
        });
    }
});