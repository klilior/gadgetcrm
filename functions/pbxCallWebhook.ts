import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) {
        digits = digits.slice(3);
    } else if (digits.length === 12 && digits.startsWith('972')) {
        digits = '0' + digits.slice(3);
    } else if (digits.startsWith('0972') && digits.length > 12) {
        digits = '0' + digits.slice(4);
    }
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    if (digits.length >= 9 && digits.length <= 11) {
        if (!digits.startsWith('0')) digits = '0' + digits;
        return digits.slice(0, 10);
    }
    return null;
}

function phoneSearchVariants(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const variants = new Set();
    variants.add(normalized);
    variants.add('972' + normalized.slice(1));
    variants.add('+972' + normalized.slice(1));
    variants.add('9720' + normalized.slice(1));
    variants.add('+9720' + normalized.slice(1));
    return [...variants];
}

Deno.serve(async (req) => {
    try {
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;

        // Parse incoming data - PBX can send as JSON or form data
        let callData = {};
        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            callData = await req.json();
        } else if (contentType.includes('form')) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) {
                callData[key] = value;
            }
        } else {
            const url = new URL(req.url);
            for (const [key, value] of url.searchParams.entries()) {
                callData[key] = value;
            }
            if (Object.keys(callData).length === 0) {
                try {
                    callData = await req.json();
                } catch (_e) {
                    const text = await req.text();
                    console.log('📞 [PBX] Raw body:', text);
                    const params = new URLSearchParams(text);
                    for (const [key, value] of params.entries()) {
                        callData[key] = value;
                    }
                }
            }
        }

        console.log('📞 [PBX Webhook] Received call data:', JSON.stringify(callData));

        const callerNumber = callData.caller || callData.from || callData.phone_number || callData.callerNumber || callData.src || '';
        const calleeNumber = callData.callee || callData.to || callData.dst || callData.called || '';
        const callId = callData.callid || callData.call_id || callData.uniqueid || '';
        const extension = callData.ext || callData.extension || callData.extension_number || '';
        const direction = callData.direction || callData.type || 'incoming';
        const callStatus = callData.status || callData.event || 'ringing';
        const duration = callData.duration || callData.billsec || '0';
        const recordingUrl = callData.recording_url || callData.recordingUrl || callData.recording || '';

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';
        const externalNumber = isIncoming ? callerNumber : calleeNumber;
        const normalizedPhone = normalizePhone(externalNumber);

        if (!normalizedPhone) {
            console.log('📞 [PBX] No valid phone number found, storing raw data');
            await sr.Activity.create({
                activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                summary: `שיחה ${isIncoming ? 'נכנסת' : 'יוצאת'} - מספר לא זוהה`,
                content: `מספר: ${externalNumber || 'לא ידוע'} | שלוחה: ${extension} | סטטוס: ${callStatus} | callId: ${callId}`,
                recording_url: recordingUrl || undefined,
            });
            return Response.json({ success: true, matched: false, message: 'Call logged, no valid phone number' });
        }

        // Search for customer by phone
        const phoneVariants = phoneSearchVariants(externalNumber);
        let customer = null;

        for (const variant of phoneVariants) {
            const results = await sr.Client.filter({ phone: variant }, null, 1);
            if (results.length > 0) {
                customer = results[0];
                break;
            }
        }

        let openTickets = [];
        let openRepairs = [];
        let recentOrders = [];

        if (customer) {
            console.log(`✅ [PBX] Customer found: ${customer.full_name} (ID: ${customer.id})`);

            const [ticketsResult, repairsResult, ordersResult] = await Promise.all([
                sr.Ticket.filter({ customer_id: customer.id }, '-created_date', 5).catch(() => []),
                sr.Repair.filter({ client_id: customer.id }, '-created_date', 5).catch(() => []),
                sr.Order.filter({ client_id: customer.id }, '-order_date', 5).catch(() => []),
            ]);

            openTickets = ticketsResult.filter(t => !['סגור', 'בוטל', 'closed', 'cancelled'].includes(t.status));
            openRepairs = repairsResult.filter(r => !['הושלם', 'בוטל', 'נמסר', 'completed', 'cancelled', 'תיקון נסגר', 'לא ניתן לתיקון'].includes(r.status));
            recentOrders = ordersResult;
        }

        // Build context summary
        const contextParts = [];
        if (openTickets.length > 0) contextParts.push(`🔴 ${openTickets.length} טיקטים פתוחים`);
        if (openRepairs.length > 0) contextParts.push(`🔧 ${openRepairs.length} תיקונים בתהליך`);
        if (customer?.customer_score && customer.customer_score >= 80) contextParts.push(`⭐ VIP`);
        const contextSummary = contextParts.join(' | ') || 'אין פעילות פתוחה';

        const activityContent = customer
            ? `${isIncoming ? 'שיחה נכנסת מ' : 'שיחה יוצאת ל'}-${customer.full_name} (${normalizedPhone}) | שלוחה: ${extension} | ${contextSummary} | callId: ${callId}`
            : `${isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת'} - ${normalizedPhone} | שלוחה: ${extension} | לקוח לא מזוהה | callId: ${callId}`;

        const activity = await sr.Activity.create({
            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
            summary: customer ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}` : `שיחה - ${normalizedPhone}`,
            content: activityContent,
            recording_url: recordingUrl || undefined,
            ticket_id: openTickets.length > 0 ? openTickets[0].id : undefined,
        });

        console.log(`✅ [PBX] Activity created: ${activity.id}`);

        const popupData = {
            success: true,
            matched: !!customer,
            call_id: callId,
            activity_id: activity.id,
            direction: isIncoming ? 'incoming' : 'outgoing',
            phone: normalizedPhone,
            extension,
            customer: customer ? {
                id: customer.id,
                name: customer.full_name,
                phone: customer.phone,
                email: customer.email,
                score: customer.customer_score,
                tier: customer.customer_tier,
                city: customer.city,
            } : null,
            context: {
                open_tickets: openTickets.map(t => ({ id: t.id, subject: t.subject || t.title, status: t.status })),
                open_repairs: openRepairs.map(r => ({ id: r.id, device: r.device_name || r.description, status: r.status })),
                recent_orders: recentOrders.map(o => ({ id: o.id, status: o.status, total: o.total, date: o.order_date })),
                summary: contextSummary
            },
            timestamp: new Date().toISOString()
        };

        return Response.json(popupData, {
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ [PBX Webhook] Error:', error.message, error.stack);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});