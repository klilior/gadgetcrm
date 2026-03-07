import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { order_number } = await req.json();
  
  const sr = base44.asServiceRole.entities;
  const [urlSetting, keySetting, secretSetting] = await Promise.all([
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
    sr.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
  ]);

  const wooUrl = urlSetting[0]?.setting_value;
  const key = keySetting[0]?.setting_value;
  const secret = secretSetting[0]?.setting_value;
  const auth = btoa(`${key}:${secret}`);

  const url = `${wooUrl}/wp-json/wc/v3/orders/${order_number}`;
  console.log('Fetching:', url);

  const res = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}` },
    signal: AbortSignal.timeout(10000)
  });
  
  const data = await res.json();
  
  // Extract relevant shipping/meta fields
  const result = {
    id: data.id,
    status: data.status,
    shipping_lines: data.shipping_lines,
    meta_data: data.meta_data,
    shipping: data.shipping,
    billing: data.billing,
    customer_note: data.customer_note,
    fee_lines: data.fee_lines
  };

  console.log('shipping_lines:', JSON.stringify(data.shipping_lines, null, 2));
  console.log('meta_data keys:', data.meta_data?.map(m => m.key));
  
  // Look for pickup point meta
  const pickupMetas = (data.meta_data || []).filter(m => 
    m.key?.includes('pickup') || m.key?.includes('ups') || m.key?.includes('point') || 
    m.key?.includes('shipping') || m.key?.includes('locker') || m.key?.includes('iid')
  );
  console.log('Pickup-related meta:', JSON.stringify(pickupMetas, null, 2));

  return Response.json(result);
});