import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const PLUGINS_BASE = 'https://plugins.ship.co.il';
const MAX_PICKUP_DISTANCE_KM = 2; // serial+picking gates enforced server-side

function normalizeCityName(value) {
  return String(value || '')
    .replace(/[\"'׳״]/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const num = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function extractCityFromAddress(address) {
  const parts = String(address || '').split(',').map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

async function getToken() {
  const body = new URLSearchParams({
    username: Deno.env.get('SHIP_USERNAME'),
    password: Deno.env.get('SHIP_PASSWORD'),
    scope: Deno.env.get('SHIP_SCOPE'),
    grant_type: 'password'
  });

  const res = await fetch(`${PLUGINS_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get Ship.co.il token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const {
    shipment_type,  // 'pickup_point' | 'standard' | 'pickup_drop'
    order_id,
    external_order_number,
    client_id,
    consignee_name,
    consignee_phone,
    consignee_city,
    consignee_street,
    consignee_house,
    consignee_zip,
    consignee_email,
    pickup_point_id,
    pickup_point_name,
    pickup_point_address,
    pickup_point_city,
    pickup_point_distance,
    weight,
    num_packages,
    reference,
    notes,
    followup_id,  // optional: if set, update OrderFollowup instead of locking Order
    linet_order_status_id,  // optional: if set, lock LinetOrderStatus record directly
    dry_run,  // optional: run all gates + auth, stop before creating a real waybill
  } = await req.json();

  if (!shipment_type || !consignee_name || !consignee_phone || !consignee_city) {
    return Response.json({ error: 'חסרים שדות חובה' }, { status: 400 });
  }

  // ── Picking gate: block outbound WooCommerce shipments before picking is complete ──
  // Only for the initial treatment (not followups, not pickup_drop returns).
  const safeGateOrderId = order_id && String(order_id) !== 'undefined' && String(order_id) !== 'null' ? String(order_id) : null;
  if (safeGateOrderId && !followup_id && shipment_type !== 'pickup_drop') {
    try {
      const gate = await base44.asServiceRole.functions.invoke('checkPickingGate', { order_id: safeGateOrderId });
      const gateData = gate?.data ?? gate;
      if (gateData?.blocked) {
        return Response.json({ success: false, error: gateData.message_he || 'לא ניתן ליצור משלוח לפני השלמת ליקוט.' }, { status: 409 });
      }
    } catch (ge) {
      console.log(`⚠️ Picking gate check failed (allowing): ${ge.message}`);
    }

    // ── Serial gate: block shipment if a serial-required item is not yet verified/invoiced ──
    try {
      const sGate = await base44.asServiceRole.functions.invoke('checkShipmentGate', { order_id: safeGateOrderId });
      const sData = sGate?.data ?? sGate;
      if (sData?.blocked) {
        const sMsg = (sData.messages_he && sData.messages_he.join(' ')) || sData.message_he || 'לא ניתן ליצור משלוח — יש להשלים טיפול בסריאל (אימות והפקת חשבונית).';
        await base44.asServiceRole.entities.SerialAuditLog.create({
          order_id: safeGateOrderId,
          action: 'shipment_blocked',
          new_value: sMsg,
          result: 'blocked',
          error_message: sMsg,
        }).catch(() => {});
        return Response.json({ success: false, error: sMsg }, { status: 409 });
      }
    } catch (se) {
      console.log(`⚠️ Serial gate check failed (allowing): ${se.message}`);
    }
  }

  const pickupWarnings = [];
  if (shipment_type === 'pickup_point') {
    const orderCity = normalizeCityName(consignee_city);
    const pointCityLabel = pickup_point_city || extractCityFromAddress(pickup_point_address);
    const pointCity = normalizeCityName(pointCityLabel);
    const distance = toNumber(pickup_point_distance);

    if (orderCity && pointCity && orderCity !== pointCity) {
      pickupWarnings.push(`עיר נקודת האיסוף (${pointCityLabel}) שונה מעיר הלקוח (${consignee_city})`);
    }

    if (distance !== null && distance > MAX_PICKUP_DISTANCE_KM) {
      pickupWarnings.push(`נקודת האיסוף רחוקה ${distance.toFixed(1)} ק״מ מהלקוח — מעל ${MAX_PICKUP_DISTANCE_KM} ק״מ`);
    }
  }

  if (pickupWarnings.length) console.log(`⚠️ Pickup point approved with warning: ${pickupWarnings.join(' | ')}`);
  console.log(`📦 Creating ${shipment_type} shipment for ${consignee_name}`);

  const token = await getToken();

  if (dry_run) {
    return Response.json({
      success: true,
      dry_run: true,
      gates_passed: true,
      token_ok: !!token,
      pickup_warnings: pickupWarnings,
    });
  }

  // Build the waybill payload
  const data = {
    NumberOfPackages: num_packages || 1,
    ConsigneeAddress: {
      ContactPerson: consignee_name,
      CustomerName: consignee_name,
      CityName: consignee_city,
      StreetName: consignee_street || '',
      HouseNumber: consignee_house || '',
      Phone1: consignee_phone,
      Phone2: consignee_phone,
      ZipCode: consignee_zip || '',
      ContactEmail: consignee_email || '',
      Instructions: notes || '',
      LocationDescription: notes || ''
    },
    Reference1: reference || external_order_number || '',
    UseDefaultShipperAddress: true,
    Weight: weight || 1,
    ProcessName: 10
  };

  // For pickup_point shipments, add PickupPointID
  if (shipment_type === 'pickup_point' && pickup_point_id) {
    data.PickupPointID = pickup_point_id;
  }

  // For pickup_drop (return from customer), mark as return
  if (shipment_type === 'pickup_drop') {
    data.IsReturn = true;
    data.PaymentType = 'PP';
  }

  const url = `${PLUGINS_BASE}/api/v1/shipment/insert-domestic-wb-by-customer`;
  console.log(`POST ${url}`);
  console.log('Payload:', JSON.stringify(data).substring(0, 500));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000)
  });

  const responseText = await res.text();
  console.log(`Response status: ${res.status}`);
  console.log(`Response: ${responseText.substring(0, 500)}`);

  let response;
  try { response = JSON.parse(responseText); } catch { response = { raw: responseText }; }

  // Check for errors
  let error = null;
  let tracking_number = null;

  if (!response || response.Message) {
    error = response?.Message || 'תשובה ריקה מהשרת';
  } else if (response.ErrorCode > 0) {
    error = `${response.ErrorCode} - ${response.ErrorMessage}`;
  } else if (response.ValidationErrors?.length > 0) {
    error = response.ValidationErrors.map(e => e.ErrorMessage || e).join(', ');
  } else {
    tracking_number = response.TrackingNumber;
  }

  if (error) {
    console.error('❌ Shipment error:', error);
    // Save failed shipment
    const shipment = await base44.asServiceRole.entities.Shipment.create({
      shipment_type,
      order_id: order_id || null,
      external_order_number: external_order_number || null,
      client_id: client_id || null,
      consignee_name,
      consignee_phone,
      consignee_city,
      consignee_street: consignee_street || null,
      consignee_house: consignee_house || null,
      consignee_zip: consignee_zip || null,
      pickup_point_id: pickup_point_id || null,
      pickup_point_name: pickup_point_name || null,
      pickup_point_address: pickup_point_address || null,
      weight: weight || 1,
      num_packages: num_packages || 1,
      reference: reference || external_order_number || null,
      status: 'failed',
      error_message: error,
      api_response: response
    });
    return Response.json({ success: false, error, shipment_id: shipment.id });
  }

  console.log(`✅ Tracking: ${tracking_number}`);

  // Save successful shipment
  const shipment = await base44.asServiceRole.entities.Shipment.create({
    shipment_type,
    order_id: order_id || null,
    external_order_number: external_order_number || null,
    client_id: client_id || null,
    consignee_name,
    consignee_phone,
    consignee_city,
    consignee_street: consignee_street || null,
    consignee_house: consignee_house || null,
    consignee_zip: consignee_zip || null,
    pickup_point_id: pickup_point_id || null,
    pickup_point_name: pickup_point_name || null,
    pickup_point_address: pickup_point_address || null,
    weight: weight || 1,
    num_packages: num_packages || 1,
    reference: reference || external_order_number || null,
    tracking_number,
    status: 'created',
    api_response: response
  });

  // If there's an order, update its status and add WooCommerce note with tracking for regular outbound shipments only
  // Guard: order_id must be a non-empty, non-"undefined" string to avoid 404 on .get()
  const safeOrderId = order_id && String(order_id) !== 'undefined' && String(order_id) !== 'null' ? String(order_id) : null;
  let wooOrder = null;
  if (safeOrderId && shipment_type !== 'pickup_drop') {
    try {
      // If this shipment belongs to a followup — update the followup, not the main order
      if (followup_id) {
        try {
          await base44.asServiceRole.entities.OrderFollowup.update(followup_id, {
            status: 'shipment_created',
            new_shipment_created_at: new Date().toISOString(),
          });
          console.log(`✅ OrderFollowup ${followup_id} updated to shipment_created`);
          // Audit log
          await base44.asServiceRole.entities.SerialAuditLog.create({
            order_id: safeOrderId,
            action: 'followup_shipment_created',
            new_value: `משלוח חדש נוצר בטיפול המשך: ${tracking_number}`,
            result: 'success',
          }).catch(() => {});
        } catch (fe) {
          console.error(`❌ Failed to update OrderFollowup ${followup_id}: ${fe.message}`);
        }
      } else {
        // Normal shipment — lock the original order
        wooOrder = null;
        try { wooOrder = await base44.asServiceRole.entities.Order.get(safeOrderId); } catch (_) {}
        if (wooOrder) {
          await base44.asServiceRole.entities.Order.update(safeOrderId, {
            status: 'completed',
            shipment_created_at: new Date().toISOString(),
            order_locked: true,
          });
        } else {
          // Try SuperPharmOrder (Mirakl)
          let spLocked = false;
          try {
            const spOrders = await base44.asServiceRole.entities.SuperPharmOrder.filter({ mirakl_order_id: safeOrderId }, null, 1);
            if (spOrders.length > 0) {
              await base44.asServiceRole.entities.SuperPharmOrder.update(spOrders[0].id, {
                order_locked: true,
                shipment_created_at: new Date().toISOString(),
              });
              console.log(`✅ SuperPharmOrder ${safeOrderId} locked`);
              spLocked = true;
            }
          } catch (spe) {
            console.error(`❌ Failed to lock SP order ${safeOrderId}: ${spe.message}`);
          }

          // Try LinetOrderStatus — must be passed explicitly as linet_order_status_id
          if (!spLocked && linet_order_status_id) {
            try {
              await base44.asServiceRole.entities.LinetOrderStatus.update(linet_order_status_id, {
                order_locked: true,
                shipment_created_at: new Date().toISOString(),
                status: 'נוצר משלוח',
              });
              console.log(`✅ LinetOrderStatus ${linet_order_status_id} locked`);
            } catch (le) {
              console.error(`❌ Failed to lock LinetOrderStatus ${linet_order_status_id}: ${le.message}`);
            }
          }
        }
      }
      console.log(`✅ Order ${order_id} marked as completed and locked`);

      // Add tracking number as note in WooCommerce
      if (wooOrder && wooOrder.external_order_number) {
        try {
          const [urlSetting, keySetting, secretSetting] = await Promise.all([
            base44.asServiceRole.entities.Settings.filter({ setting_name: "WOOCOMMERCE_SITE_URL" }),
            base44.asServiceRole.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_KEY" }),
            base44.asServiceRole.entities.Settings.filter({ setting_name: "WOOCOMMERCE_CONSUMER_SECRET" })
          ]);
          const wooUrl = urlSetting[0]?.setting_value;
          const consumerKey = keySetting[0]?.setting_value;
          const consumerSecret = secretSetting[0]?.setting_value;

          if (wooUrl && consumerKey && consumerSecret) {
            const authString = btoa(`${consumerKey}:${consumerSecret}`);
            const noteText = `שטר מטען UPS נוצר.\nמספר מעקב: ${tracking_number}\nמעקב: https://www.ups.co.il/tracking?trackingNumbers=${tracking_number}`;
            
            const noteRes = await fetch(`${wooUrl}/wp-json/wc/v3/orders/${order.external_order_number}/notes`, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ note: noteText, customer_note: false }),
              signal: AbortSignal.timeout(10000)
            });
            
            if (noteRes.ok) {
              console.log(`✅ WooCommerce note added with tracking: ${tracking_number}`);
            } else {
              console.log(`⚠️ Could not add WooCommerce note: ${noteRes.status}`);
            }
          }
        } catch (noteErr) {
          console.log(`⚠️ Could not add WooCommerce note: ${noteErr.message}`);
        }
      }
    } catch (e) {
      console.log(`⚠️ Could not update order status: ${e.message}`);
    }
  }

  return Response.json({
    success: true,
    tracking_number,
    shipment_id: shipment.id
  });
});