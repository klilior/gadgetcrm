import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ success: false, error: 'לא מחובר' }, { status: 401 });
        }

        const { geo_lat, geo_lng, device_token } = await req.json();
        
        const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                        req.headers.get('x-real-ip') || 
                        'unknown';

        // Validate device/IP (same as clock-in)
        const devices = await base44.asServiceRole.entities.AttendanceDevice.filter({ is_active: true });
        
        let validDevice = null;
        for (const device of devices) {
            if (device.ip_allowlist && device.ip_allowlist.includes('0.0.0.0/0')) {
                validDevice = device;
                break;
            }
            if (device.ip_allowlist && device.ip_allowlist.includes(clientIP)) {
                validDevice = device;
                break;
            }
            if (device_token && device.device_token === device_token) {
                validDevice = device;
                break;
            }
        }

        if (!validDevice) {
            return Response.json({ 
                success: false, 
                error: `עמדה לא מאושרת - כתובת IP שלך: ${clientIP}` 
            }, { status: 403 });
        }

        // Check if clocked in today
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const todayDate = israelTime.toISOString().split('T')[0];
        
        const todayEvents = await base44.asServiceRole.entities.AttendanceEvent.filter({
            user_id: user.id,
            event_time: { $gte: `${todayDate}T00:00:00`, $lt: `${todayDate}T23:59:59` }
        }, '-event_time');

        const lastEvent = todayEvents[0];
        if (!lastEvent || lastEvent.event_type !== 'in') {
            return Response.json({ 
                success: false, 
                error: 'לא נמצאה כניסה להיום. דווח כניסה לפני יציאה' 
            }, { status: 400 });
        }

        // Create clock-out event
        const event = await base44.asServiceRole.entities.AttendanceEvent.create({
            user_id: user.id,
            event_type: 'out',
            event_time: new Date().toISOString(),
            tz: 'Asia/Jerusalem',
            source: device_token ? 'kiosk' : 'browser',
            ip: clientIP,
            device_id: validDevice.id,
            geo_lat,
            geo_lng
        });

        // Trigger day computation
        await base44.asServiceRole.functions.invoke('computeDay', {
            user_id: user.id,
            date: todayDate
        });

        return Response.json({ 
            success: true, 
            event,
            message: `יציאה נרשמה בהצלחה ב-${israelTime.toLocaleTimeString('he-IL')}`
        });

    } catch (error) {
        console.error('Clock out error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});