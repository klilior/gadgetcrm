import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

// Green API Adapter
class GreenApiAdapter {
    constructor(config) {
        this.idInstance = config.idInstance;
        this.apiTokenInstance = config.apiTokenInstance;
        this.baseUrl = config.baseUrl || 'https://api.green-api.com';
    }

    parseWebhookData(webhookPayload) {
        const messageData = webhookPayload.messageData;
        const senderData = webhookPayload.senderData;
        
        if (!messageData) return null;

        return {
            senderName: senderData?.senderName || 'משתמש וואטסאפ',
            senderPhone: this.normalizePhone(senderData?.chatId),
            messageType: messageData.typeMessage,
            messageContent: messageData.textMessageData?.textMessage || '',
            mediaUrl: messageData.fileMessageData?.downloadUrl || '',
            fileName: messageData.fileMessageData?.fileName || '',
            caption: messageData.fileMessageData?.caption || ''
        };
    }

    normalizePhone(chatId) {
        if (!chatId) return '';
        const phone = chatId.replace(/@c\.us$/, '');
        // Normalize to 05XXXXXXXX format
        let digits = phone.replace(/[^\d]/g, '');
        if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
        else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
        if (digits.length === 9 && !digits.startsWith('0')) digits = '0' + digits;
        if (digits.length === 10 && digits.startsWith('0')) return digits;
        return digits || phone;
    }
}

// Bot.it Adapter
class BotitAdapter {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.senderPhone = config.senderPhone;
        this.baseUrl = config.baseUrl || 'https://botit.to/api/qr/rest';
    }

    parseWebhookData(webhookPayload) {
        return {
            senderName: webhookPayload.param1 || 'משתמש וואטסאפ',
            senderPhone: this.normalizePhone(webhookPayload.param3),
            messageType: webhookPayload.messageType || 'text',
            messageContent: webhookPayload.param2 || '',
            mediaUrl: webhookPayload.param4 || '',
            fileName: webhookPayload.fileName || '',
            caption: webhookPayload.param2 || ''
        };
    }

    normalizePhone(phone) {
        if (!phone) return "";
        let digits = phone.replace(/[^\d]/g, '');
        if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
        else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
        if (digits.length === 9 && !digits.startsWith('0')) digits = '0' + digits;
        if (digits.length === 10 && digits.startsWith('0')) return digits;
        if (digits.length >= 9 && digits.length <= 11) {
            if (!digits.startsWith('0')) digits = '0' + digits;
            return digits.slice(0, 10);
        }
        return digits;
    }
}

// Provider Factory
function createAdapter(provider) {
    switch (provider.provider_type) {
        case 'green-api':
            return new GreenApiAdapter(provider.config);
        case 'botit':
            return new BotitAdapter(provider.config);
        default:
            throw new Error(`Unsupported provider type: ${provider.provider_type}`);
    }
}

Deno.serve(async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    console.log("🚀 WHATSAPP WEBHOOK CALLED! Method:", req.method, "URL:", req.url);
    console.log("🚀 Timestamp:", new Date().toISOString());

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole;

    try {
        const bodyText = await req.text();
        console.log("📥 RAW BODY:", bodyText);
        
        let payload = {};
        try {
            payload = JSON.parse(bodyText);
            console.log("📋 PARSED PAYLOAD:", JSON.stringify(payload, null, 2));
        } catch (parseError) {
            console.error("❌ JSON Parse Error:", parseError);
            payload = { rawBody: bodyText };
        }

        // Determine provider type from URL path or headers
        const url = new URL(req.url);
        const providerType = url.searchParams.get('provider') || 'green-api'; // Default to Green API

        // Get the provider configuration
        const providers = await service.entities.WhatsappProvider.filter({ 
            provider_type: providerType, 
            is_active: true 
        });
        
        if (providers.length === 0) {
            console.error(`No active provider found for type: ${providerType}`);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
        }

        const provider = providers[0];
        const adapter = createAdapter(provider);

        // Save to WebhookLog
        await service.entities.WebhookLog.create({
            source: `whatsapp-${providerType}`,
            payload: {
                method: req.method,
                url: req.url,
                body: payload,
            },
            headers: Object.fromEntries(req.headers)
        });

        // Parse webhook data using the appropriate adapter
        const messageData = adapter.parseWebhookData(payload);
        
        if (!messageData || !messageData.senderPhone) {
            console.warn("⚠️ Webhook received but could not parse message data.");
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
        }

        console.log("🔍 EXTRACTED:", messageData);

        // Find or create customer (Client entity)
        let customer = (await service.entities.Client.filter({ phone: messageData.senderPhone }))[0];
        
        if (!customer) {
            customer = await service.entities.Client.create({
                full_name: messageData.senderName || `לקוח וואטסאפ ${messageData.senderPhone}`,
                phone: messageData.senderPhone,
                email: `${messageData.senderPhone}@whatsapp.user`,
                preferred_channel: "whatsapp"
            });
            console.log("👤 Created new customer:", customer.id);
        }

        // Find or create ticket
        let ticket = (await service.entities.Ticket.filter({
            customer_id: customer.id,
            status: { $nin: ["נסגר", "נסגר ללא מענה"] }
        }, '-updated_date', 1))[0];

        if (ticket) {
            console.log(`✅ Found open ticket: #${ticket.ticket_number}. Appending message.`);
            await service.entities.Ticket.update(ticket.id, { 
                status: "בטיפול",
                last_channel: "whatsapp" 
            });
        } else {
            console.log(`ℹ️ No open ticket found. Creating a new one.`);
            const newTicketNumber = ((await service.entities.Ticket.filter({}, "-ticket_number", 1))[0]?.ticket_number || 1000) + 1;
            
            ticket = await service.entities.Ticket.create({
                subject: `פניית וואטסאפ מ-${customer.full_name}`,
                customer_id: customer.id,
                ticket_number: newTicketNumber,
                status: "חדש",
                priority: "בינונית",
                contact_channel: "whatsapp",
                source: "whatsapp",
                description: messageData.messageContent || `${messageData.messageType} received`,
                last_channel: "whatsapp"
            });
            console.log("🎫 Created new ticket:", newTicketNumber);
        }

        // Create activity record
        let activityContent = messageData.messageContent;
        let attachments = [];

        if (messageData.mediaUrl) {
            switch (messageData.messageType) {
                case 'imageMessage':
                    activityContent = `📷 תמונה${messageData.caption ? ': ' + messageData.caption : ''}`;
                    break;
                case 'documentMessage':
                    activityContent = `📄 קובץ: ${messageData.fileName || 'document'}${messageData.caption ? ' - ' + messageData.caption : ''}`;
                    break;
                case 'audioMessage':
                    activityContent = `🎵 הודעה קולית${messageData.caption ? ': ' + messageData.caption : ''}`;
                    break;
                case 'videoMessage':
                    activityContent = `🎥 וידאו${messageData.caption ? ': ' + messageData.caption : ''}`;
                    break;
                default:
                    activityContent = `📎 מדיה: ${messageData.messageContent || 'קובץ נשלח'}`;
            }
            attachments = [messageData.mediaUrl];
        }

        await service.entities.Activity.create({
            ticket_id: ticket.id,
            order_id: customer.id,
            activity_type: "וואטסאפ נכנס",
            summary: `הודעה מ-${customer.full_name}`,
            content: activityContent,
            attachments: attachments
        });
        console.log("📝 Activity created for incoming message/media");

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });

    } catch (error) {
        console.error('💥 WEBHOOK CRITICAL ERROR:', error);
        return new Response(JSON.stringify({ ok: true, error: "Internal processing failed" }), { status: 200, headers: corsHeaders });
    }
});