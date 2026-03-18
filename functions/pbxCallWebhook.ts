import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

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

/**
 * Extract ALL possible phone numbers from all PBX fields.
 * Return the best external number (longest valid phone, not an extension).
 */
function extractExternalPhone(callData, isIncoming) {
    // Collect all candidate fields
    const candidates = [];
    
    // Standard fields
    const fields = [
        'caller_number', 'caller', 'from', 'phone_number', 'src',
        'callee_number', 'callee', 'called_number', 'to', 'dst', 'called', 'destination',
        'dialed_number', 'remote_number', 'external_number', 'number',
        'caller_id', 'caller_id_number', 'cid_num', 'connected_number'
    ];
    
    for (const field of fields) {
        if (callData[field]) candidates.push({ field, value: String(callData[field]) });
    }
    
    // Also scan all values in payload for anything that looks like a phone
    for (const [key, val] of Object.entries(callData)) {
        if (typeof val === 'string' || typeof val === 'number') {
            const strVal = String(val);
            const digits = strVal.replace(/[^\d]/g, '');
            if (digits.length >= 9 && digits.length <= 13 && !candidates.some(c => c.field === key)) {
                candidates.push({ field: key, value: strVal });
            }
        }
    }
    
    // Normalize all candidates and pick the best external phone
    const validPhones = [];
    for (const c of candidates) {
        const norm = normalizePhone(c.value);
        if (norm && norm.length === 10) {
            // Exclude internal extensions (typically 3-7 digits before normalization)
            const rawDigits = c.value.replace(/[^\d]/g, '');
            if (rawDigits.length >= 7) {
                validPhones.push({ field: c.field, normalized: norm, raw: c.value });
            }
        }
    }
    
    if (validPhones.length === 0) return null;
    
    // For incoming: prefer caller fields; for outgoing: prefer callee fields
    const incomingFields = ['caller_number', 'caller', 'from', 'phone_number', 'src', 'caller_id', 'caller_id_number', 'cid_num'];
    const outgoingFields = ['callee_number', 'callee', 'called_number', 'to', 'dst', 'called', 'destination', 'dialed_number', 'connected_number'];
    
    const priorityFields = isIncoming ? incomingFields : outgoingFields;
    const preferred = validPhones.find(p => priorityFields.includes(p.field));
    if (preferred) return preferred.normalized;
    
    // Fallback: return first valid phone that isn't from an extension field
    const extensionFields = ['extension_number', 'ext', 'extension'];
    const nonExt = validPhones.find(p => !extensionFields.includes(p.field));
    return nonExt ? nonExt.normalized : validPhones[0].normalized;
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
        const callId = callData.uuid || callData.callid || callData.call_id || callData.uniqueid || '';
        const uniqueToken = callData.unique_token || '';
        const extension = callData.extension_number || callData.ext || callData.extension || '';
        const direction = callData.call_direction || callData.direction || callData.type || 'incoming';
        const callStatus = (callData.call_status || callData.status || callData.event || 'Ring').toLowerCase();
        const duration = callData.call_duration || callData.duration || callData.billsec || '0';
        const recordingUrl = callData.recording_url || callData.recordingUrl || callData.recording || '';
        const hangupReason = callData.reason || '';
        const answerTime = callData.call_answer_time || '';

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';
        
        // Smart phone extraction - scans all fields for a valid external phone
        const normalizedPhone = extractExternalPhone(callData, isIncoming);
        
        console.log(`📞 [PBX] phone=${normalizedPhone} dir=${direction} status=${callStatus} callId=${callId} uniqueToken=${uniqueToken}`);

        // Determine the call event type
        const isRing = callStatus === 'ring' || callStatus === 'ringing' || callStatus === 'dial';
        const isAnswer = callStatus === 'answer' || callStatus === 'answered';
        const isHangup = callStatus === 'hangup' || callStatus === 'hangup_complete';
        const isMissed = isHangup && (hangupReason === 'NO_ANSWER' || hangupReason === 'ORIGINATOR_CANCEL' || answerTime === '0000-00-00 00:00:00');

        // Use unique_token OR callId to group events for the same call session
        const dedupeKey = uniqueToken || callId;

        // --- DEDUPLICATION: Try to find existing activity for this call ---
        // Search by thread_id (dedupeKey) OR by callId in content
        let existingActivity = null;
        if (dedupeKey) {
            const byThread = await sr.Activity.filter({ thread_id: dedupeKey }, '-created_date', 1).catch(() => []);
            if (byThread.length > 0) existingActivity = byThread[0];
        }
        // If not found by thread_id, try by callId in content
        if (!existingActivity && callId) {
            const recent = await sr.Activity.filter(
                { activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת' }, 
                '-created_date', 
                20
            ).catch(() => []);
            existingActivity = recent.find(a => (a.content || '').includes(callId));
        }

        // --- UPDATE EXISTING ACTIVITY ---
        if (existingActivity) {
            const updates = {};
            const oldContent = existingActivity.content || '';
            
            if (isHangup) {
                if (isMissed) {
                    updates.content = oldContent.replace(/סטטוס: [^|]+/, `סטטוס: לא נענתה | משך: ${duration} שניות`);
                    if (!(existingActivity.summary || '').includes('לא נענתה')) {
                        updates.summary = (existingActivity.summary || '') + ' ❌ לא נענתה';
                    }
                } else {
                    updates.content = oldContent.replace(/סטטוס: [^|]+/, `סטטוס: הסתיימה | משך: ${duration} שניות`);
                }
            }
            
            if (recordingUrl && !existingActivity.recording_url) {
                updates.recording_url = recordingUrl;
            }
            
            // If existing has no phone but we now have one, update content and summary
            if (normalizedPhone && oldContent.includes('מספר לא זוהה')) {
                // Try to find customer for this phone
                let customer = null;
                const phoneVariants = phoneSearchVariants(normalizedPhone);
                for (const variant of phoneVariants) {
                    const results = await sr.Client.filter({ phone: variant }, null, 1).catch(() => []);
                    if (results.length > 0) { customer = results[0]; break; }
                }
                
                updates.content = oldContent
                    .replace(/מספר: [^|]+/, `מספר: ${normalizedPhone}`)
                    .replace(/מספר לא זוהה/g, customer ? `${customer.full_name} (${normalizedPhone})` : normalizedPhone);
                updates.summary = customer 
                    ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}`
                    : `שיחה - ${normalizedPhone}`;
            }
            
            if (Object.keys(updates).length > 0) {
                await sr.Activity.update(existingActivity.id, updates);
                console.log(`📞 [PBX] Updated activity ${existingActivity.id} (status=${callStatus})`);
            } else {
                console.log(`📞 [PBX] No updates needed for ${existingActivity.id}`);
            }
            
            return Response.json({ success: true, event: callStatus, updated: existingActivity.id });
        }

        // --- ANSWER without existing record: skip ---
        if (isAnswer) {
            console.log(`📞 [PBX] Answer event, no existing record, skipping`);
            return Response.json({ success: true, event: 'answer', skipped: true });
        }

        // --- CREATE NEW ACTIVITY (Ring/Dial or Hangup without existing) ---
        if (!normalizedPhone) {
            console.log('📞 [PBX] No valid phone, storing raw');
            await sr.Activity.create({
                activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                summary: `שיחה ${isIncoming ? 'נכנסת' : 'יוצאת'} - מספר לא זוהה`,
                content: `מספר: לא ידוע | שלוחה: ${extension} | סטטוס: ${callStatus} | callId: ${callId}`,
                thread_id: dedupeKey || callId || undefined,
            });
            return Response.json({ success: true, matched: false });
        }

        // Search for customer
        const phoneVariants = phoneSearchVariants(normalizedPhone);
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

        const statusText = isMissed ? 'לא נענתה' : (isHangup ? `הסתיימה | משך: ${duration} שניות` : 'מצלצל');

        const activity = await sr.Activity.create({
            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
            summary: customer ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}` : `שיחה - ${normalizedPhone}`,
            content: `${isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת'} ${customer ? `מ-${customer.full_name} (${normalizedPhone})` : `- ${normalizedPhone}`} | שלוחה: ${extension} | סטטוס: ${statusText} | ${contextSummary} | callId: ${callId}`,
            thread_id: dedupeKey || callId || undefined,
            recording_url: recordingUrl || undefined,
            ticket_id: openTickets.length > 0 ? openTickets[0].id : undefined,
            order_id: customer?.id || undefined,
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