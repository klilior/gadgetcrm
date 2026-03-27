import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    try {
        console.log("🔍 בודק מה יש בבסיס הנתונים...");
        
        // בדיקה של כל ההזמנות שקיימות
        const allOrders = await base44.entities.Order.list("-created_date", 50);
        
        console.log(`📊 נמצאו ${allOrders.length} הזמנות בבסיס הנתונים:`);
        
        const ordersAnalysis = allOrders.map((order, index) => {
            const hasRawData = !!order.raw_data;
            const rawDataKeys = order.raw_data ? Object.keys(order.raw_data) : [];
            
            return {
                index: index + 1,
                id: order.id,
                external_order_number: order.external_order_number,
                hasRawData,
                rawDataKeysCount: rawDataKeys.length,
                created_date: order.created_date,
                // מידע חלקי מתוך raw_data אם קיים
                wooStatus: order.raw_data?.status || 'חסר',
                customerName: order.raw_data ? 
                    `${order.raw_data.billing?.first_name || ''} ${order.raw_data.billing?.last_name || ''}`.trim() || 'לא ידוע' 
                    : 'חסר raw_data',
                total: order.raw_data?.total || 'חסר'
            };
        });
        
        console.log("📋 פירוט ההזמנות:");
        ordersAnalysis.forEach(order => {
            console.log(`${order.index}. הזמנה #${order.external_order_number} - ${order.hasRawData ? '✅' : '❌'} raw_data - לקוח: ${order.customerName} - סטטוס: ${order.wooStatus}`);
        });
        
        return Response.json({ 
            success: true, 
            totalOrders: allOrders.length,
            ordersWithRawData: ordersAnalysis.filter(o => o.hasRawData).length,
            ordersWithoutRawData: ordersAnalysis.filter(o => !o.hasRawData).length,
            analysis: ordersAnalysis
        });
        
    } catch (error) {
        console.error("❌ שגיאה בבדיקת הנתונים:", error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});