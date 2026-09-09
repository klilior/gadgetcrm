import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;

function jsonError(message, status) {
  return Response.json({ success: false, error: message }, { status });
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeE164(value) {
  let digits = cleanString(value, 32).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  if (!digits.startsWith('972')) digits = '972' + digits;
  return digits;
}

function toIsraeliLocal(e164) {
  const digits = normalizeE164(e164);
  return digits.startsWith('972') ? '0' + digits.slice(3) : digits;
}

function messageText(body) {
  const type = cleanString(body.message_type, 40);
  const content = cleanString(body.content, 8000);
  if (content) return content;
  const labels = {
    image: '[תמונה]',
    video: '[וידאו]',
    audio: '[הודעה קולית]',
    document: '[מסמך]',
    sticker: '[מדבקה]',
    location: '[מיקום]',
    contacts: '[איש קשר]',
    interactive: '[תגובה אינטראקטיבית]',
    button: '[לחיצה על כפתור]'
  };
  return labels[type] || '[הודעת WhatsApp]';
}

async function verifySignature(rawBody, timestamp, suppliedSignature, secret) {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const timestampSeconds = timestamp.length === 13
    ? Math.floor(Number(timestamp) / 1000)
    : Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const hex = suppliedSignature.replace(/^sha256=/, '');
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false;
  const signature = new Uint8Array(hex.match(/.{2}/g).map((part) => parseInt(part, 16)));
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(timestamp + '.' + rawBody)
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  const secret = Deno.env.get('WHATSAPP_GATEWAY_SHARED_SECRET') || '';
  if (!secret) return jsonError('not_configured', 503);

  const rawBody = await req.text();
  if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonError('invalid_body', 400);
  }

  const timestamp = req.headers.get('X-GT-Timestamp') || '';
  const signature = req.headers.get('X-GT-Signature') || '';
  if (!(await verifySignature(rawBody, timestamp, signature, secret))) {
    return jsonError('unauthorized', 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError('invalid_json', 400);
  }

  if (body?.version !== 1 || body?.type !== 'message') {
    return jsonError('unsupported_event', 400);
  }

  const messageId = cleanString(body.message_id, 256);
  const fromE164 = normalizeE164(body.from);
  const toE164 = normalizeE164(body.to);
  const occurredAt = cleanString(body.occurred_at, 64);
  const messageType = cleanString(body.message_type, 40) || 'unknown';

  if (!messageId || fromE164.length < 10 || toE164.length < 10 || !occurredAt) {
    return jsonError('missing_required_fields', 400);
  }
  if (Number.isNaN(Date.parse(occurredAt))) {
    return jsonError('invalid_timestamp', 400);
  }

  if (body.dry_run === true) {
    return Response.json({ success: true, dry_run: true });
  }

  const base44 = createClientFromRequest(req);
  const entities = base44.asServiceRole.entities;
  let receipt = null;

  try {
    const existingReceipts = await entities.WhatsAppCloudMessage.filter({
      external_message_id: messageId
    });
    receipt = existingReceipts?.[0] || null;
    if (receipt?.processing_status === 'processed') {
      return Response.json({ success: true, duplicate: true });
    }

    if (!receipt) {
      try {
        receipt = await entities.WhatsAppCloudMessage.create({
          external_message_id: messageId,
          direction: 'incoming',
          processing_status: 'processing',
          message_type: messageType,
          from_phone: fromE164,
          to_phone: toE164,
          occurred_at: new Date(occurredAt).toISOString(),
          provider: 'meta_cloud_api'
        });
      } catch (createError) {
        const raced = await entities.WhatsAppCloudMessage.filter({
          external_message_id: messageId
        });
        receipt = raced?.[0] || null;
        if (!receipt) throw createError;
        if (receipt.processing_status === 'processed') {
          return Response.json({ success: true, duplicate: true });
        }
      }
    }

    const localPhone = toIsraeliLocal(fromE164);
    let clients = await entities.Client.filter({ phone: localPhone });
    if (!clients?.length) clients = await entities.Client.filter({ phone: fromE164 });

    let customer = clients?.[0] || null;
    if (!customer) {
      customer = await entities.Client.create({
        full_name: cleanString(body.profile_name, 200) || localPhone,
        phone: localPhone,
        phone_original: fromE164,
        preferred_channel: 'whatsapp',
        source: 'Meta WhatsApp Cloud API',
        last_interaction_date: new Date(occurredAt).toISOString()
      });
    } else {
      await entities.Client.update(customer.id, {
        preferred_channel: 'whatsapp',
        last_interaction_date: new Date(occurredAt).toISOString()
      });
    }

    const displayText = messageText(body);
    let activities = await entities.Activity.filter({ thread_id: messageId });
    let activity = activities?.[0] || null;
    if (!activity) {
      activity = await entities.Activity.create({
        summary: 'הודעת WhatsApp נכנסת',
        activity_type: 'וואטסאפ נכנס',
        content: displayText,
        order_id: customer.id,
        thread_id: messageId,
        attachments: []
      });
    }

    let conversations = await entities.Conversation.filter({ customer_id: customer.id });
    let conversation = conversations?.[0] || null;
    const conversationData = {
      last_message: displayText.slice(0, 1000),
      last_message_date: new Date(occurredAt).toISOString(),
      last_channel: 'whatsapp',
      status: 'פתוח',
      unread_count: Math.max(0, Number(conversation?.unread_count || 0)) + 1
    };
    if (conversation) {
      conversation = await entities.Conversation.update(conversation.id, conversationData);
    } else {
      conversation = await entities.Conversation.create({
        customer_id: customer.id,
        ...conversationData
      });
    }

    await entities.WhatsAppCloudMessage.update(receipt.id, {
      processing_status: 'processed',
      customer_id: customer.id,
      conversation_id: conversation.id,
      activity_id: activity.id
    });

    console.log('WhatsApp Cloud message ingested', messageId.slice(-12));
    return Response.json({ success: true, duplicate: false });
  } catch (error) {
    if (receipt?.id) {
      try {
        await entities.WhatsAppCloudMessage.update(receipt.id, {
          processing_status: 'failed'
        });
      } catch {
        // Preserve the original error.
      }
    }
    console.error('WhatsApp Cloud ingestion failed', error?.message || 'unknown');
    return jsonError('ingestion_failed', 500);
  }
});
