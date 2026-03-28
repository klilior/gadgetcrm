import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    console.log('📤 [SendWhatsapp] START');
    
    try {
        const body = await req.json();
        console.log('📦 Body:', JSON.stringify(body, null, 2));
        
        const { to, messageObject } = body;

        if (!to || !messageObject) {
            console.error('❌ Missing required fields: to or messageObject');
            return Response.json({ 
                success: false, 
                message: 'חסרים שדות נדרשים (to/messageObject)' 
            });
        }

        // Get active provider
        console.log('🔍 Fetching active WhatsApp provider...');
        const providers = await base44.asServiceRole.entities.WhatsappProvider.filter({ 
            is_active: true 
        });
        
        if (!providers || providers.length === 0) {
            console.error('❌ No active WhatsApp provider found');
            return Response.json({ 
                success: false, 
                error_type: 'no_provider',
                message: 'אין ספק וואטסאפ פעיל במערכת. אנא הגדר ספק פעיל בהגדרות.' 
            });
        }

        const provider = providers[0];
        console.log('✅ Found provider:', provider.name);
        
        const apiKey = provider.config?.apiKey;
        const senderPhone = provider.config?.senderPhone || provider.phone_number;
        
        if (!apiKey) {
            console.error('❌ API Key missing in provider config');
            return Response.json({ 
                success: false, 
                error_type: 'missing_api_key',
                message: 'חסר API Key בהגדרות הספק. אנא עדכן בהגדרות.' 
            });
        }

        if (!senderPhone) {
            console.error('❌ Sender phone missing');
            return Response.json({ 
                success: false, 
                error_type: 'missing_sender',
                message: 'חסר מספר שולח בהגדרות הספק.' 
            });
        }

        // Clean phone numbers
        let cleanTo = to.replace(/\D/g, '');
        if (cleanTo.startsWith('0')) {
            cleanTo = '972' + cleanTo.substring(1);
        } else if (!cleanTo.startsWith('972')) {
            cleanTo = '972' + cleanTo;
        }
        
        let cleanFrom = senderPhone.replace(/\D/g, '');
        if (cleanFrom.startsWith('0')) {
            cleanFrom = '972' + cleanFrom.substring(1);
        } else if (!cleanFrom.startsWith('972')) {
            cleanFrom = '972' + cleanFrom;
        }
        
        console.log('📞 From:', cleanFrom, 'To:', cleanTo);
        
        // Prepare message payload for Bot.it QR API
        let messageContent = '';
        let payload = {
            token: apiKey,
            from: cleanFrom,
            to: cleanTo,
            requestType: 'string',
            messageType: 'text'
        };
        
        if (messageObject.type === 'text') {
            messageContent = messageObject.text?.body || '';
            payload.messageType = 'text';
            payload.text = messageContent;
        } else if (messageObject.type === 'image') {
            messageContent = messageObject.image?.caption || '[תמונה]';
            payload.messageType = 'image';
            payload.imageUrl = messageObject.image?.link;
            if (messageContent && messageContent !== '[תמונה]') {
                payload.caption = messageContent;
            }
        } else if (messageObject.type === 'document') {
            messageContent = messageObject.document?.filename || '[מסמך]';
            payload.messageType = 'document';
            payload.docUrl = messageObject.document?.link;
            if (messageContent && messageContent !== '[מסמך]') {
                payload.caption = messageContent;
            }
        } else if (messageObject.type === 'audio') {
            messageContent = '[הודעה קולית]';
            payload.messageType = 'audio';
            payload.aacUrl = messageObject.audio?.link;
        } else if (messageObject.type === 'video') {
            messageContent = '[וידאו]';
            payload.messageType = 'video';
            payload.videoUrl = messageObject.video?.link;
            if (messageObject.video?.caption) {
                payload.caption = messageObject.video.caption;
            }
        }

        console.log('📨 Sending message via Bot.it QR API');
        console.log('📦 Payload:', JSON.stringify(payload, null, 2));
        
        // Send to Bot.it QR API
        const response = await fetch('https://botit.to/api/qr/rest/send_message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('📡 Bot.it Response Status:', response.status);
        console.log('📡 Bot.it Response:', responseText);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            result = { raw: responseText };
        }

        // Check for errors
        if (response.status !== 200) {
            console.error('❌ Bot.it returned non-200 status:', response.status);
            return Response.json({ 
                success: false,
                error_type: 'bot_it_error',
                message: result.message || result.error || `שגיאת שרת Bot.it (${response.status})` 
            });
        }

        if (result.error) {
            console.error('❌ Bot.it returned error:', result.error);
            return Response.json({ 
                success: false,
                error_type: 'bot_it_error',
                message: result.error 
            });
        }

        if (result.message?.includes('No active')) {
            console.error('❌ No active WhatsApp instance on Bot.it');
            return Response.json({ 
                success: false,
                error_type: 'bot_it_error',
                message: 'אין מספר וואטסאפ פעיל ב-Bot.it. אנא חבר מספר בפורטל של Bot.it.' 
            });
        }

        console.log('✅ Message sent successfully via Bot.it');

        // Save activity if ticket_id exists - CRITICAL SECTION
        if (messageObject.ticket_id) {
            try {
                console.log('💾 Saving activity for ticket:', messageObject.ticket_id);
                
                let currentUser = null;
                try {
                    currentUser = await base44.auth.me();
                    console.log('👤 Current user:', currentUser?.email);
                } catch (e) {
                    console.log('⚠️ No authenticated user, activity will be saved without agent');
                }
                
                const activityData = {
                    ticket_id: messageObject.ticket_id,
                    activity_type: 'וואטסאפ יוצא',
                    summary: `הודעה נשלחה ל-${to}`,
                    content: messageContent,
                    agent_id: currentUser?.id || null,
                    thread_id: result?.id || `out_${Date.now()}`
                };
                
                console.log('📝 Activity data:', JSON.stringify(activityData, null, 2));
                
                const activity = await base44.asServiceRole.entities.Activity.create(activityData);
                
                console.log('✅ Activity saved with ID:', activity.id);

                // Update ticket
                await base44.asServiceRole.entities.Ticket.update(messageObject.ticket_id, {
                    last_channel: 'whatsapp',
                    status: 'ממתין ללקוח'
                });
                
                console.log('✅ Ticket updated');
            } catch (actError) {
                console.error('❌ Failed to save activity/update ticket:', actError.message);
                console.error('Stack:', actError.stack);
                // Don't fail the whole request if activity save fails
            }
        } else {
            console.log('⚠️ No ticket_id provided, skipping activity save');
        }

        return Response.json({ 
            success: true, 
            message: 'ההודעה נשלחה בהצלחה',
            messageId: result?.id
        });

    } catch (error) {
        console.error('❌ Unexpected error in sendWhatsapp:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({ 
            success: false,
            error_type: 'server_error',
            message: 'שגיאת שרת: ' + error.message 
        }, { status: 500 });
    }
});