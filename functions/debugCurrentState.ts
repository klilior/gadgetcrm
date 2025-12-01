import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    try {
        console.log("🔍 בודק מצב נוכחי של בסיס הנתונים...");
        
        // בדיקת הזמנות
        const allOrders = await base44.entities.Order.list("-created_date", 10);
        console.log(`📦 נמצאו ${allOrders.length} הזמנות (מתוך 10 הראשונות)`);
        
        // בדיקת לקוחות
        const allClients = await base44.entities.Client.list(null, 10);
        console.log(`👥 נמצאו ${allClients.length} לקוחות`);
        
        // בדיקת מוצרי הזמנות
        const allOrderProducts = await base44.entities.OrderProduct.list(null, 10);
        console.log(`📋 נמצאו ${allOrderProducts.length} מוצרי הזמנות`);
        
        // ניתוח ההזמנות
        const ordersAnalysis = allOrders.map((order, index) => ({
            index: index + 1,
            id: order.id,
            external_order_number: order.external_order_number,
            client_id: order.client_id,
            order_date: order.order_date,
            status: order.status,
            total: order.total,
            created_date: order.created_date,
            hasClientId: !!order.client_id
        }));
        
        // ניתוח הלקוחות
        const clientsAnalysis = allClients.map(client => ({
            id: client.id,
            full_name: client.full_name,
            email: client.email,
            phone: client.phone,
            woo_customer_id: client.woo_customer_id
        }));
        
        console.log("📊 ניתוח הזמנות:");
        ordersAnalysis.forEach(order => {
            console.log(`${order.index}. הזמנה #${order.external_order_number} - לקוח: ${order.client_id ? '✅' : '❌'} - סטטוס: ${order.status || 'חסר'} - סכום: ${order.total || 'חסר'}`);
        });
        
        console.log("👥 ניתוח לקוחות:");
        clientsAnalysis.forEach((client, index) => {
            console.log(`${index + 1}. ${client.full_name} - ${client.email} - WooID: ${client.woo_customer_id || 'חסר'}`);
        });
        
        return Response.json({
            success: true,
            summary: {
                totalOrders: allOrders.length,
                totalClients: allClients.length,
                totalOrderProducts: allOrderProducts.length,
                ordersWithClientId: ordersAnalysis.filter(o => o.hasClientId).length
            },
            ordersAnalysis,
            clientsAnalysis,
            sampleOrderProducts: allOrderProducts.slice(0, 5)
        });
        
    } catch (error) {
        console.error("❌ שגיאה בבדיקת המצב:", error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});