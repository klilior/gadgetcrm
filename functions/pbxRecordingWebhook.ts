import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.startsWith('+972')) cleaned = '0' + cleaned.slice(4);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
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

        let recordData = {};
        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            recordData = await req.json();
        } else if (contentType.includes('form')) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) {
                recordData[key] = value;
            }
        } else {
            const url = new URL(req.url);
            for (const [key, value] of url.searchParams.entries()) {
                recordData[key] = value;
            }
        }

        console.log('🎙️ [Recording Webhook] Received:', JSON.stringify(recordData));

        const callId = recordData.callid || recordData.call_id || recordData.uniqueid || '';
        const callerNumber = recordData.caller || recordData.from || recordData.src || '';
        const calleeNumber = recordData.callee || recordData.to || recordData.dst || '';
        const duration = recordData.duration || recordData.billsec || '0';
        const recordingUrl = recordData.recording_url || recordData.recordingUrl || recordData.recording || recordData.file_url || '';
        const direction = recordData.direction || recordData.type || 'incoming';
        const extension = recordData.ext || recordData.extension || '';

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';
        const externalNumber = isIncoming ? callerNumber : calleeNumber;
        const normalizedPhone = normalizePhone(externalNumber);

        // Find matching Activity by callId in content, or by phone + recent time
        let matchedActivity = null;
        const recentActivities = await sr.Activity.filter({
            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
        }, '-created_date', 50);

        // Try match by callId first
        if (callId) {
            matchedActivity = recentActivities.find(a => a.content?.includes(callId));
        }
        // Fallback: match by phone in last 24h without recording
        if (!matchedActivity && normalizedPhone) {
            matchedActivity = recentActivities.find(a =>
                a.content?.includes(normalizedPhone) && !a.recording_url
            );
        }

        // Find customer
        let customer = null;
        if (normalizedPhone) {
            const results = await sr.Client.filter({ phone: normalizedPhone }, null, 1);
            if (results.length > 0) customer = results[0];
        }

        if (matchedActivity) {
            await sr.Activity.update(matchedActivity.id, {
                recording_url: recordingUrl || undefined,
                content: matchedActivity.content + ` | משך: ${duration} שניות | הקלטה: ${recordingUrl ? '✅' : '❌'}`
            });
            console.log(`✅ [Recording] Updated activity ${matchedActivity.id} with recording`);
        } else {
            const activity = await sr.Activity.create({
                activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                summary: customer ? `הקלטת שיחה - ${customer.full_name}` : `הקלטת שיחה - ${normalizedPhone || 'לא ידוע'}`,
                content: `מספר: ${normalizedPhone || externalNumber} | שלוחה: ${extension} | משך: ${duration} שניות | callId: ${callId}`,
                recording_url: recordingUrl || undefined,
            });
            console.log(`✅ [Recording] Created new activity ${activity.id}`);
        }

        return Response.json({
            success: true,
            activity_updated: !!matchedActivity,
            customer_matched: !!customer,
            recording_url: recordingUrl
        }, { headers: { 'Access-Control-Allow-Origin': '*' } });

    } catch (error) {
        console.error('❌ [Recording Webhook] Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});