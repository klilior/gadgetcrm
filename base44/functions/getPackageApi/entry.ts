import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Helper: get active settings
async function getSettings(sr) {
  const all = await sr.entities.GetPackageSettings.list('-created_date', 1);
  if (!all || all.length === 0) return null;
  return all[0];
}

// Helper: get API base URL
function getApiBase(settings) {
  if (settings.environment === 'production') {
    return settings.production_api_base_url || 'https://api.getpackage.com';
  }
  return settings.sandbox_api_base_url || 'https://sandbox-apiv2.getpackage.com';
}

// Helper: make API request to GetPackage
async function gpFetch(settings, method, path, body) {
  const base = getApiBase(settings);
  const url = `${base}${path}`;
  const token = settings.api_token;
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `APIKEY ${token}`,
    'X-API-Key': token,
  };
  
  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.body = JSON.stringify(body);
  }
  
  console.log(`[GetPackage] ${method} ${url}`);
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 500) }; }
  
  if (!resp.ok) {
    console.error(`[GetPackage] API Error ${resp.status}:`, JSON.stringify(data).substring(0, 500));
  }
  
  return { ok: resp.ok, status: resp.status, data };
}

// Helper: safely convert error to string
function errorToString(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) return err.join('; ');
  if (typeof err === 'object') return JSON.stringify(err).substring(0, 500);
  return String(err);
}

// Helper: clean street - remove city name and country from street if embedded
function cleanStreet(street, city) {
  if (!street) return street;
  // Remove ", ישראל" or ", Israel" suffixes
  let cleaned = street.replace(/,\s*(ישראל|Israel)\s*$/i, '').trim();
  // Remove city name if it appears after a comma at the end
  if (city && cleaned.toLowerCase().endsWith(city.toLowerCase())) {
    cleaned = cleaned.replace(new RegExp(',\\s*' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '').trim();
  }
  return cleaned;
}

// Helper: build address object, omitting empty/short strings (API requires minLength 2)
function buildAddress(city, street, country) {
  const addr = {};
  if (country && country.length >= 2) addr.country = country;
  if (city && city.length >= 2) addr.city = city;
  const cleanedStreet = cleanStreet(street, city);
  if (cleanedStreet && cleanedStreet.length >= 2) addr.street = cleanedStreet;
  return addr;
}

// Helper: build point object, omitting empty optional strings
function buildPoint(address, contactName, contactPhone, instructions) {
  const point = { address };
  if (contactName && contactName.length >= 2) point.contactName = contactName;
  if (contactPhone && contactPhone.length >= 8) point.contactPhoneNumber = contactPhone;
  if (instructions && instructions.length >= 2) point.instructions = instructions;
  return point;
}

// Map GP delivery status to our status
function mapGpStatus(gpStatus) {
  const map = {
    'CREATED': 'accepted',
    'ASSIGNED': 'pickup_pending',
    'STARTED': 'pickup_pending',
    'IN_ROUTE': 'in_transit',
    'PICKED_UP': 'picked_up',
    'COMPLETED': 'delivered',
    'CANCELED': 'cancelled',
    'CANCELED_BY_COURIER_ON_PICKUP': 'cancelled',
    'FAILED_DROPOFF': 'failed',
    'RETURNED': 'failed',
  };
  return map[gpStatus] || 'accepted';
}

// Active shipment statuses (prevent duplicates)
const ACTIVE_STATUSES = ['quote_received', 'accepted', 'pickup_pending', 'picked_up', 'in_transit'];

Deno.serve(async (req) => {
  let body = {};
  try { body = await req.json(); } catch (_) {}
  
  const base44 = createClientFromRequest(req);
  const sr = base44.asServiceRole;
  const action = body.action;
  
  // Try to get user but don't fail - custom auth systems may not use base44 User entity
  let user = null;
  try { user = await base44.auth.me(); } catch (_) {}
  
  try {
    // ===== GET SETTINGS =====
    if (action === 'getSettings') {
      const settings = await getSettings(sr);
      if (!settings) return Response.json({ success: true, settings: null });
      const masked = { ...settings };
      masked.api_token_set = !!(settings.api_token && settings.api_token.length > 0);
      delete masked.api_token;
      return Response.json({ success: true, settings: masked });
    }

    // ===== SAVE SETTINGS =====
    if (action === 'saveSettings') {
      if (user) {
        const appRole = user.app_role || user.role;
        if (appRole !== 'מנהל' && user.role !== 'admin') {
          return Response.json({ error: 'אין הרשאה לערוך הגדרות' }, { status: 403 });
        }
      }
      const data = body.data || {};
      const existing = await getSettings(sr);
      if (existing) {
        const updatePayload = { ...data };
        if (!updatePayload.api_token || updatePayload.api_token === '') {
          delete updatePayload.api_token;
        }
        await sr.entities.GetPackageSettings.update(existing.id, updatePayload);
      } else {
        await sr.entities.GetPackageSettings.create(data);
      }
      return Response.json({ success: true });
    }

    // ===== TEST CONNECTION =====
    if (action === 'testConnection') {
      const settings = await getSettings(sr);
      if (!settings || !settings.api_token) {
        return Response.json({ success: false, error: 'לא הוזן API Token' });
      }
      const result = await gpFetch(settings, 'GET', '/v1/deliveries/quota', null);
      if (result.ok) {
        return Response.json({ success: true, message: 'החיבור ל-GetPackage תקין.', quota: result.data });
      } else {
        return Response.json({ 
          success: false, 
          error: `החיבור ל-GetPackage נכשל (${result.status}). יש לבדוק את ה-API Token ואת כתובת ה-API.`,
          details: errorToString(result.data),
        });
      }
    }

    // ===== CREATE QUOTE =====
    if (action === 'createQuote') {
      const settings = await getSettings(sr);
      if (!settings?.is_active) return Response.json({ error: 'אינטגרציית GetPackage אינה פעילה' }, { status: 400 });
      if (!settings?.api_token) return Response.json({ error: 'חסר API Token בהגדרות GetPackage' }, { status: 400 });

      const orderId = body.order_id;
      if (!orderId) return Response.json({ error: 'חסר מזהה הזמנה' }, { status: 400 });

      // Check for active shipment
      const existing = await sr.entities.GetPackageShipment.filter({ order_id: orderId }, '-created_date', 10);
      const activeShipment = existing.find(s => ACTIVE_STATUSES.includes(s.status));
      if (activeShipment) {
        return Response.json({ error: 'כבר קיים משלוח GetPackage פעיל להזמנה זו.', existing_shipment: activeShipment });
      }

      // Validate required fields
      const dropoffPhone = body.dropoff_phone || body.customer_phone;
      const dropoffCity = body.dropoff_city;
      const dropoffAddress = body.dropoff_address;
      const dropoffName = body.dropoff_name || body.customer_name;

      if (!dropoffPhone) return Response.json({ error: 'חסר מספר טלפון ללקוח.' }, { status: 400 });
      if (!dropoffCity) return Response.json({ error: 'חסרה עיר למשלוח.' }, { status: 400 });
      if (!dropoffAddress) return Response.json({ error: 'חסרה כתובת למשלוח.' }, { status: 400 });

      const pickupCity = settings.default_pickup_city || '';
      const pickupStreet = settings.default_pickup_address || '';
      const pickupName = settings.default_pickup_name || settings.business_name || 'GADGET-TEAM';
      const pickupPhone = settings.default_pickup_phone || '';
      const pickupNotes = settings.default_pickup_notes || '';

      // Build Express quote request body per GetPackage API spec:
      // POST /v1/deliveries/express/quote
      const packageSize = String(body.package_size || 'SMALL');
      // Express endpoint expects the numeric enum (0-3); sharedRoute expects the name
      const PACKAGE_SIZE_CODES = { ENVELOPE: 0, SMALL: 1, MEDIUM: 2, LARGE: 3 };
      const packageSizeCode = PACKAGE_SIZE_CODES[packageSize] ?? 1;
      const pickUpPointData = buildPoint(
        buildAddress(pickupCity, pickupStreet, 'IL'),
        pickupName,
        pickupPhone,
        pickupNotes
      );
      const dropOffPointData = buildPoint(
        buildAddress(dropoffCity, dropoffAddress, 'IL'),
        dropoffName,
        dropoffPhone,
        body.dropoff_notes || ''
      );
      
      const quoteBody = {
        deliveries: [{
          pickUpPoint: pickUpPointData,
          dropOffPoint: dropOffPointData,
          package: { size: packageSize },
        }],
        stopPointsOrder: [0, 1],
      };

      console.log(`[GetPackage] Creating quote for order ${orderId}`);
      console.log(`[GetPackage] Full quote body:`, JSON.stringify(quoteBody));
      
      // SharedRoute quote only accepts { address } in points — no contactName/phone/instructions
      const cleanPickUpPoint = { address: pickUpPointData.address };
      const cleanDropOffPoint = { address: dropOffPointData.address };

      // Try Shared Route quote first (simple flat body, no instructions)
      const sharedRouteBody = {
        pickUpPoint: cleanPickUpPoint,
        dropOffPoint: cleanDropOffPoint,
        package: { size: packageSize },
      };
      
      console.log(`[GetPackage] Trying sharedRoute body:`, JSON.stringify(sharedRouteBody));
      let result = await gpFetch(settings, 'POST', '/v1/deliveries/sharedRoute/quote', sharedRouteBody);
      let usedEndpoint = 'sharedRoute';
      
      // If Shared Route fails, try Express
      let sharedRouteError = '';
      if (!result.ok) {
        console.log(`[GetPackage] Shared Route failed (${result.status}):`, JSON.stringify(result.data).substring(0, 300));
        sharedRouteError = errorToString(result.data?.message || result.data?.error || result.data);
        // Express body: deliveries array with stopPointsOrder (indexes of the delivery, numeric package size)
        const expressBody = {
          deliveries: [{
            pickUpPoint: pickUpPointData,
            dropOffPoint: dropOffPointData,
            package: { size: packageSizeCode },
          }],
          stopPointsOrder: [0, 0],
        };
        console.log(`[GetPackage] Trying express body:`, JSON.stringify(expressBody));
        usedEndpoint = 'express';
        result = await gpFetch(settings, 'POST', '/v1/deliveries/express/quote', expressBody);
      }
      
      // Fallback: GetPackage sometimes can't resolve a specific house number on a known street.
      // Retry without the house number and keep it in the courier notes.
      let effectiveDropoffAddress = dropoffAddress;
      let effectiveDropoffNotes = body.dropoff_notes || '';
      const isUnknownLocation = !result.ok && JSON.stringify(result.data || '').includes('unknown location');
      const houseMatch = String(dropoffAddress).match(/^(.*?)[\s,]+(\d+\s*[א-ת]?)$/);
      if (isUnknownLocation && houseMatch) {
        const streetOnly = houseMatch[1].trim();
        const houseNo = houseMatch[2].trim();
        console.log(`[GetPackage] Retrying without house number: "${streetOnly}" (בית ${houseNo})`);
        const retryPoint = { address: buildAddress(dropoffCity, streetOnly, 'IL') };
        const retryResult = await gpFetch(settings, 'POST', '/v1/deliveries/sharedRoute/quote', {
          pickUpPoint: cleanPickUpPoint,
          dropOffPoint: retryPoint,
          package: { size: packageSize },
        });
        if (retryResult.ok) {
          result = retryResult;
          usedEndpoint = 'sharedRoute';
          effectiveDropoffAddress = streetOnly;
          effectiveDropoffNotes = [`בית ${houseNo}`, effectiveDropoffNotes].filter(Boolean).join(' | ');
        }
      }

      console.log(`[GetPackage] Used endpoint: ${usedEndpoint}, result status: ${result.status}`);

      // Build shipment record
      const shipmentData = {
        order_id: orderId,
        woo_order_id: body.woo_order_id || '',
        customer_name: body.customer_name || '',
        customer_phone: dropoffPhone,
        customer_email: body.customer_email || '',
        pickup_name: pickupName,
        pickup_phone: pickupPhone,
        pickup_address: pickupStreet,
        pickup_city: pickupCity,
        pickup_notes: pickupNotes,
        dropoff_name: dropoffName || '',
        dropoff_phone: dropoffPhone,
        dropoff_address: effectiveDropoffAddress,
        dropoff_city: dropoffCity,
        dropoff_notes: effectiveDropoffNotes,
        package_description: body.package_description || '',
        package_quantity: body.package_quantity || 1,
        package_size: body.package_size || 'SMALL',
        raw_quote_response: result.data,
      };

      if (result.ok && result.data) {
        // Extract quote details - response varies by endpoint
        // SharedRoute: { totalRate, currency, taxRate }
        // Express: { id, routes: [{ price, ... }], trackingUrl, ... }
        const quoteId = result.data.id || result.data.quoteId || '';
        
        let price = null;
        let currency = 'ILS';
        
        // SharedRoute format
        if (result.data.totalRate !== undefined) {
          price = result.data.totalRate;
          currency = result.data.currency || 'ILS';
        }
        // Express format with routes
        if (price === null && result.data.routes && result.data.routes.length > 0) {
          const route = result.data.routes[0];
          price = route.price?.amount || route.price || route.totalPrice?.amount || null;
          currency = route.price?.currency || route.totalPrice?.currency || 'ILS';
        }
        // Generic fallback
        if (price === null) {
          price = result.data.price?.amount || result.data.totalPrice?.amount || result.data.price || null;
          if (result.data.price?.currency) currency = result.data.price.currency;
        }
        
        const trackingUrl = result.data.trackingUrl || '';

        shipmentData.quote_id = String(quoteId);
        shipmentData.quote_price = typeof price === 'number' ? price : parseFloat(price) || 0;
        shipmentData.quote_currency = currency;
        shipmentData.tracking_url = trackingUrl;
        shipmentData.quote_endpoint = usedEndpoint;
        shipmentData.status = 'quote_received';
        shipmentData.last_error = '';

        const created = await sr.entities.GetPackageShipment.create(shipmentData);
        console.log(`[GetPackage] Quote received: ${quoteId}, price: ${price} ${currency}`);
        return Response.json({ success: true, shipment: created, quote: result.data });
      } else {
        shipmentData.status = 'quote_failed';
        shipmentData.last_error = [
          errorToString(result.data?.message || result.data?.error || result.data?.errors || result.data),
          sharedRouteError ? `(מסלול משותף: ${sharedRouteError})` : '',
        ].filter(Boolean).join(' ');
        
        const created = await sr.entities.GetPackageShipment.create(shipmentData);
        console.error(`[GetPackage] Quote failed:`, JSON.stringify(result.data).substring(0, 1000));
        return Response.json({
          success: false,
          error: shipmentData.last_error || 'לא ניתן לקבל הצעת מחיר מ-GetPackage.',
          details: errorToString(result.data),
          shipment_id: created.id,
        });
      }
    }

    // ===== ACCEPT QUOTE =====
    if (action === 'acceptQuote') {
      const settings = await getSettings(sr);
      if (!settings?.is_active || !settings?.api_token) {
        return Response.json({ error: 'אינטגרציית GetPackage אינה פעילה או חסר Token' }, { status: 400 });
      }

      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      let shipment = null;
      try {
        shipment = await sr.entities.GetPackageShipment.get(shipmentId);
      } catch (_) {}
      if (!shipment) return Response.json({ success: false, error: 'משלוח לא נמצא' });
      if (shipment.status !== 'quote_received') {
        return Response.json({ error: 'ניתן לאשר רק משלוח שקיבל הצעת מחיר' }, { status: 400 });
      }

      const endpoint = shipment.quote_endpoint || (shipment.quote_id ? 'express' : 'sharedRoute');
      console.log(`[GetPackage] Accepting shipment ${shipmentId} via ${endpoint}`);

      let result;
      if (endpoint === 'sharedRoute') {
        // SharedRoute: create delivery via POST /v1/deliveries/sharedRoute
        // Requires: pickUpPoint, dropOffPoint (with validationMethodType), package, date, timeRange
        const pickUpPoint = buildPoint(
          buildAddress(shipment.pickup_city, shipment.pickup_address, 'IL'),
          shipment.pickup_name,
          shipment.pickup_phone,
          shipment.pickup_notes
        );
        const dropOffPoint = buildPoint(
          buildAddress(shipment.dropoff_city, shipment.dropoff_address, 'IL'),
          shipment.dropoff_name,
          shipment.dropoff_phone,
          shipment.dropoff_notes
        );
        // Drop-off requires a validation method for delivery confirmation
        dropOffPoint.validationMethodType = 'SMS';

        // Get available service times from the API
        // POST /v1/deliveries/serviceTimes/evaluate requires package field
        const stBody = {
          pickUpPoint: { address: pickUpPoint.address },
          dropOffPoint: { address: dropOffPoint.address },
          package: { size: shipment.package_size || 'SMALL' },
        };
        console.log(`[GetPackage] Fetching service times...`);
        const stResult = await gpFetch(settings, 'POST', '/v1/deliveries/serviceTimes/evaluate', stBody);
        
        let deliveryDate, deliveryTimeRange;
        if (stResult.ok && stResult.data) {
          console.log(`[GetPackage] Service times response:`, JSON.stringify(stResult.data).substring(0, 500));
          // evaluate returns { serviceType, subServiceType, date, timeRange }
          deliveryDate = stResult.data.date;
          deliveryTimeRange = stResult.data.timeRange;
          // Fallback: if response has nested serviceTimes array
          if (!deliveryDate && stResult.data.serviceTimes && stResult.data.serviceTimes.length > 0) {
            const st = stResult.data.serviceTimes[0];
            deliveryDate = st.date;
            deliveryTimeRange = st.timeRange;
          }
        } else {
          console.log(`[GetPackage] Service times failed:`, JSON.stringify(stResult.data).substring(0, 300));
          // Try the simpler /serviceTimes endpoint
          const stResult2 = await gpFetch(settings, 'POST', '/v1/deliveries/serviceTimes', stBody);
          if (stResult2.ok && Array.isArray(stResult2.data) && stResult2.data.length > 0) {
            console.log(`[GetPackage] serviceTimes list:`, JSON.stringify(stResult2.data).substring(0, 500));
            const first = stResult2.data[0];
            deliveryDate = first.date;
            deliveryTimeRange = first.timeRange;
          } else {
            console.log(`[GetPackage] serviceTimes list also failed:`, JSON.stringify(stResult2.data).substring(0, 300));
          }
        }

        if (!deliveryDate || !deliveryTimeRange) {
          return Response.json({
            success: false,
            error: 'לא נמצא חלון זמן זמין למשלוח. נסה שוב מאוחר יותר.',
          });
        }
        // Normalize date to YYYY-MM-DD (API may return full ISO string)
        if (deliveryDate.includes('T')) {
          deliveryDate = deliveryDate.split('T')[0];
        }
        console.log(`[GetPackage] Using date=${deliveryDate}, timeRange=${deliveryTimeRange}`);

        const createBody = {
          pickUpPoint,
          dropOffPoint,
          package: { size: shipment.package_size || 'SMALL' },
          date: deliveryDate,
          timeRange: deliveryTimeRange,
        };
        console.log(`[GetPackage] SharedRoute create body:`, JSON.stringify(createBody));
        result = await gpFetch(settings, 'POST', '/v1/deliveries/sharedRoute', createBody);
      } else {
        // Express: accept quote via PUT /v1/deliveries/express/quote/accept
        if (!shipment.quote_id) return Response.json({ error: 'חסר מזהה הצעת מחיר' }, { status: 400 });
        result = await gpFetch(settings, 'PUT', '/v1/deliveries/express/quote/accept', {
          quoteId: shipment.quote_id,
        });
      }

      console.log(`[GetPackage] Accept result:`, JSON.stringify(result.data).substring(0, 500));

      if (result.ok && result.data) {
        const deliveryId = result.data.id || result.data.deliveryId || shipment.quote_id || '';
        const routeId = result.data.routeId || '';
        const trackingUrl = result.data.trackingUrl || shipment.tracking_url || '';

        // Extract route info if available
        if (result.data.routes && result.data.routes.length > 0) {
          const route = result.data.routes[0];
          await sr.entities.GetPackageShipment.update(shipmentId, {
            delivery_id: String(deliveryId),
            route_id: String(route.id || routeId),
            tracking_url: route.trackingUrl || trackingUrl,
            status: 'accepted',
            raw_accept_response: result.data,
            last_error: '',
          });
        } else {
          await sr.entities.GetPackageShipment.update(shipmentId, {
            delivery_id: String(deliveryId),
            route_id: String(routeId),
            tracking_url: trackingUrl,
            status: 'accepted',
            raw_accept_response: result.data,
            last_error: '',
          });
        }

        console.log(`[GetPackage] Delivery created: id=${deliveryId}, tracking=${trackingUrl}`);

        // Sync order: mark as completed + save tracking + lock (same as UPS/Cargo flows)
        try {
          let order = null;
          if (shipment.order_id) {
            // order_id may be stored with a source prefix (e.g. "woo_<internalId>")
            const localId = String(shipment.order_id).replace(/^woo_/, '');
            order = await sr.entities.Order.get(localId).catch(() => null);
          }
          if (!order && shipment.woo_order_id) {
            const found = await sr.entities.Order.filter({ external_order_number: String(shipment.woo_order_id) });
            order = found[0] || null;
          }
          if (order) {
            await sr.entities.Order.update(order.id, {
              status: 'completed',
              tracking_number: String(deliveryId),
              tracking_carrier: 'getpackage',
              tracking_url: trackingUrl,
              shipment_created_at: order.shipment_created_at || new Date().toISOString(),
              order_locked: true,
            });
            const wooRes = await sr.functions.invoke('updateWooOrderStatus', {
              order_id: order.id,
              external_order_number: order.external_order_number,
              new_status: 'completed',
            });
            console.log('[GetPackage] Woo status update:', JSON.stringify(wooRes?.data || wooRes));
          }
        } catch (e) {
          console.error('[GetPackage] Order sync failed:', e.message);
        }

        return Response.json({
          success: true,
          delivery_id: deliveryId,
          route_id: routeId,
          tracking_url: trackingUrl,
        });
      } else {
        const errMsg = errorToString(result.data?.message || result.data?.error || result.data);
        await sr.entities.GetPackageShipment.update(shipmentId, {
          last_error: errMsg,
          raw_accept_response: result.data,
        });
        console.error(`[GetPackage] Accept failed:`, JSON.stringify(result.data).substring(0, 500));
        return Response.json({
          success: false,
          error: errMsg || 'לא ניתן לאשר את המשלוח.',
          details: errMsg,
        });
      }
    }

    // ===== REFRESH STATUS =====
    if (action === 'refreshStatus') {
      const settings = await getSettings(sr);
      if (!settings?.api_token) return Response.json({ error: 'חסר Token' }, { status: 400 });

      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      let shipment = null;
      try {
        shipment = await sr.entities.GetPackageShipment.get(shipmentId);
      } catch (_) {}
      if (!shipment) return Response.json({ success: false, error: 'משלוח לא נמצא' });

      const deliveryId = shipment.delivery_id || shipment.quote_id;
      if (!deliveryId) return Response.json({ error: 'חסר מזהה משלוח ב-GetPackage' }, { status: 400 });

      console.log(`[GetPackage] Refreshing status for delivery ${deliveryId}`);
      const result = await gpFetch(settings, 'GET', `/v1/deliveries/common/deliveries/${deliveryId}`, null);

      if (result.ok && result.data) {
        const gpStatus = result.data.status || result.data.deliveryStatus || '';
        const updates = {
          raw_status_response: result.data,
          last_status_checked_at: new Date().toISOString(),
          gp_delivery_status: gpStatus,
          last_error: '',
        };

        if (gpStatus) updates.status = mapGpStatus(gpStatus);
        if (result.data.trackingUrl) updates.tracking_url = result.data.trackingUrl;
        if (result.data.courier?.name) updates.courier_name = result.data.courier.name;
        if (result.data.courier?.phoneNumber) updates.courier_phone = result.data.courier.phoneNumber;

        await sr.entities.GetPackageShipment.update(shipmentId, updates);
        return Response.json({ success: true, status: updates.status, gp_status: gpStatus, data: result.data });
      } else {
        const errMsg = errorToString(result.data?.message || result.data);
        await sr.entities.GetPackageShipment.update(shipmentId, { last_error: errMsg });
        return Response.json({ success: false, error: 'לא ניתן לרענן סטטוס', details: errMsg });
      }
    }

    // ===== CANCEL SHIPMENT =====
    if (action === 'cancelShipment') {
      const settings = await getSettings(sr);
      if (!settings?.api_token) return Response.json({ error: 'חסר Token' }, { status: 400 });

      if (user) {
        const appRole = user.app_role || user.role;
        if (appRole !== 'מנהל' && appRole !== 'מנהל משמרת' && user.role !== 'admin') {
          return Response.json({ error: 'רק מנהל יכול לבטל משלוח' }, { status: 403 });
        }
      }

      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      let shipment = null;
      try {
        shipment = await sr.entities.GetPackageShipment.get(shipmentId);
      } catch (_) {}
      if (!shipment) return Response.json({ success: false, error: 'משלוח לא נמצא' });

      const deliveryId = shipment.delivery_id || shipment.quote_id;
      if (!deliveryId) {
        await sr.entities.GetPackageShipment.update(shipmentId, { status: 'cancelled', last_error: '' });
        return Response.json({ success: true, message: 'המשלוח בוטל (טרם נוצר ב-GetPackage)' });
      }

      console.log(`[GetPackage] Cancelling delivery ${deliveryId}`);
      // Cancel via common endpoint: DELETE /v1/deliveries/common/deliveries/{id}
      const result = await gpFetch(settings, 'DELETE', `/v1/deliveries/common/deliveries/${deliveryId}`, null);

      if (result.ok || result.status === 404) {
        await sr.entities.GetPackageShipment.update(shipmentId, {
          status: 'cancelled',
          last_error: '',
        });
        return Response.json({ success: true, message: 'משלוח GetPackage בוטל.' });
      } else {
        const errMsg = errorToString(result.data?.message || result.data);
        await sr.entities.GetPackageShipment.update(shipmentId, { last_error: errMsg });
        return Response.json({ success: false, error: 'לא ניתן לבטל את המשלוח', details: errMsg });
      }
    }

    // ===== SEND TRACKING SMS =====
    if (action === 'sendTrackingSms') {
      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      let shipment = null;
      try {
        shipment = await sr.entities.GetPackageShipment.get(shipmentId);
      } catch (_) {}
      if (!shipment) return Response.json({ success: false, error: 'משלוח לא נמצא' });
      if (!shipment.tracking_url) return Response.json({ error: 'אין קישור מעקב זמין למשלוח זה' }, { status: 400 });
      if (!shipment.customer_phone) return Response.json({ error: 'חסר טלפון לקוח' }, { status: 400 });

      const firstName = (shipment.customer_name || '').split(' ')[0] || 'לקוח';
      const smsBody = `שלום ${firstName}, ההזמנה שלך מ-GADGET-TEAM יצאה למשלוח עם GetPackage.\n\nלמעקב אחר המשלוח:\n${shipment.tracking_url}\n\nתודה,\nצוות GADGET-TEAM`;

      await sr.functions.invoke('sendTextMeSMS', {
        to: shipment.customer_phone,
        message: smsBody,
      });

      return Response.json({ success: true, message: 'SMS עם קישור מעקב נשלח ללקוח' });
    }

    // ===== BULK REFRESH (for automation) =====
    if (action === 'bulkRefreshStatuses') {
      const settings = await getSettings(sr);
      if (!settings?.api_token) return Response.json({ error: 'חסר Token' }, { status: 400 });

      const openStatuses = ['accepted', 'pickup_pending', 'picked_up', 'in_transit'];
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      let allOpen = [];
      for (const status of openStatuses) {
        const batch = await sr.entities.GetPackageShipment.filter({ status }, '-created_date', 50);
        allOpen.push(...batch);
      }
      allOpen = allOpen.filter(s => s.created_date >= cutoff);

      let updated = 0;
      let errors = 0;

      for (const shipment of allOpen) {
        const deliveryId = shipment.delivery_id || shipment.quote_id;
        if (!deliveryId) continue;

        try {
          const result = await gpFetch(settings, 'GET', `/v1/deliveries/common/deliveries/${deliveryId}`, null);
          if (result.ok && result.data) {
            const gpStatus = result.data.status || result.data.deliveryStatus || '';
            const newStatus = gpStatus ? mapGpStatus(gpStatus) : shipment.status;
            const upd = {
              raw_status_response: result.data,
              last_status_checked_at: new Date().toISOString(),
              gp_delivery_status: gpStatus,
            };
            if (newStatus !== shipment.status) upd.status = newStatus;
            if (result.data.trackingUrl) upd.tracking_url = result.data.trackingUrl;
            if (result.data.courier?.name) upd.courier_name = result.data.courier.name;
            if (result.data.courier?.phoneNumber) upd.courier_phone = result.data.courier.phoneNumber;
            await sr.entities.GetPackageShipment.update(shipment.id, upd);
            updated++;
          }
        } catch (e) {
          console.error(`[GetPackage] Refresh error for ${shipment.id}: ${e.message}`);
          errors++;
        }
      }

      console.log(`[GetPackage] Bulk refresh: ${updated} updated, ${errors} errors, ${allOpen.length} total`);
      return Response.json({ success: true, total: allOpen.length, updated, errors });
    }

    // ===== GET SHIPMENTS FOR ORDER =====
    if (action === 'getShipmentsForOrder') {
      const orderId = body.order_id;
      if (!orderId) return Response.json({ error: 'חסר מזהה הזמנה' }, { status: 400 });
      const shipments = await sr.entities.GetPackageShipment.filter({ order_id: orderId }, '-created_date', 10);
      return Response.json({ success: true, shipments });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });

  } catch (error) {
    console.error(`[GetPackage] Error in action=${action}:`, error.message);
    return Response.json({ error: error.message || 'שגיאת מערכת. נסה שוב.' }, { status: 500 });
  }
});