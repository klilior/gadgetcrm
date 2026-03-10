import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { order_id, new_status } = await req.json();

  if (!order_id || !new_status) {
    return Response.json({ error: 'חסרים order_id או new_status' }, { status: 400 });
  }

  const sr = base44.asServiceRole.entities;

  // Get the order to find external_order_number
  let order;
  try {
    order = await sr.Order.get(order_id);
  } catch (e) {
    return Response.json({ error: 'הזמנה לא נמצאה: ' + e.message }, { status: 404 });
  }

  if (!order) {
    return Response.json({ error: 'הזמנה לא נמצאה' }, { status: 404 });
  }
  const externalOrderNumber = order.external_order_number;

  if (!externalOrderNumber) {
    // Just update locally if no WooCommerce order number
    await sr.Order.update(order_id, { status: new_status });
    return Response.json({ success: true, updated_local: true, updated_woo: false });
  }

  // Get WooCommerce credentials
  const [urlSetting, keySetting, secretSetting] = await Promise.all([
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
  ]);

  const wooUrl = urlSetting[0]?.setting_value;
  const consumerKey = keySetting[0]?.setting_value;
  const consumerSecret = secretSetting[0]?.setting_value;

  if (!wooUrl || !consumerKey || !consumerSecret) {
    // Update locally only
    await sr.Order.update(order_id, { status: new_status });
    return Response.json({ success: true, updated_local: true, updated_woo: false, warning: 'פרטי WooCommerce חסרים' });
  }

  const authString = btoa(`${consumerKey}:${consumerSecret}`);

  // Update WooCommerce
  console.log(`📤 Updating WooCommerce order #${externalOrderNumber} to status: ${new_status}`);
  
  const wooRes = await fetch(`${wooUrl}/wp-json/wc/v3/orders/${externalOrderNumber}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: new_status }),
    signal: AbortSignal.timeout(15000)
  });

  if (!wooRes.ok) {
    const errorText = await wooRes.text();
    console.error(`❌ WooCommerce update failed: ${wooRes.status} - ${errorText}`);
    // Still update locally
    await sr.Order.update(order_id, { status: new_status });
    return Response.json({ 
      success: true, 
      updated_local: true, 
      updated_woo: false, 
      warning: `עדכון מקומי בלבד. WooCommerce החזיר שגיאה: ${wooRes.status}` 
    });
  }

  const wooData = await wooRes.json();
  console.log(`✅ WooCommerce order #${externalOrderNumber} updated to: ${wooData.status}`);

  // Update locally
  await sr.Order.update(order_id, { status: new_status });

  return Response.json({ 
    success: true, 
    updated_local: true, 
    updated_woo: true,
    woo_status: wooData.status 
  });
});