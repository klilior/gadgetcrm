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
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;

        // Load PBX settings
        const settingsList = await sr.Settings.list();
        const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
        const PBX_API_URL = getSetting('PBX_API_URL') || 'https://master.ippbx.co.il/ippbx_api/v1.4/api';
        const PBX_TOKEN_ID = getSetting('PBX_TOKEN_ID') || '7AaJmwvruPun2z2H';

        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        console.log(`📞 [PBX Sync] Fetching call log for ${dateStr}`);

        const callLogResponse = await fetch(`${PBX_API_URL}/info/callLog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token_id: PBX_TOKEN_ID,
                userType: 'TENANT',
                start_date: dateStr,
                end_date: dateStr
            })
        });

        const callLogData = await callLogResponse.json();
        console.log(`📞 [PBX Sync] Got ${callLogData.data?.length || 0} calls`);

        if (!callLogData.data || callLogData.data.length === 0) {
            return Response.json({ success: true, message: 'No calls found', synced: 0 });
        }

        let synced = 0;
        let skipped = 0;
        let errors = 0;

        for (const call of callLogData.data) {
            try {
                const callerPhone = normalizePhone(call.caller || call.src);
                const calleePhone = normalizePhone(call.callee || call.dst);
                const callId = call.callid || call.uniqueid || '';
                const duration = call.duration || call.billsec || '0';
                const startTime = call.start_time || call.calldate;
                const direction = call.direction || (call.caller?.length > 5 ? 'incoming' : 'outgoing');
                const isIncoming = direction === 'incoming' || direction === 'inbound';
                const externalPhone = isIncoming ? callerPhone : calleePhone;

                if (!externalPhone) { skipped++; continue; }

                // Check dedup: search recent activities with this phone + callId
                const callTime = new Date(startTime);
                const searchStart = new Date(callTime.getTime() - 120000).toISOString();
                const searchEnd = new Date(callTime.getTime() + 120000).toISOString();

                const existing = await sr.Activity.filter({
                    activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                    created_date: { $gte: searchStart, $lte: searchEnd }
                }, null, 10);

                const isDuplicate = existing.some(a => a.content?.includes(externalPhone) || (callId && a.content?.includes(callId)));
                if (isDuplicate) {
                    // Maybe update recording if missing
                    if (callId) {
                        try {
                            const recResponse = await fetch(`${PBX_API_URL}/info/recordingPath`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ token_id: PBX_TOKEN_ID, userType: 'TENANT', callid: callId })
                            });
                            const recData = await recResponse.json();
                            const recordingUrl = recData.data?.recording_path || recData.data?.url || '';
                            if (recordingUrl) {
                                const toUpdate = existing.find(a => (a.content?.includes(externalPhone) || a.content?.includes(callId)) && !a.recording_url);
                                if (toUpdate) {
                                    await sr.Activity.update(toUpdate.id, { recording_url: recordingUrl });
                                }
                            }
                        } catch (_e) { /* silent */ }
                    }
                    skipped++;
                    continue;
                }

                // Find customer
                let customer = null;
                const clients = await sr.Client.filter({ phone: externalPhone }, null, 1);
                if (clients.length > 0) customer = clients[0];

                // Get recording
                let recordingUrl = '';
                if (callId) {
                    try {
                        const recResponse = await fetch(`${PBX_API_URL}/info/recordingPath`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token_id: PBX_TOKEN_ID, userType: 'TENANT', callid: callId })
                        });
                        const recData = await recResponse.json();
                        recordingUrl = recData.data?.recording_path || recData.data?.url || '';
                    } catch (_e) { /* silent */ }
                }

                await sr.Activity.create({
                    activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                    summary: customer ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}` : `שיחה - ${externalPhone}`,
                    content: `מספר: ${externalPhone} | משך: ${duration} שניות | ${customer ? `לקוח: ${customer.full_name}` : 'לקוח לא מזוהה'} | callId: ${callId}`,
                    recording_url: recordingUrl || undefined,
                });
                synced++;

            } catch (callError) {
                console.error(`❌ [PBX Sync] Error processing call:`, callError.message);
                errors++;
            }
        }

        await sr.SyncLog.create({
            sync_key: 'pbx_call_log',
            run_started_at: new Date().toISOString(),
            status: errors > 0 ? 'PARTIAL' : 'SUCCESS',
            records_fetched: callLogData.data.length,
            records_created: synced,
            records_skipped: skipped,
            error_message: errors > 0 ? `${errors} errors` : undefined,
            trigger_type: 'MANUAL',
        });

        console.log(`✅ [PBX Sync] Done: ${synced} synced, ${skipped} skipped, ${errors} errors`);

        return Response.json({ success: true, date: dateStr, total_calls: callLogData.data.length, synced, skipped, errors });

    } catch (error) {
        console.error('❌ [PBX Sync] Fatal error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});