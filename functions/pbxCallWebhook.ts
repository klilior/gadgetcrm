import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
    else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('0972') && digits.length > 12) digits = '0' + digits.slice(4);
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
    return [normalized, '972' + normalized.slice(1), '+972' + normalized.slice(1), '9720' + normalized.slice(1), '+9720' + normalized.slice(1)];
}

Deno.serve(async (req) => {
    try {
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
            });
        }

        const base44 = createClientFromRequest(req);
        const sr = base44.asServiceRole.entities;

        // Parse incoming data
        let callData = {};
        const contentType = req.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            callData = await req.json();
        } else if (contentType.includes('form')) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) callData[key] = value;
        } else {
            const url = new URL(req.url);
            for (const [key, value] of url.searchParams.entries()) callData[key] = value;
            if (Object.keys(callData).length === 0) {
                try { callData = await req.json(); } catch (_e) {
                    const text = await req.text();
                    const params = new URLSearchParams(text);
                    for (const [key, value] of params.entries()) callData[key] = value;
                }
            }
        }

        console.log('📞 [PBX Webhook] Received:', JSON.stringify(callData));

        // Extract fields from PBX payload
        const callerNumber = callData.caller_number || callData.caller || callData.from || callData.phone_number || callData.src || '';
        const calleeNumber = callData.callee_number || callData.callee || callData.called_number || callData.to || callData.dst || callData.called || callData.destination || '';
        const callId = callData.uuid || callData.callid || callData.call_id || callData.uniqueid || '';
        const uniqueToken = callData.unique_token || '';
        const extension = callData.extension_number || callData.ext || callData.extension || '';
        const direction = callData.call_direction || callData.direction || callData.type || 'incoming';
        const callStatus = (callData.call_status || callData.status || callData.event || 'Ring').toLowerCase();

        console.log(`📞 [PBX] caller=${callerNumber} callee=${calleeNumber} dir=${direction} status=${callStatus}`);
        const duration = callData.call_duration || callData.duration || callData.billsec || '0';
        const recordingUrl = callData.recording_url || callData.recordingUrl || callData.recording || '';
        const hangupReason = callData.reason || '';
        const answerTime = callData.call_answer_time || '';

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';
        // For outgoing calls: the external number is calleeNumber. For incoming: callerNumber.
        // If calleeNumber looks like an internal extension (3-4 digits), try callerNumber instead.
        let externalNumber;
        if (isIncoming) {
            externalNumber = callerNumber;
        } else {
            // For outgoing, prefer callee but fall back to caller if callee is empty or looks internal
            const calleeClean = calleeNumber.replace(/[^\d]/g, '');
            if (calleeClean && calleeClean.length >= 7) {
                externalNumber = calleeNumber;
            } else if (callerNumber.replace(/[^\d]/g, '').length >= 7) {
                // Sometimes for outgoing the "caller" field has the dialed number
                externalNumber = callerNumber;
            } else {
                externalNumber = calleeNumber || callerNumber;
            }
        }
        const normalizedPhone = normalizePhone(externalNumber);
        console.log(`📞 [PBX] External number resolved: ${externalNumber} -> ${normalizedPhone}`);

        // Determine the call event type
        const isRing = callStatus === 'ring' || callStatus === 'ringing' || callStatus === 'dial';
        const isAnswer = callStatus === 'answer' || callStatus === 'answered';
        const isHangup = callStatus === 'hangup' || callStatus === 'hangup_complete';
        const isMissed = isHangup && (hangupReason === 'NO_ANSWER' || hangupReason === 'ORIGINATOR_CANCEL' || answerTime === '0000-00-00 00:00:00');

        // Use unique_token to group events for the same call session
        const dedupeKey = uniqueToken || callId;

        // Only create activity on Ring (new call) — update on Hangup for duration/recording/missed
        if (isAnswer) {
            // Answer events: just acknowledge, don't create duplicate
            console.log(`📞 [PBX] Answer event for ${dedupeKey}, skipping`);
            return Response.json({ success: true, event: 'answer', skipped: true });
        }

        if (isHangup && dedupeKey) {
            // On Hangup: try to find existing activity for this call and update it
            try {
                const existing = await sr.Activity.filter({ thread_id: dedupeKey }, '-created_date', 1);
                if (existing.length > 0) {
                    const updates = {};
                    if (isMissed) {
                        updates.activity_type = isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת';
                        const oldContent = existing[0].content || '';
                        updates.content = oldContent.replace(/סטטוס: [^|]+/, `סטטוס: ${isMissed ? 'לא נענתה' : 'הסתיימה'} | משך: ${duration} שניות`);
                        if (isMissed) {
                            updates.summary = (existing[0].summary || '') + ' ❌ לא נענתה';
                        }
                    } else {
                        const oldContent = existing[0].content || '';
                        updates.content = oldContent.replace(/סטטוס: [^|]+/, `סטטוס: הסתיימה | משך: ${duration} שניות`);
                    }
                    if (recordingUrl) updates.recording_url = recordingUrl;
                    await sr.Activity.update(existing[0].id, updates);
                    console.log(`📞 [PBX] Updated activity ${existing[0].id} on hangup (missed: ${isMissed}, duration: ${duration}s)`);
                    return Response.json({ success: true, event: 'hangup', updated: existing[0].id, missed: isMissed });
                }
            } catch (_e) {
                console.log('📞 [PBX] Could not find existing activity for hangup update');
            }
        }

        // Only create new activity for Ring events (or if no existing found for hangup)
        if (!normalizedPhone) {
            console.log('📞 [PBX] No valid phone, storing raw');
            await sr.Activity.create({
                activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                summary: `שיחה ${isIncoming ? 'נכנסת' : 'יוצאת'} - מספר לא זוהה`,
                content: `מספר: ${externalNumber || 'לא ידוע'} | שלוחה: ${extension} | סטטוס: ${callStatus} | callId: ${callId}`,
                thread_id: dedupeKey || undefined,
            });
            return Response.json({ success: true, matched: false });
        }

        // Search for customer
        const phoneVariants = phoneSearchVariants(externalNumber);
        let customer = null;
        for (const variant of phoneVariants) {
            const results = await sr.Client.filter({ phone: variant }, null, 1);
            if (results.length > 0) { customer = results[0]; break; }
        }

        let openTickets = [], openRepairs = [];
        if (customer) {
            console.log(`✅ [PBX] Customer: ${customer.full_name}`);
            const [tickets, repairs] = await Promise.all([
                sr.Ticket.filter({ customer_id: customer.id }, '-created_date', 5).catch(() => []),
                sr.Repair.filter({ client_id: customer.id }, '-created_date', 5).catch(() => []),
            ]);
            openTickets = tickets.filter(t => !['סגור', 'בוטל', 'closed', 'cancelled'].includes(t.status));
            openRepairs = repairs.filter(r => !['הושלם', 'בוטל', 'נמסר', 'completed', 'cancelled', 'תיקון נסגר', 'לא ניתן לתיקון'].includes(r.status));
        }

        const contextParts = [];
        if (openTickets.length > 0) contextParts.push(`🔴 ${openTickets.length} טיקטים פתוחים`);
        if (openRepairs.length > 0) contextParts.push(`🔧 ${openRepairs.length} תיקונים בתהליך`);
        if (customer?.customer_score >= 80) contextParts.push(`⭐ VIP`);
        const contextSummary = contextParts.join(' | ') || 'אין פעילות פתוחה';

        const activity = await sr.Activity.create({
            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
            summary: customer ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}` : `שיחה - ${normalizedPhone}`,
            content: `${isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת'} ${customer ? `מ-${customer.full_name} (${normalizedPhone})` : `- ${normalizedPhone}`} | שלוחה: ${extension} | סטטוס: מצלצל | ${contextSummary} | callId: ${callId}`,
            thread_id: dedupeKey || undefined,
            recording_url: recordingUrl || undefined,
            ticket_id: openTickets.length > 0 ? openTickets[0].id : undefined,
        });

        console.log(`✅ [PBX] Activity created: ${activity.id}`);

        return Response.json({
            success: true,
            matched: !!customer,
            call_id: callId,
            activity_id: activity.id,
            direction: isIncoming ? 'incoming' : 'outgoing',
            phone: normalizedPhone,
            extension,
            customer: customer ? {
                id: customer.id, name: customer.full_name, phone: customer.phone,
                email: customer.email, score: customer.customer_score, tier: customer.customer_tier, city: customer.city,
            } : null,
            context: {
                open_tickets: openTickets.map(t => ({ id: t.id, subject: t.subject || t.title, status: t.status })),
                open_repairs: openRepairs.map(r => ({ id: r.id, device: r.device_name || r.description, status: r.status })),
                summary: contextSummary
            },
            timestamp: new Date().toISOString()
        }, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error('❌ [PBX Webhook] Error:', error.message, error.stack);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});