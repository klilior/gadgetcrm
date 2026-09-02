import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * checkPickingGate — READ-ONLY
 * input: { order_id }  (internal Order raw_id)
 * output: { blocked, picking_status, total_items, picked_items, message_he }
 *
 * מקור האמת הוא רשומות PickingState שנוצרו במסך הליקוט — כך אין פרסר כפול
 * בשרת שעלול לא להסכים עם מה שהנציג רואה ומסמן.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id } = await req.json();

    if (!order_id) {
      return Response.json({ blocked: true, message_he: "לא סופק מזהה הזמנה." }, { status: 400 });
    }

    // Load the order (WooCommerce Order only — other sources are not gated here)
    let order = null;
    try { order = await base44.asServiceRole.entities.Order.get(String(order_id)); } catch (_) {}

    if (!order) {
      // Not a WooCommerce order → picking gate does not apply
      return Response.json({ blocked: false, picking_status: "completed", total_items: 0, picked_items: 0, message_he: "" });
    }

    let products = [];
    try {
      products = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: String(order_id) });
    } catch (_) {}
    const SHIPPING_UPSELL_SKU = '180948';
    products = (products || []).filter((x) => String(x.sku || '') !== SHIPPING_UPSELL_SKU && String(x.product_id ?? '') !== SHIPPING_UPSELL_SKU);

    if (products.length === 0) {
      return Response.json({ blocked: false, picking_status: "completed", total_items: 0, picked_items: 0, message_he: "" });
    }

    let picks = [];
    try { picks = await base44.asServiceRole.entities.PickingState.filter({ order_id: String(order_id) }); } catch (_) {}

    const totalItems = picks.length;
    const pickedItems = picks.filter((p) => p.picked).length;
    // נדרש לפחות פריט ליקוט אחד לכל שורת מוצר — הזמנה שלא נפתחה כלל לא תעבור
    const allPicked = totalItems > 0 && pickedItems === totalItems && totalItems >= products.length;

    if (!allPicked) {
      return Response.json({
        blocked: true,
        picking_status: pickedItems === 0 ? "not_started" : "partial",
        total_items: Math.max(totalItems, products.length),
        picked_items: pickedItems,
        message_he: "לא ניתן ליצור משלוח לפני השלמת ליקוט.",
      });
    }

    return Response.json({ blocked: false, picking_status: "completed", total_items: totalItems, picked_items: pickedItems, message_he: "" });
  } catch (err) {
    return Response.json({ blocked: true, message_he: `שגיאה בבדיקת שער הליקוט: ${err.message}` }, { status: 500 });
  }
});