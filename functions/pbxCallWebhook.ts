import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

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
    const pemContent = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\n/g, '');
    const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signatureInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return signatureInput + '.' + sigB64;
}

async function getGoogleAccessToken(serviceAccount) {
    const jwt = await createJWT(serviceAccount);
    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error('GDrive token error: ' + JSON.stringify(data));
    return data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const sr = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id,name)', { headers: { 'Authorization': 'Bearer ' + accessToken } });
    const res = await sr.json();
    if (res.files?.length > 0) return res.files[0].id;
    const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    const created = await cr.json();
    if (!created.id) throw new Error('Failed to create folder: ' + folderName);
    return created.id;
}

async function uploadToGDrive(accessToken, folderId, fileName, fileData, mimeType) {
    const boundary = 'b_' + Date.now();
    const fileBytes = new Uint8Array(fileData);
    let base64 = '';
    for (let i = 0; i < fileBytes.length; i += 8192) {
        base64 += String.fromCharCode(...fileBytes.subarray(i, Math.min(i + 8192, fileBytes.length)));
    }
    base64 = btoa(base64);
    const body = '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name: fileName, parents: [folderId], mimeType }) +
        '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64 + '\r\n--' + boundary + '--';
    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    const result = await resp.json();
    if (!resp.ok || !result.id) throw new Error('GDrive upload failed: ' + JSON.stringify(result));
    return result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`;
}

/**
 * Downloads a recording from PBX URL, uploads to Google Drive, returns Drive link.
 * Returns null if credentials missing or upload fails.
 */
async function uploadRecordingToDrive(pbxUrl, normalizedPhone, customerName, isIncoming, callId) {
    const saKeyJson = Deno.env.get('GDRIVE_SERVICE_ACCOUNT_KEY');
    const rootFolderId = Deno.env.get('GDRIVE_FOLDER_ID');
    if (!saKeyJson || !rootFolderId) { console.log('⚠️ [GDrive] Missing credentials, skipping upload'); return null; }

    const serviceAccount = JSON.parse(saKeyJson);
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

    const accessToken = await getGoogleAccessToken(serviceAccount);

    // Download recording
    let audioResp = await fetch(pbxUrl);
    if (!audioResp.ok) {
        const sep = pbxUrl.includes('?') ? '&' : '?';
        audioResp = await fetch(pbxUrl + sep + 'token_id=7AaJmwvruPun2z2H');
    }
    if (!audioResp.ok) throw new Error(`Download failed: ${audioResp.status}`);
    const fileBytes = await audioResp.arrayBuffer();
    if (fileBytes.byteLength < 100) throw new Error('File too small: ' + fileBytes.byteLength);

    // Folder structure: YYYY-MM / customer_name
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const folderName = customerName || normalizedPhone || 'unknown';
    const monthFolder = await findOrCreateFolder(accessToken, rootFolderId, yearMonth);
    const custFolder = await findOrCreateFolder(accessToken, monthFolder, folderName);

    const timeStr = now.toISOString().replace(/[:]/g, '-').slice(0, 19);
    const dirLabel = isIncoming ? 'in' : 'out';
    const fileName = `${timeStr}_${dirLabel}_${normalizedPhone || 'unknown'}_${callId || 'nocallid'}.wav`;
    const mimeType = pbxUrl.includes('.mp3') ? 'audio/mpeg' : 'audio/wav';

    return await uploadToGDrive(accessToken, custFolder, fileName, fileBytes, mimeType);
}

// ═══════ Phone helpers ═══════

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
                // Try to upload to Google Drive
                let finalUrl = recordingUrl;
                try {
                    const custName = existingActivity.summary?.replace(/שיחה (מ|ל)-/, '') || null;
                    const driveLink = await uploadRecordingToDrive(recordingUrl, normalizedPhone, custName, isIncoming, callId);
                    if (driveLink) { finalUrl = driveLink; console.log(`✅ [PBX→GDrive] Uploaded: ${driveLink}`); }
                } catch (driveErr) { console.error(`⚠️ [PBX→GDrive] Upload failed, keeping PBX URL:`, driveErr.message); }
                updates.recording_url = finalUrl;
            }
            // If existing has PBX recording URL (not Drive), try to upgrade it
            if (existingActivity.recording_url && !existingActivity.recording_url.includes('drive.google.com') && existingActivity.recording_url !== 'https://example.com/test.wav') {
                try {
                    const custName = existingActivity.summary?.replace(/שיחה (מ|ל)-/, '') || null;
                    const driveLink = await uploadRecordingToDrive(existingActivity.recording_url, normalizedPhone, custName, isIncoming, callId);
                    if (driveLink) { updates.recording_url = driveLink; console.log(`✅ [PBX→GDrive] Upgraded existing: ${driveLink}`); }
                } catch (driveErr) { console.error(`⚠️ [PBX→GDrive] Upgrade failed:`, driveErr.message); }
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