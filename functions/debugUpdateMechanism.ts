import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    try {
        console.log("🧪 [Debug Update] Starting isolated update test...");

        // 1. Get existing orders from our DB that have no raw_data
        const ordersToUpdate = await base44.entities.Order.filter({ raw_data: null }, "-created_date", 5);

        if (ordersToUpdate.length === 0) {
            return Response.json({ success: true, message: "לא נמצאו הזמנות לעדכון." });
        }
        
        console.log(`🧪 Found ${ordersToUpdate.length} orders to test update on.`);
        
        let successCount = 0;
        const timestamp = new Date().toLocaleTimeString('he-IL');

        // 2. Loop and try to update ONLY the debug_status field
        for (const order of ordersToUpdate) {
            try {
                const newStatus = `UPDATED_OK @ ${timestamp}`;
                await base44.entities.Order.update(order.id, {
                    debug_status: newStatus
                });
                console.log(`✅ Updated order #${order.external_order_number} with debug_status: "${newStatus}"`);
                successCount++;
            } catch (e) {
                console.error(`❌ Failed to update order #${order.external_order_number}: ${e.message}`);
            }
        }

        const message = `ניסוי עדכון הושלם: ${successCount}/${ordersToUpdate.length} הזמנות עודכנו.`;
        console.log(`🎉 ${message}`);
        return Response.json({ success: true, message });

    } catch (error) {
        console.error("❌ [Debug Update] General Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});