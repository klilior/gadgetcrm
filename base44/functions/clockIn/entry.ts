import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ success: false, error: 'לא מחובר' }, { status: 401 });
        }

        const { geo_lat, geo_lng, device_token } = await req.json();
        
        // Get client IP
        const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                        req.headers.get('x-real-ip') || 
                        'unknown';

        // Validate device/IP
        const devices = await base44.asServiceRole.entities.AttendanceDevice.filter({ is_active: true });
        
        // If no devices exist, create a default one
        if (devices.length === 0) {
            console.log('No devices found, creating default device...');
            await base44.asServiceRole.entities.AttendanceDevice.create({
                name: 'מכשיר ראשי - ברירת מחדל',
                type: 'browser',
                is_active: true,
                ip_allowlist: ['0.0.0.0/0'], // Allow all IPs initially
                notes: 'מכשיר ברירת מחדל - נוצר אוטומטית. מומלץ להגדיר IP ספציפיים בהגדרות.'
            });
            
            // Fetch devices again
            const newDevices = await base44.asServiceRole.entities.AttendanceDevice.filter({ is_active: true });
            
            if (newDevices.length === 0) {
                return Response.json({ 
                    success: false, 
                    error: 'לא ניתן ליצור מכשיר ברירת מחדל. אנא פנה למנהל המערכת.' 
                }, { status: 500 });
            }
        }

        // Refresh devices list
        const activeDevices = await base44.asServiceRole.entities.AttendanceDevice.filter({ is_active: true });
        
        let validDevice = null;
        for (const device of activeDevices) {
            // Check if IP allowlist contains 0.0.0.0/0 (allow all)
            if (device.ip_allowlist && device.ip_allowlist.includes('0.0.0.0/0')) {
                validDevice = device;
                break;
            }
            
            // Check IP allowlist
            if (device.ip_allowlist && device.ip_allowlist.includes(clientIP)) {
                validDevice = device;
                break;
            }
            
            // Check device token
            if (device_token && device.device_token === device_token) {
                validDevice = device;
                break;
            }
        }

        if (!validDevice) {
            return Response.json({ 
                success: false, 
                error: `עמדה לא מאושרת - כתובת IP שלך: ${clientIP}. אנא פנה למנהל להוספת העמדה.` 
            }, { status: 403 });
        }

        // Validate geofence if required
        if (validDevice.geo_center_lat && validDevice.geo_center_lng && validDevice.geo_radius_m) {
            if (!geo_lat || !geo_lng) {
                return Response.json({ 
                    success: false, 
                    error: 'נדרש מיקום גיאוגרפי לדיווח ממכשיר זה' 
                }, { status: 400 });
            }

            // Calculate distance using Haversine formula
            const R = 6371e3; // Earth radius in meters
            const φ1 = validDevice.geo_center_lat * Math.PI / 180;
            const φ2 = geo_lat * Math.PI / 180;
            const Δφ = (geo_lat - validDevice.geo_center_lat) * Math.PI / 180;
            const Δλ = (geo_lng - validDevice.geo_center_lng) * Math.PI / 180;

            const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                     Math.cos(φ1) * Math.cos(φ2) *
                     Math.sin(Δλ/2) * Math.sin(Δλ/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;

            if (distance > validDevice.geo_radius_m) {
                return Response.json({ 
                    success: false, 
                    error: `מרחק גדול מדי מהמיקום המאושר (${Math.round(distance)}מ')` 
                }, { status: 403 });
            }
        }

        // Check if already clocked in today
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const todayDate = israelTime.toISOString().split('T')[0];
        
        const todayEvents = await base44.asServiceRole.entities.AttendanceEvent.filter({
            user_id: user.id,
            event_time: { $gte: `${todayDate}T00:00:00`, $lt: `${todayDate}T23:59:59` }
        }, '-event_time');

        const lastEvent = todayEvents[0];
        if (lastEvent && lastEvent.event_type === 'in') {
            return Response.json({ 
                success: false, 
                error: 'כבר דיווחת על כניסה. דווח יציאה לפני כניסה נוספת' 
            }, { status: 400 });
        }

        // Create clock-in event
        const event = await base44.asServiceRole.entities.AttendanceEvent.create({
            user_id: user.id,
            event_type: 'in',
            event_time: new Date().toISOString(),
            tz: 'Asia/Jerusalem',
            source: device_token ? 'kiosk' : 'browser',
            ip: clientIP,
            device_id: validDevice.id,
            geo_lat,
            geo_lng
        });

        return Response.json({ 
            success: true, 
            event,
            message: `כניסה נרשמה בהצלחה ב-${israelTime.toLocaleTimeString('he-IL')}`
        });

    } catch (error) {
        console.error('Clock in error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});