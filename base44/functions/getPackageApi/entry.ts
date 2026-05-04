import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Helper: get active settings
async function getSettings(sr) {
  const all = await sr.entities.GetPackageSettings.list('-created_date', 1);
  if (!all || all.length === 0) return null;
  return all[0];
}

// Helper: get API base URL
function getApiBase(settings) {
  return settings.environment === 'production'
    ? (settings.production_api_base_url || 'https://apiv2.getpackage.com')
    : (settings.sandbox_api_base_url || 'https://sandbox-apiv2.getpackage.com');
}

// Helper: make API request
async function gpFetch(settings, method, path, body) {
  const base = getApiBase(settings);
  const url = `${base}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': settings.api_token,
  };
  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data };
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
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  
  const sr = base44.asServiceRole;
  const action = body.action;
  
  try {
    // ===== GET SETTINGS =====
    if (action === 'getSettings') {
      const settings = await getSettings(sr);
      if (!settings) return Response.json({ success: true, settings: null });
      // Mask token
      const masked = { ...settings };
      masked.api_token_set = !!(settings.api_token && settings.api_token.length > 0);
      delete masked.api_token;
      return Response.json({ success: true, settings: masked });
    }

    // ===== SAVE SETTINGS =====
    if (action === 'saveSettings') {
      const appRole = user.app_role || user.role;
      if (appRole !== 'מנהל' && user.role !== 'admin') {
        return Response.json({ error: 'אין הרשאה לערוך הגדרות' }, { status: 403 });
      }
      const data = body.data || {};
      const existing = await getSettings(sr);
      if (existing) {
        // Only update api_token if explicitly provided
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
      // Try quota endpoint as connection test
      const result = await gpFetch(settings, 'GET', '/v1/deliveries/quota', null);
      if (result.ok) {
        return Response.json({ success: true, message: 'החיבור ל-GetPackage תקין.', quota: result.data });
      } else {
        return Response.json({ success: false, error: 'החיבור ל-GetPackage נכשל. יש לבדוק את ה-API Token ואת כתובת ה-API.' });
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

      // Build quote request per GetPackage Express API
      const quoteBody = {
        pickUpPoint: {
          address: {
            city: settings.default_pickup_city || '',
            street: settings.default_pickup_address || '',
            country: 'IL',
          },
          contactName: settings.default_pickup_name || settings.business_name || 'GADGET-TEAM',
          contactPhoneNumber: settings.default_pickup_phone || '',
          instructions: settings.default_pickup_notes || '',
        },
        dropOffPoint: {
          address: {
            city: dropoffCity,
            street: dropoffAddress,
            country: 'IL',
          },
          contactName: dropoffName || '',
          contactPhoneNumber: dropoffPhone,
          instructions: body.dropoff_notes || '',
        },
        package: {
          size: body.package_size || 'SMALL',
        },
      };

      console.log(`[GetPackage] Creating quote for order ${orderId}`);
      const result = await gpFetch(settings, 'POST', '/v1/deliveries/express/quote', quoteBody);

      // Create or update shipment record
      const shipmentData = {
        order_id: orderId,
        woo_order_id: body.woo_order_id || '',
        customer_name: body.customer_name || '',
        customer_phone: dropoffPhone,
        customer_email: body.customer_email || '',
        pickup_name: quoteBody.pickUpPoint.contactName,
        pickup_phone: settings.default_pickup_phone || '',
        pickup_address: settings.default_pickup_address || '',
        pickup_city: settings.default_pickup_city || '',
        pickup_notes: settings.default_pickup_notes || '',
        dropoff_name: dropoffName || '',
        dropoff_phone: dropoffPhone,
        dropoff_address: dropoffAddress,
        dropoff_city: dropoffCity,
        dropoff_notes: body.dropoff_notes || '',
        package_description: body.package_description || '',
        package_quantity: body.package_quantity || 1,
        package_size: body.package_size || 'SMALL',
        raw_quote_response: result.data,
      };

      if (result.ok && result.data) {
        // Extract quote details from response
        const quoteId = result.data.id || result.data.quoteId || result.data.deliveryId || '';
        const price = result.data.price?.amount || result.data.totalPrice?.amount || result.data.price || null;
        const currency = result.data.price?.currency || result.data.totalPrice?.currency || 'ILS';
        const trackingUrl = result.data.trackingUrl || result.data.tracking_url || '';

        shipmentData.quote_id = String(quoteId);
        shipmentData.quote_price = typeof price === 'number' ? price : parseFloat(price) || 0;
        shipmentData.quote_currency = currency;
        shipmentData.tracking_url = trackingUrl;
        shipmentData.status = 'quote_received';
        shipmentData.last_error = '';

        const created = await sr.entities.GetPackageShipment.create(shipmentData);
        console.log(`[GetPackage] Quote received: ${quoteId}, price: ${price} ${currency}`);
        return Response.json({ success: true, shipment: created, quote: result.data });
      } else {
        shipmentData.status = 'quote_failed';
        shipmentData.last_error = result.data?.message || result.data?.error || `שגיאה ${result.status}`;
        const created = await sr.entities.GetPackageShipment.create(shipmentData);
        console.error(`[GetPackage] Quote failed:`, JSON.stringify(result.data));
        return Response.json({
          success: false,
          error: 'לא ניתן לקבל הצעת מחיר מ-GetPackage. יש לבדוק את פרטי החיבור.',
          details: shipmentData.last_error,
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

      const shipments = await sr.entities.GetPackageShipment.filter({ id: shipmentId });
      const shipment = shipments?.[0];
      if (!shipment) return Response.json({ error: 'משלוח לא נמצא' }, { status: 404 });
      if (shipment.status !== 'quote_received') {
        return Response.json({ error: 'ניתן לאשר רק משלוח שקיבל הצעת מחיר' }, { status: 400 });
      }
      if (!shipment.quote_id) return Response.json({ error: 'חסר מזהה הצעת מחיר' }, { status: 400 });

      console.log(`[GetPackage] Accepting quote ${shipment.quote_id} for shipment ${shipmentId}`);
      const result = await gpFetch(settings, 'PUT', '/v1/deliveries/express/quote/accept', {
        id: shipment.quote_id,
      });

      if (result.ok && result.data) {
        const deliveryId = result.data.deliveryId || result.data.id || shipment.quote_id;
        const routeId = result.data.routeId || result.data.route_id || '';
        const trackingUrl = result.data.trackingUrl || result.data.tracking_url || shipment.tracking_url || '';

        await sr.entities.GetPackageShipment.update(shipmentId, {
          delivery_id: String(deliveryId),
          route_id: String(routeId),
          tracking_url: trackingUrl,
          status: 'accepted',
          raw_accept_response: result.data,
          last_error: '',
        });

        console.log(`[GetPackage] Quote accepted: delivery=${deliveryId}, route=${routeId}`);
        return Response.json({
          success: true,
          delivery_id: deliveryId,
          route_id: routeId,
          tracking_url: trackingUrl,
        });
      } else {
        const errMsg = result.data?.message || result.data?.error || `שגיאה ${result.status}`;
        await sr.entities.GetPackageShipment.update(shipmentId, {
          last_error: errMsg,
          raw_accept_response: result.data,
        });
        console.error(`[GetPackage] Accept failed:`, JSON.stringify(result.data));
        return Response.json({
          success: false,
          error: 'לא ניתן לאשר את המשלוח. נסה שוב או פנה לתמיכה.',
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

      const shipments = await sr.entities.GetPackageShipment.filter({ id: shipmentId });
      const shipment = shipments?.[0];
      if (!shipment) return Response.json({ error: 'משלוח לא נמצא' }, { status: 404 });

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
        const errMsg = result.data?.message || `שגיאה ${result.status}`;
        await sr.entities.GetPackageShipment.update(shipmentId, { last_error: errMsg });
        return Response.json({ success: false, error: 'לא ניתן לרענן סטטוס', details: errMsg });
      }
    }

    // ===== CANCEL SHIPMENT =====
    if (action === 'cancelShipment') {
      const settings = await getSettings(sr);
      if (!settings?.api_token) return Response.json({ error: 'חסר Token' }, { status: 400 });

      // Permission check: manager or shift manager only
      const appRole = user.app_role || user.role;
      if (appRole !== 'מנהל' && appRole !== 'מנהל משמרת' && user.role !== 'admin') {
        return Response.json({ error: 'רק מנהל יכול לבטל משלוח' }, { status: 403 });
      }

      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      const shipments = await sr.entities.GetPackageShipment.filter({ id: shipmentId });
      const shipment = shipments?.[0];
      if (!shipment) return Response.json({ error: 'משלוח לא נמצא' }, { status: 404 });

      const deliveryId = shipment.delivery_id || shipment.quote_id;
      if (!deliveryId) {
        // No delivery created yet, just mark as cancelled
        await sr.entities.GetPackageShipment.update(shipmentId, { status: 'cancelled', last_error: '' });
        return Response.json({ success: true, message: 'המשלוח בוטל (טרם נוצר ב-GetPackage)' });
      }

      console.log(`[GetPackage] Cancelling delivery ${deliveryId}`);
      const result = await gpFetch(settings, 'DELETE', `/v1/deliveries/express/${deliveryId}/routes`, null);

      if (result.ok || result.status === 404) {
        await sr.entities.GetPackageShipment.update(shipmentId, {
          status: 'cancelled',
          last_error: '',
        });
        return Response.json({ success: true, message: 'משלוח GetPackage בוטל.' });
      } else {
        const errMsg = result.data?.message || `שגיאה ${result.status}`;
        await sr.entities.GetPackageShipment.update(shipmentId, { last_error: errMsg });
        return Response.json({ success: false, error: 'לא ניתן לבטל את המשלוח', details: errMsg });
      }
    }

    // ===== SEND TRACKING SMS =====
    if (action === 'sendTrackingSms') {
      const shipmentId = body.shipment_id;
      if (!shipmentId) return Response.json({ error: 'חסר מזהה משלוח' }, { status: 400 });

      const shipments = await sr.entities.GetPackageShipment.filter({ id: shipmentId });
      const shipment = shipments?.[0];
      if (!shipment) return Response.json({ error: 'משלוח לא נמצא' }, { status: 404 });
      if (!shipment.tracking_url) return Response.json({ error: 'אין קישור מעקב זמין למשלוח זה' }, { status: 400 });
      if (!shipment.customer_phone) return Response.json({ error: 'חסר טלפון לקוח' }, { status: 400 });

      const firstName = (shipment.customer_name || '').split(' ')[0] || 'לקוח';
      const smsBody = `שלום ${firstName}, ההזמנה שלך מ-GADGET-TEAM יצאה למשלוח עם GetPackage.\n\nלמעקב אחר המשלוח:\n${shipment.tracking_url}\n\nתודה,\nצוות GADGET-TEAM`;

      // Use existing SMS function
      const smsResult = await sr.functions.invoke('sendTextMeSMS', {
        to: shipment.customer_phone,
        message: smsBody,
      });

      return Response.json({ success: true, message: 'SMS עם קישור מעקב נשלח ללקוח' });
    }

    // ===== BULK REFRESH (for automation) =====
    if (action === 'bulkRefreshStatuses') {
      const settings = await getSettings(sr);
      if (!settings?.api_token) return Response.json({ error: 'חסר Token' }, { status: 400 });

      // Only get open shipments from last 72 hours
      const openStatuses = ['accepted', 'pickup_pending', 'picked_up', 'in_transit'];
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

      let allOpen = [];
      for (const status of openStatuses) {
        const batch = await sr.entities.GetPackageShipment.filter({ status }, '-created_date', 50);
        allOpen.push(...batch);
      }
      // Filter to recent only
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
    return Response.json({ error: 'שגיאת מערכת. נסה שוב.' }, { status: 500 });
  }
});