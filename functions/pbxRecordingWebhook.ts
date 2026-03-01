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

// ═══════ Google Drive helpers ═══════

function base64url(data) {
    let b64;
    if (typeof data === 'string') {
        b64 = btoa(data);
    } else {
        b64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
    const b64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    const binary = atob(b64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf.buffer;
}

async function getGoogleAccessToken(serviceAccountJson) {
    const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/drive',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    const keyData = pemToArrayBuffer(sa.private_key);
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
    const jwt = `${signingInput}.${base64url(signature)}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
        throw new Error(`Google token error: ${JSON.stringify(tokenData)}`);
    }
    console.log('🔑 [GDrive] Got access token');
    return tokenData.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
    // Search for existing folder
    const q = `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) {
        return searchData.files[0].id;
    }

    // Create folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        }),
    });
    const created = await createRes.json();
    if (!created.id) throw new Error(`Failed to create folder "${folderName}": ${JSON.stringify(created)}`);
    console.log(`📁 [GDrive] Created folder: ${folderName} (${created.id})`);
    return created.id;
}

async function uploadToGoogleDrive(accessToken, folderId, fileName, fileBytes, mimeType) {
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const boundary = '===BOUNDARY===';
    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
    const footer = `\r\n--${boundary}--`;

    // Convert file bytes to base64
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(fileBytes)));

    const fullBody = body + base64Data + footer;

    const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: fullBody,
        }
    );
    const uploadData = await uploadRes.json();
    if (!uploadData.id) throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
    console.log(`✅ [GDrive] Uploaded: ${fileName} → ${uploadData.webViewLink}`);
    return uploadData;
}

// ═══════ Main handler ═══════

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
        const pbxRecordingUrl = recordData.recording_url || recordData.recordingUrl || recordData.recording || recordData.file_url || '';
        const direction = recordData.direction || recordData.type || 'incoming';
        const extension = recordData.ext || recordData.extension || '';

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';
        const externalNumber = isIncoming ? callerNumber : calleeNumber;
        const normalizedPhone = normalizePhone(externalNumber);

        // Find customer by trying all phone variants
        let customer = null;
        if (normalizedPhone) {
            const variants = phoneSearchVariants(externalNumber);
            for (const variant of variants) {
                const results = await sr.Client.filter({ phone: variant }, null, 1);
                if (results.length > 0) { customer = results[0]; break; }
            }
        }

        // ═══════ Upload recording to Google Drive ═══════
        let finalRecordingUrl = pbxRecordingUrl || '';

        if (pbxRecordingUrl) {
            try {
                console.log(`📥 [GDrive] Downloading recording from PBX: ${pbxRecordingUrl}`);

                const saKeyJson = Deno.env.get('GDRIVE_SERVICE_ACCOUNT_KEY');
                const rootFolderId = Deno.env.get('GDRIVE_FOLDER_ID');

                if (!saKeyJson || !rootFolderId) {
                    console.log('⚠️ [GDrive] Missing GDRIVE_SERVICE_ACCOUNT_KEY or GDRIVE_FOLDER_ID, using PBX URL');
                } else {
                    // Download the WAV file from PBX
                    const fileRes = await fetch(pbxRecordingUrl);
                    if (!fileRes.ok) throw new Error(`Download failed: HTTP ${fileRes.status}`);
                    const fileBytes = await fileRes.arrayBuffer();
                    const fileSizeMB = (fileBytes.byteLength / (1024 * 1024)).toFixed(2);
                    console.log(`📥 [GDrive] Downloaded ${fileSizeMB} MB`);

                    // Get Google access token
                    const accessToken = await getGoogleAccessToken(saKeyJson);

                    // Build folder path: YYYY-MM / customer_name
                    const now = new Date();
                    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    const customerFolderName = customer?.full_name || normalizedPhone || 'unknown';

                    const monthFolderId = await findOrCreateFolder(accessToken, rootFolderId, yearMonth);
                    const customerFolderId = await findOrCreateFolder(accessToken, monthFolderId, customerFolderName);

                    // Build file name
                    const dateStr = now.toISOString().replace(/[:]/g, '-').slice(0, 19);
                    const dirLabel = isIncoming ? 'in' : 'out';
                    const fileName = `${dateStr}_${dirLabel}_${normalizedPhone || 'unknown'}_${callId || 'nocallid'}.wav`;

                    // Detect mime type
                    const mimeType = pbxRecordingUrl.includes('.mp3') ? 'audio/mpeg' : 'audio/wav';

                    // Upload
                    const uploaded = await uploadToGoogleDrive(accessToken, customerFolderId, fileName, fileBytes, mimeType);
                    finalRecordingUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;
                    console.log(`✅ [GDrive] Recording saved: ${finalRecordingUrl}`);
                }
            } catch (driveError) {
                console.error(`❌ [GDrive] Upload failed, falling back to PBX URL:`, driveError.message);
                finalRecordingUrl = pbxRecordingUrl;
            }
        }

        // ═══════ Match / create Activity ═══════
        let matchedActivity = null;
        const recentActivities = await sr.Activity.filter({
            activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
        }, '-created_date', 50);

        if (callId) {
            matchedActivity = recentActivities.find(a => a.content?.includes(callId));
        }
        if (!matchedActivity && normalizedPhone) {
            matchedActivity = recentActivities.find(a =>
                a.content?.includes(normalizedPhone) && !a.recording_url
            );
        }

        if (matchedActivity) {
            await sr.Activity.update(matchedActivity.id, {
                recording_url: finalRecordingUrl || undefined,
                content: matchedActivity.content + ` | משך: ${duration} שניות | הקלטה: ${finalRecordingUrl ? '✅' : '❌'}`
            });
            console.log(`✅ [Recording] Updated activity ${matchedActivity.id} with recording`);
        } else {
            const activity = await sr.Activity.create({
                activity_type: isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת',
                summary: customer ? `הקלטת שיחה - ${customer.full_name}` : `הקלטת שיחה - ${normalizedPhone || 'לא ידוע'}`,
                content: `מספר: ${normalizedPhone || externalNumber} | שלוחה: ${extension} | משך: ${duration} שניות | callId: ${callId}`,
                recording_url: finalRecordingUrl || undefined,
            });
            console.log(`✅ [Recording] Created new activity ${activity.id}`);
        }

        return Response.json({
            success: true,
            activity_updated: !!matchedActivity,
            customer_matched: !!customer,
            recording_url: finalRecordingUrl,
            gdrive_upload: finalRecordingUrl !== pbxRecordingUrl,
        }, { headers: { 'Access-Control-Allow-Origin': '*' } });

    } catch (error) {
        console.error('❌ [Recording Webhook] Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});