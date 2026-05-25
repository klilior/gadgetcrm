import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Pull-based recording sync: fetches today's call log from PBX,
 * finds calls with recordings, downloads them, uploads to Google Drive,
 * and updates matching Activities.
 * 
 * Payload options:
 *   date: "YYYY-MM-DD" (default: today)
 *   days_back: number (default: 0, sync multiple days)
 *   limit: max calls to process (default: 50)
 */

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
    return [normalized, '972' + normalized.slice(1), '+972' + normalized.slice(1)];
}

// ═══════ Google Drive helpers ═══════

async function createJWT(serviceAccount) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/drive.file',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600, iat: now
    };
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signatureInput = headerB64 + '.' + claimB64;

    const pemContent = serviceAccount.private_key
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\n/g, '');
    const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey,
        new TextEncoder().encode(signatureInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return signatureInput + '.' + sigB64;
}

async function getGoogleAccessToken(serviceAccount) {
    const jwt = await createJWT(serviceAccount);
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const data = await response.json();
    if (!response.ok) throw new Error('Failed to get GDrive access token: ' + JSON.stringify(data));
    return data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchResp = await fetch(
        'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id,name)',
        { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const searchResult = await searchResp.json();
    if (searchResult.files?.length > 0) return searchResult.files[0].id;

    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    const createResult = await createResp.json();
    if (!createResult.id) throw new Error(`Failed to create folder "${folderName}"`);
    return createResult.id;
}

async function uploadToGDrive(accessToken, folderId, fileName, fileData, mimeType) {
    const metadata = { name: fileName, parents: [folderId], mimeType };
    const boundary = 'boundary_' + Date.now();
    const fileBytes = new Uint8Array(fileData);
    const chunkSize = 8192;
    let base64Data = '';
    for (let i = 0; i < fileBytes.length; i += chunkSize) {
        base64Data += String.fromCharCode(...fileBytes.subarray(i, Math.min(i + chunkSize, fileBytes.length)));
    }
    base64Data = btoa(base64Data);

    const body = '\r\n--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
        '\r\n--' + boundary + '\r\n' +
        'Content-Type: ' + mimeType + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64Data +
        '\r\n--' + boundary + '--';

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error('GDrive upload failed: ' + JSON.stringify(result));
    return { fileId: result.id, webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view` };
}

// ═══════ Main handler ═══════

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow admin or automation
        let user = null;
        try { user = await base44.auth.me(); } catch (_) {}
        if (user && user.role !== 'admin' && user.role !== 'מנהל') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;
        const body = await req.json().catch(() => ({}));

        // PBX settings
        const settingsList = await sr.Settings.list();
        const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
        const PBX_API_URL = getSetting('PBX_API_URL') || 'https://master.ippbx.co.il/ippbx_api/v1.4/api';
        const PBX_TOKEN_ID = getSetting('PBX_TOKEN_ID') || '7AaJmwvruPun2z2H';

        // Google Drive credentials
        const saKeyJson = Deno.env.get('GDRIVE_SERVICE_ACCOUNT_KEY');
        const rootFolderId = Deno.env.get('GDRIVE_FOLDER_ID');
        if (!saKeyJson || !rootFolderId) {
            return Response.json({ error: 'Missing GDRIVE_SERVICE_ACCOUNT_KEY or GDRIVE_FOLDER_ID' }, { status: 500 });
        }
        const serviceAccount = JSON.parse(saKeyJson);
        if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

        // Date range
        const daysBack = body.days_back || 0;
        const limit = body.limit || 50;
        const dates = [];
        for (let i = 0; i <= daysBack; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }
        if (body.date && !dates.includes(body.date)) dates.push(body.date);

        const stats = { total_calls: 0, with_recording: 0, uploaded: 0, already_on_drive: 0, skipped: 0, errors: 0 };

        for (const dateStr of dates) {
            console.log(`📞 [RecSync] Fetching calls for ${dateStr}...`);

            const callLogResp = await fetch(`${PBX_API_URL}/info/callLog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token_id: PBX_TOKEN_ID, userType: 'TENANT', start_date: dateStr, end_date: dateStr })
            });
            const callLogData = await callLogResp.json();
            const calls = callLogData.data || [];
            stats.total_calls += calls.length;
            console.log(`📞 [RecSync] ${dateStr}: ${calls.length} calls`);

            if (calls.length === 0) continue;

            // Get GDrive token once per date batch
            const accessToken = await getGoogleAccessToken(serviceAccount);

            let processed = 0;
            for (const call of calls) {
                if (processed >= limit) break;

                const callId = call.callid || call.uniqueid || '';
                const duration = parseInt(call.duration || call.billsec || '0', 10);
                if (duration < 5) { stats.skipped++; continue; } // skip very short calls (no recording)

                const callerPhone = normalizePhone(call.caller || call.src);
                const calleePhone = normalizePhone(call.callee || call.dst);
                const direction = call.direction || (call.caller?.replace(/[^\d]/g, '').length > 5 ? 'incoming' : 'outgoing');
                const isIncoming = direction === 'incoming' || direction === 'inbound';
                const externalPhone = isIncoming ? callerPhone : calleePhone;

                if (!externalPhone) { stats.skipped++; continue; }

                // Check if we already have a Drive link for this call
                // Search by phone instead of fetching 100 recent
                let matchingActivity = null;
                const phonesToSearch = phoneSearchVariants(externalPhone);
                for (const pv of phonesToSearch) {
                    const byType = isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת';
                    const found = await sr.Activity.filter({ activity_type: byType }, '-created_date', 20);
                    const match = found.find(a => a.content?.includes(pv) && ((callId && a.content?.includes(callId)) || !a.recording_url));
                    if (match) { matchingActivity = match; break; }
                }
                if (!matchingActivity && callId) {
                    // Fallback: search both types for callId
                    const [ri, ro] = await Promise.all([
                        sr.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 20),
                        sr.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 20),
                    ]);
                    matchingActivity = [...ri, ...ro].find(a => a.content?.includes(callId));
                }

                // Skip if already has a Google Drive link
                if (matchingActivity?.recording_url?.includes('drive.google.com')) {
                    stats.already_on_drive++;
                    continue;
                }

                // Fetch recording path from PBX
                let recordingUrl = '';
                if (callId) {
                    try {
                        const recResp = await fetch(`${PBX_API_URL}/info/recordingPath`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token_id: PBX_TOKEN_ID, userType: 'TENANT', callid: callId })
                        });
                        const recData = await recResp.json();
                        recordingUrl = recData.data?.recording_path || recData.data?.url || recData.data?.file || '';
                        console.log(`🎙️ [RecSync] callId=${callId} recording=${recordingUrl ? 'YES' : 'NO'}`);
                    } catch (e) {
                        console.error(`❌ [RecSync] recordingPath error for ${callId}:`, e.message);
                    }
                }

                if (!recordingUrl) {
                    stats.skipped++;
                    continue;
                }

                stats.with_recording++;

                // Download recording from PBX
                try {
                    let audioResponse = await fetch(recordingUrl);
                    if (!audioResponse.ok) {
                        const separator = recordingUrl.includes('?') ? '&' : '?';
                        audioResponse = await fetch(recordingUrl + separator + 'token_id=' + PBX_TOKEN_ID);
                    }
                    if (!audioResponse.ok) {
                        console.error(`❌ [RecSync] Download failed for ${callId}: ${audioResponse.status}`);
                        stats.errors++;
                        continue;
                    }

                    const fileBytes = await audioResponse.arrayBuffer();
                    if (fileBytes.byteLength < 100) {
                        console.warn(`⚠️ [RecSync] File too small for ${callId}: ${fileBytes.byteLength} bytes`);
                        stats.errors++;
                        continue;
                    }

                    // Find customer
                    let customer = null;
                    const variants = phoneSearchVariants(externalPhone);
                    for (const variant of variants) {
                        const clients = await sr.Client.filter({ phone: variant }, null, 1);
                        if (clients.length > 0) { customer = clients[0]; break; }
                    }

                    // Upload to Google Drive: YYYY-MM / customer_name /
                    const callDate = new Date(call.start_time || call.calldate || dateStr);
                    const yearMonth = `${callDate.getFullYear()}-${String(callDate.getMonth() + 1).padStart(2, '0')}`;
                    const customerFolderName = customer?.full_name || externalPhone || 'unknown';

                    const monthFolderId = await findOrCreateFolder(accessToken, rootFolderId, yearMonth);
                    const customerFolderId = await findOrCreateFolder(accessToken, monthFolderId, customerFolderName);

                    const timeStr = (call.start_time || callDate.toISOString()).replace(/[:]/g, '-').replace(' ', 'T').slice(0, 19);
                    const dirLabel = isIncoming ? 'in' : 'out';
                    const fileName = `${timeStr}_${dirLabel}_${externalPhone}_${callId}.wav`;
                    const mimeType = recordingUrl.includes('.mp3') ? 'audio/mpeg' : 'audio/wav';

                    const uploaded = await uploadToGDrive(accessToken, customerFolderId, fileName, fileBytes, mimeType);
                    const driveLink = uploaded.webViewLink;
                    console.log(`✅ [RecSync] Uploaded: ${fileName} → ${driveLink}`);

                    // Update or create Activity
                    if (matchingActivity) {
                        const updates = { recording_url: driveLink };
                        // Add recording note to content if not already there
                        if (!matchingActivity.content?.includes('הקלטה:')) {
                            updates.content = (matchingActivity.content || '') + ` | הקלטה: ✅`;
                        }
                        await sr.Activity.update(matchingActivity.id, updates);
                        console.log(`📝 [RecSync] Updated activity ${matchingActivity.id}`);
                    } else {
                        // Create new activity
                        await sr.Activity.create({
                            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                            summary: customer ? `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}` : `שיחה - ${externalPhone}`,
                            content: `${isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת'} ${customer ? `מ-${customer.full_name} (${externalPhone})` : `- ${externalPhone}`} | שלוחה: ${call.extension || ''} | סטטוס: הסתיימה | משך: ${duration} שניות | הקלטה: ✅ | callId: ${callId}`,
                            recording_url: driveLink,
                            order_id: customer?.id || undefined,
                        });
                        console.log(`📝 [RecSync] Created new activity with recording`);
                    }

                    stats.uploaded++;
                    processed++;

                } catch (err) {
                    console.error(`❌ [RecSync] Error processing ${callId}:`, err.message);
                    stats.errors++;
                }
            }
        }

        // Log result
        await sr.SyncLog.create({
            sync_key: 'pbx_recording_sync',
            run_started_at: new Date().toISOString(),
            status: stats.errors > 0 ? 'PARTIAL' : 'SUCCESS',
            records_fetched: stats.total_calls,
            records_created: stats.uploaded,
            records_skipped: stats.skipped + stats.already_on_drive,
            trigger_type: body.trigger_type || 'MANUAL',
            details_json: stats,
        });

        console.log(`✅ [RecSync] Done:`, JSON.stringify(stats));
        return Response.json({ success: true, stats });

    } catch (error) {
        console.error('❌ [RecSync] Fatal:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});