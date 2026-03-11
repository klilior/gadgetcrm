import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const PLUGINS_BASE = 'https://plugins.ship.co.il';

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
    weight,
    num_packages,
    reference,
    notes
  } = await req.json();

  if (!shipment_type || !consignee_name || !consignee_phone || !consignee_city) {
    return Response.json({ error: 'חסרים שדות חובה' }, { status: 400 });
  }

  console.log(`📦 Creating ${shipment_type} shipment for ${consignee_name}`);

  const token = await getToken();

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

  // Fetch label PDF URL
  let label_url = null;
  try {
    const labelRes = await fetch(`${PLUGINS_BASE}/api/v1/shipment/get-label/${tracking_number}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    console.log(`Label response status: ${labelRes.status}`);
    if (labelRes.ok) {
      const contentType = labelRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const labelData = await labelRes.json();
        console.log('Label data:', JSON.stringify(labelData).substring(0, 300));
        label_url = labelData.LabelUrl || labelData.Url || labelData.url || null;
      } else if (contentType.includes('application/pdf')) {
        // The endpoint returned the PDF directly - build URL for direct access
        label_url = `${PLUGINS_BASE}/api/v1/shipment/get-label/${tracking_number}`;
      }
    } else {
      console.log('Label fetch failed, trying alternate endpoint...');
      const labelRes2 = await fetch(`${PLUGINS_BASE}/api/v1/shipment/get-label-by-tracking/${tracking_number}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
      console.log(`Alternate label response: ${labelRes2.status}`);
      if (labelRes2.ok) {
        const ct = labelRes2.headers.get('content-type') || '';
        if (ct.includes('pdf')) {
          label_url = `${PLUGINS_BASE}/api/v1/shipment/get-label-by-tracking/${tracking_number}`;
        } else {
          const d = await labelRes2.json();
          console.log('Alternate label data:', JSON.stringify(d).substring(0, 300));
          label_url = d.LabelUrl || d.Url || d.url || null;
        }
      }
    }
  } catch (labelErr) {
    console.log('⚠️ Could not fetch label:', labelErr.message);
  }

  console.log('Label URL:', label_url);

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

  // If there's an order, update its status
  if (order_id) {
    try {
      await base44.asServiceRole.entities.Order.update(order_id, { status: 'completed' });
      console.log(`✅ Order ${order_id} marked as completed`);
    } catch (e) {
      console.log(`⚠️ Could not update order status: ${e.message}`);
    }
  }

  return Response.json({
    success: true,
    tracking_number,
    label_url,
    shipment_id: shipment.id
  });
});