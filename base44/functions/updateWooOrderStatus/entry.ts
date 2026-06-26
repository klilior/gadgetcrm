import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { order_id, external_order_number, new_status } = await req.json();

  if (!order_id || !new_status) {
    return Response.json({ error: 'חסרים order_id או new_status' }, { status: 400 });
  }

  const sr = base44.asServiceRole.entities;

  // Get the order to find external_order_number. Some flows may pass a local ID,
  // while others may pass the WooCommerce order number.
  let order;
  try {
    order = await sr.Order.get(order_id);
  } catch (e) {
    const searchKey = String(external_order_number || order_id || '');
    const matches = searchKey ? await sr.Order.filter({ external_order_number: searchKey }) : [];
    order = matches?.[0] || null;
  }

  if (!order) {
    return Response.json({ success: false, updated_local: false, updated_woo: false, error: 'הזמנה לא נמצאה' });
  }
  const localOrderId = order.id;
  const externalOrderNumber = order.external_order_number || external_order_number;

  if (!externalOrderNumber) {
    // Just update locally if no WooCommerce order number
    await sr.Order.update(localOrderId, { status: new_status });
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
    await sr.Order.update(localOrderId, { status: new_status });
    return Response.json({ success: true, updated_local: true, updated_woo: false, warning: 'פרטי WooCommerce חסרים' });
  }

  const authString = btoa(`${consumerKey}:${consumerSecret}`);

  // WooCommerce REST API expects statuses without the 'wc-' prefix
  const wooStatus = new_status.startsWith('wc-') ? new_status.slice(3) : new_status;

  // Update WooCommerce
  console.log(`📤 Updating WooCommerce order #${externalOrderNumber} to status: ${wooStatus} (original: ${new_status})`);
  
  const wooRes = await fetch(`${wooUrl}/wp-json/wc/v3/orders/${externalOrderNumber}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: wooStatus }),
    signal: AbortSignal.timeout(15000)
  });

  if (!wooRes.ok) {
    const errorText = await wooRes.text();
    console.error(`❌ WooCommerce update failed: ${wooRes.status} - ${errorText}`);
    // Still update locally
    await sr.Order.update(localOrderId, { status: new_status });
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
  await sr.Order.update(localOrderId, { status: new_status });

  return Response.json({ 
    success: true, 
    updated_local: true, 
    updated_woo: true,
    woo_status: wooData.status 
  });
  } catch (error) {
    console.error('[WooCommerce Status Update] Error:', error.message);
    return Response.json({ success: false, updated_local: false, updated_woo: false, error: error.message });
  }
});