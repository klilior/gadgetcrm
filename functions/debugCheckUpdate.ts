import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    try {
        console.log("🔍 [Check Update] Checking if debug_status was updated...");
        
        const latestOrders = await base44.entities.Order.list("-created_date", 20);
        
        const results = latestOrders.map(order => ({
            external_order_number: order.external_order_number,
            debug_status: order.debug_status || 'NULL'
        }));

        console.log("🔍 Results:", results);
        
        const updatedCount = results.filter(r => r.debug_status.startsWith('UPDATED_OK')).length;

        return Response.json({
            success: true,
            message: `נמצאו ${updatedCount}/20 הזמנות עם סטטוס בדיקה מעודכן.`,
            results
        });

    } catch (error) {
        console.error("❌ [Check Update] Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});