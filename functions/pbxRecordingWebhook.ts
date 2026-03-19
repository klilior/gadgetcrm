import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

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

async function createJWT(serviceAccount) {
    console.log('🔐 [GDrive] Step 3: Generating JWT token...');
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/drive.file',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };

    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signatureInput = headerB64 + '.' + claimB64;

    // Import the private key
    const pemKey = serviceAccount.private_key;
    const pemContent = pemKey.replace(/-----BEGIN PRIVATE KEY-----/g, '')
                             .replace(/-----END PRIVATE KEY-----/g, '')
                             .replace(/\n/g, '');
    const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(signatureInput)
    );

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    console.log('🔐 [GDrive] Step 3: JWT generated successfully');
    return signatureInput + '.' + sigB64;
}

async function getGoogleAccessToken(serviceAccount) {
    console.log('🔑 [GDrive] Step 4: Exchanging JWT for access token...');
    const jwt = await createJWT(serviceAccount);
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const data = await response.json();
    console.log('🔑 [GDrive] Step 4: Token response status:', response.status);
    if (!response.ok) {
        console.error('🔑 [GDrive] Step 4: Token error:', JSON.stringify(data));
        throw new Error('Failed to get access token: ' + JSON.stringify(data));
    }
    console.log('🔑 [GDrive] Step 4: Access token obtained successfully');
    return data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    console.log(`📁 [GDrive] Step 6: Searching for folder "${folderName}" in parent ${parentId}...`);
    const searchResponse = await fetch(
        'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id,name)',
        { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const searchResult = await searchResponse.json();
    console.log(`📁 [GDrive] Step 6: Search response status: ${searchResponse.status}, found: ${searchResult.files?.length || 0}`);

    if (searchResult.files && searchResult.files.length > 0) {
        console.log(`📁 [GDrive] Step 6: Found existing folder "${folderName}" (${searchResult.files[0].id})`);
        return searchResult.files[0].id;
    }

    // Create new folder
    console.log(`📁 [GDrive] Step 6: Creating new folder "${folderName}"...`);
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        })
    });
    const createResult = await createResponse.json();
    console.log(`📁 [GDrive] Step 6: Create folder response status: ${createResponse.status}, result:`, JSON.stringify(createResult));
    if (!createResult.id) throw new Error(`Failed to create folder "${folderName}": ${JSON.stringify(createResult)}`);
    console.log(`📁 [GDrive] Step 6: Created folder "${folderName}" (${createResult.id})`);
    return createResult.id;
}

async function uploadToGDrive(accessToken, folderId, fileName, fileData, mimeType) {
    console.log(`☁️ [GDrive] Step 7: Uploading file "${fileName}" (${(fileData.byteLength / 1024).toFixed(1)} KB, ${mimeType})...`);
    const metadata = {
        name: fileName,
        parents: [folderId],
        mimeType: mimeType
    };

    const boundary = 'boundary_' + Date.now();
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelimiter = '\r\n--' + boundary + '--';

    // Convert file data to base64
    const fileBytes = new Uint8Array(fileData);
    const chunkSize = 8192;
    let base64Data = '';
    for (let i = 0; i < fileBytes.length; i += chunkSize) {
        const chunk = fileBytes.subarray(i, Math.min(i + chunkSize, fileBytes.length));
        base64Data += String.fromCharCode(...chunk);
    }
    base64Data = btoa(base64Data);

    const body = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + mimeType + '\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Data +
        closeDelimiter;

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: body
    });

    const result = await response.json();
    console.log('☁️ [GDrive] Step 7: Upload response status:', response.status, 'result:', JSON.stringify(result));

    if (!response.ok || !result.id) throw new Error('Upload failed: ' + JSON.stringify(result));

    console.log(`☁️ [GDrive] Step 7: Upload SUCCESS - file ID: ${result.id}, link: ${result.webViewLink}`);
    return {
        fileId: result.id,
        webViewLink: result.webViewLink || 'https://drive.google.com/file/d/' + result.id + '/view'
    };
}

// ═══════ Main handler ═══════

Deno.serve(async (req) => {
    try {
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
            });
        }

        // ── Debug: Log full request info ──
        console.log('🔍 [Recording Debug] Full request headers:', JSON.stringify(Object.fromEntries(req.headers.entries())));
        console.log('🔍 [Recording Debug] Content-Type:', req.headers.get('content-type'));
        console.log('🔍 [Recording Debug] Method:', req.method);
        console.log('🔍 [Recording Debug] URL:', req.url);

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
            // Try to read body as text, attempt JSON parse, then fallback to query params
            const bodyText = await req.text();
            console.log('🔍 [Recording Debug] Raw body text:', bodyText?.substring(0, 2000));
            if (bodyText) {
                try {
                    recordData = JSON.parse(bodyText);
                } catch {
                    const url = new URL(req.url);
                    for (const [key, value] of url.searchParams.entries()) {
                        recordData[key] = value;
                    }
                }
            } else {
                const url = new URL(req.url);
                for (const [key, value] of url.searchParams.entries()) {
                    recordData[key] = value;
                }
            }
        }

        console.log('🔍 [Recording Debug] Full webhook payload:', JSON.stringify(recordData));

        // ── Handle nested "data" format from PBX ──
        // PBX may send: { "file": "https://...", "data": { "callid": "...", "caller": "...", ... } }
        const nestedData = recordData.data && typeof recordData.data === 'object' ? recordData.data : {};
        const flat = { ...nestedData, ...recordData }; // flat fields override nested
        // Remove the nested 'data' key so we don't confuse it
        delete flat.data;

        console.log('🔍 [Recording Debug] Flattened payload:', JSON.stringify(flat));

        const callId = flat.callid || flat.call_id || flat.uniqueid || '';
        const callerNumber = flat.caller || flat.from || flat.src || '';
        const calleeNumber = flat.callee || flat.to || flat.dst || '';
        const duration = flat.duration || flat.billsec || flat.call_sec || '0';
        const direction = flat.direction || flat.call_direction || flat.type || 'incoming';
        const extension = flat.ext || flat.extension || '';
        const startDate = flat.start_date || '';

        // Recording URL: the "file" field is the primary one from PBX
        const pbxRecordingUrl = flat.file || flat.recording_url || flat.recordingUrl || flat.recording || flat.file_url || '';

        console.log('📞 [Recording] Parsed fields:', JSON.stringify({
            callId, callerNumber, calleeNumber, duration, direction, extension, startDate,
            pbxRecordingUrl: pbxRecordingUrl?.substring(0, 200)
        }));

        const isIncoming = direction === 'incoming' || direction === 'inbound' || direction === 'in';

        // Smart extraction: for outgoing, try callee first, fall back to caller
        let externalNumber;
        if (isIncoming) {
            externalNumber = callerNumber;
        } else {
            const calleeClean = calleeNumber.replace(/[^\d]/g, '');
            if (calleeClean && calleeClean.length >= 7) {
                externalNumber = calleeNumber;
            } else if (callerNumber.replace(/[^\d]/g, '').length >= 7) {
                externalNumber = callerNumber;
            } else {
                externalNumber = calleeNumber || callerNumber;
            }
        }
        const normalizedPhone = normalizePhone(externalNumber);
        console.log('📞 [Recording] External number:', externalNumber, '→ normalized:', normalizedPhone);

        // Find customer by trying all phone variants
        let customer = null;
        if (normalizedPhone) {
            const variants = phoneSearchVariants(externalNumber);
            for (const variant of variants) {
                const results = await sr.Client.filter({ phone: variant }, null, 1);
                if (results.length > 0) { customer = results[0]; break; }
            }
        }
        console.log('👤 [Recording] Customer match:', customer ? `${customer.full_name} (${customer.id})` : 'none');

        // ═══════ Upload recording to Google Drive ═══════
        let finalRecordingUrl = pbxRecordingUrl || '';
        let gdriveUploadSuccess = false;
        let gdriveError = null;

        if (pbxRecordingUrl) {
            try {
                // Step 1: Read credentials
                console.log('📋 [GDrive] Step 1: Reading credentials from environment...');
                const saKeyJson = Deno.env.get('GDRIVE_SERVICE_ACCOUNT_KEY');
                const rootFolderId = Deno.env.get('GDRIVE_FOLDER_ID');

                console.log('📋 [GDrive] Step 1: GDRIVE_SERVICE_ACCOUNT_KEY exists:', !!saKeyJson, 'length:', saKeyJson?.length || 0);
                console.log('📋 [GDrive] Step 1: GDRIVE_FOLDER_ID:', rootFolderId || 'NOT SET');

                if (!saKeyJson || !rootFolderId) {
                    console.log('⚠️ [GDrive] Step 1: FAILED - Missing GDRIVE_SERVICE_ACCOUNT_KEY or GDRIVE_FOLDER_ID');
                    gdriveError = 'Missing GDrive credentials in environment';
                } else {
                    // Step 2: Parse service account JSON
                    console.log('🔧 [GDrive] Step 2: Parsing service account JSON...');
                    let serviceAccount;
                    try {
                        serviceAccount = JSON.parse(saKeyJson);
                    } catch (parseErr) {
                        console.error('🔧 [GDrive] Step 2: FAILED to parse JSON:', parseErr.message);
                        console.log('🔧 [GDrive] Step 2: First 100 chars of key:', saKeyJson.substring(0, 100));
                        throw new Error('Failed to parse service account JSON: ' + parseErr.message);
                    }
                    // Fix escaped newlines in private key
                    if (serviceAccount.private_key) {
                        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
                    }
                    console.log('🔧 [GDrive] Step 2: Parsed successfully. client_email:', serviceAccount.client_email);
                    console.log('🔧 [GDrive] Step 2: private_key starts with:', serviceAccount.private_key?.substring(0, 30));
                    console.log('🔧 [GDrive] Step 2: private_key length:', serviceAccount.private_key?.length);

                    // Step 3+4: Get access token (JWT + exchange)
                    const accessToken = await getGoogleAccessToken(serviceAccount);

                    // Step 5: Download recording from PBX
                    console.log('📥 [GDrive] Step 5: Downloading recording from PBX:', pbxRecordingUrl);
                    let audioResponse = await fetch(pbxRecordingUrl);
                    console.log('📥 [GDrive] Step 5: Direct download status:', audioResponse.status, 'content-length:', audioResponse.headers.get('content-length'));

                    if (!audioResponse.ok) {
                        // Try with PBX token
                        console.log('📥 [GDrive] Step 5: Direct download failed, trying with token...');
                        const pbxToken = '7AaJmwvruPun2z2H';
                        const separator = pbxRecordingUrl.includes('?') ? '&' : '?';
                        audioResponse = await fetch(pbxRecordingUrl + separator + 'token_id=' + pbxToken);
                        console.log('📥 [GDrive] Step 5: Auth download status:', audioResponse.status, 'content-length:', audioResponse.headers.get('content-length'));
                    }

                    if (!audioResponse.ok) {
                        throw new Error(`Failed to download recording. Status: ${audioResponse.status}`);
                    }

                    const fileBytes = await audioResponse.arrayBuffer();
                    const fileSizeMB = (fileBytes.byteLength / (1024 * 1024)).toFixed(2);
                    console.log(`📥 [GDrive] Step 5: Downloaded ${fileSizeMB} MB (${fileBytes.byteLength} bytes)`);

                    if (fileBytes.byteLength < 100) {
                        console.warn('📥 [GDrive] Step 5: WARNING - File is suspiciously small, might not be a real recording');
                    }

                    // Step 6: Create folder structure YYYY-MM / customer_name
                    const now = new Date();
                    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    const customerFolderName = customer?.full_name || normalizedPhone || 'unknown';

                    console.log(`📁 [GDrive] Step 6: Creating folder structure: ${yearMonth} / ${customerFolderName}`);
                    const monthFolderId = await findOrCreateFolder(accessToken, rootFolderId, yearMonth);
                    const customerFolderId = await findOrCreateFolder(accessToken, monthFolderId, customerFolderName);

                    // Step 7: Upload file
                    const dateStr = now.toISOString().replace(/[:]/g, '-').slice(0, 19);
                    const dirLabel = isIncoming ? 'in' : 'out';
                    const fileName = `${dateStr}_${dirLabel}_${normalizedPhone || 'unknown'}_${callId || 'nocallid'}.wav`;
                    const mimeType = pbxRecordingUrl.includes('.mp3') ? 'audio/mpeg' : 'audio/wav';

                    const uploaded = await uploadToGDrive(accessToken, customerFolderId, fileName, fileBytes, mimeType);
                    finalRecordingUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.fileId}/view`;
                    gdriveUploadSuccess = true;
                    console.log(`✅ [GDrive] Recording saved to Drive: ${finalRecordingUrl}`);
                }
            } catch (driveError) {
                console.error(`❌ [GDrive] Upload failed:`, driveError.message);
                console.error(`❌ [GDrive] Stack:`, driveError.stack);
                gdriveError = driveError.message;
                finalRecordingUrl = pbxRecordingUrl;
            }
        } else {
            console.log('⚠️ [Recording] No recording URL found in payload');
            gdriveError = 'No recording URL in payload';
        }

        // ═══════ Match / create Activity ═══════
        let matchedActivity = null;

        const [recentIncoming, recentOutgoing] = await Promise.all([
            sr.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 50),
            sr.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 50),
        ]);
        const recentActivities = [...recentIncoming, ...recentOutgoing];

        if (callId) {
            matchedActivity = recentActivities.find(a => a.content?.includes(callId));
        }
        if (!matchedActivity && normalizedPhone) {
            const preferred = recentActivities.filter(a => a.activity_type === (isIncoming ? 'שיחה נכנסת' : 'שיחה יוצאת'));
            matchedActivity = preferred.find(a => a.content?.includes(normalizedPhone) && !a.recording_url);
            if (!matchedActivity) {
                matchedActivity = recentActivities.find(a => a.content?.includes(normalizedPhone) && !a.recording_url);
            }
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

        // ═══════ Save to SyncLog ═══════
        try {
            await sr.SyncLog.create({
                sync_key: 'pbx_recording_webhook',
                run_started_at: new Date().toISOString(),
                status: gdriveUploadSuccess ? 'SUCCESS' : 'FAILED',
                error_message: gdriveUploadSuccess ? null : (gdriveError || 'Unknown error'),
                details_json: {
                    callId,
                    recordingUrl: pbxRecordingUrl?.substring(0, 500),
                    gdriveLink: gdriveUploadSuccess ? finalRecordingUrl : null,
                    customerName: customer?.full_name || null,
                    normalizedPhone,
                    error: gdriveError
                })
            });
            console.log('📝 [SyncLog] Logged webhook result');
        } catch (logErr) {
            console.error('📝 [SyncLog] Failed to write log:', logErr.message);
        }

        return Response.json({
            success: true,
            activity_updated: !!matchedActivity,
            customer_matched: !!customer,
            recording_url: finalRecordingUrl,
            gdrive_upload: gdriveUploadSuccess,
            gdrive_error: gdriveError,
        }, { headers: { 'Access-Control-Allow-Origin': '*' } });

    } catch (error) {
        console.error('❌ [Recording Webhook] FATAL Error:', error.message);
        console.error('❌ [Recording Webhook] Stack:', error.stack);
        return Response.json({ success: false, error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
});