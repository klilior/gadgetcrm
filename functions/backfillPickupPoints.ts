import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const sr = base44.asServiceRole.entities;
  
  const [urlSetting, keySetting, secretSetting] = await Promise.all([
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
  ]);

  const wooUrl = urlSetting[0]?.setting_value;
  const auth = btoa(`${keySetting[0]?.setting_value}:${secretSetting[0]?.setting_value}`);

  // Get recent orders that have pickup shipping but no pickup_point_data
  const orders = await sr.Order.filter({ shipping_method: { $regex: "איסוף" } }, '-created_date', 30);
  const toFix = orders.filter(o => !o.pickup_point_data);
  console.log(`Found ${toFix.length} orders to backfill out of ${orders.length} pickup orders`);

  let updated = 0;
  for (const order of toFix) {
    try {
      const res = await fetch(`${wooUrl}/wp-json/wc/v3/orders/${order.external_order_number}`, {
        headers: { 'Authorization': `Basic ${auth}` },
        signal: AbortSignal.timeout(5000)
      });
      const wooOrder = await res.json();
      
      const pkpsMeta = (wooOrder.meta_data || []).find(m => m.key === 'pkps_json');
      if (pkpsMeta?.value) {
        const pickupData = typeof pkpsMeta.value === 'string' ? pkpsMeta.value : JSON.stringify(pkpsMeta.value);
        await sr.Order.update(order.id, { pickup_point_data: pickupData });
        updated++;
        console.log(`✅ Order #${order.external_order_number}: ${pickupData.substring(0, 100)}`);
      } else {
        console.log(`⏭ Order #${order.external_order_number}: no pkps_json`);
      }
    } catch (e) {
      console.error(`❌ Order #${order.external_order_number}: ${e.message}`);
    }
  }

  return Response.json({ success: true, total: toFix.length, updated });
});