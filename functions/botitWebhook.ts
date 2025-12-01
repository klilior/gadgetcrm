import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    console.log('🔔 [Webhook] Received webhook from Bot.it');

    try {
        const payload = await req.json();
        console.log('📦 [Webhook] Raw payload:', JSON.stringify(payload, null, 2));

        // Log webhook
        try {
            await base44.asServiceRole.entities.WebhookLog.create({
                source: 'botit',
                payload: payload,
                headers: Object.fromEntries(req.headers.entries())
            });
        } catch (logError) {
            console.error('⚠️ Failed to log webhook:', logError);
        }

        // Extract message data
        // Try multiple fields for phone number
        const senderPhone = payload.phone || payload.sender || payload.from || payload.wa_id;
        const messageText = payload.message || payload.text || payload.body || '';
        const messageType = payload.type || (payload.media ? 'media' : 'text');
        
        console.log('📱 [Webhook] Sender:', senderPhone);
        console.log('💬 [Webhook] Message:', messageText);

        if (!senderPhone) {
            console.error('❌ [Webhook] No sender phone found in payload');
            return Response.json({ success: false, error: 'No sender phone' });
        }

        // Normalize phone number logic - Robust version
        const normalizePhone = (phone) => {
            if (!phone) return '';
            let clean = phone.toString().replace(/\D/g, '');
            // Remove 972 prefix if exists at start
            if (clean.startsWith('972')) {
                clean = '0' + clean.substring(3);
            }
            // Ensure starts with 0 if length is 9 and starts with 5
            if (clean.length === 9 && clean.startsWith('5')) {
                clean = '0' + clean;
            }
            return clean;
        };

        const cleanPhone = normalizePhone(senderPhone);
        console.log('🔍 [Webhook] Cleaned phone for search:', cleanPhone);

        // Find customer by phone - use contains search to handle all formats
        console.log('🔍 [Webhook] Searching for customer with phone containing:', cleanPhone.slice(-9));
        
        // Get all clients and filter by phone (contains the last 9 digits)
        const allClients = await base44.asServiceRole.entities.Client.list('-created_date', 500);
        const phoneDigits = cleanPhone.replace(/\D/g, '').slice(-9); // Last 9 digits without leading 0
        
        let customers = allClients.filter(c => {
            if (!c.phone) return false;
            const clientPhoneDigits = c.phone.replace(/\D/g, '').slice(-9);
            return clientPhoneDigits === phoneDigits;
        });
        
        // Sort by created_date to get the oldest (original) customer first
        customers.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        
        console.log(`🔍 [Webhook] Found ${customers.length} matching customers`);
        if (customers.length > 0) {
            console.log('📋 [Webhook] Matching customers:', customers.map(c => ({ id: c.id, name: c.full_name, phone: c.phone })));
        }

        let customer;
        if (customers.length === 0) {
            console.log('➕ [Webhook] Creating new customer');
            customer = await base44.asServiceRole.entities.Client.create({
                full_name: payload.name || cleanPhone,
                phone: cleanPhone,
                preferred_channel: 'whatsapp'
            });
            console.log('✅ [Webhook] Customer created:', customer.id);
        } else {
            customer = customers[0];
            console.log('✅ [Webhook] Found existing customer:', customer.id);
            
            // "Touch" the customer to update the updated_date, ensuring they appear at the top of lists
            try {
                await base44.asServiceRole.entities.Client.update(customer.id, {
                    // We just update a field with its own value or a timestamp if we had one
                    // Since we don't have a 'last_active' field, we'll just do a dummy update
                    notes: customer.notes || '' 
                });
            } catch (e) {
                console.log('⚠️ Failed to touch customer:', e.message);
            }
        }

        // Find existing conversation
        // We fetch the most recently updated conversation for this customer
        const conversations = await base44.asServiceRole.entities.Conversation.filter(
            { customer_id: customer.id }, 
            '-last_message_date', 
            1
        );

        let conversation;
        const now = new Date().toISOString();

        if (conversations.length > 0) {
            conversation = conversations[0];
            const currentUnread = conversation.unread_count || 0;
            
            console.log(`🔄 [Webhook] Updating existing conversation ${conversation.id}`);
            
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                last_message: messageText || (messageType === 'media' ? '[מדיה]' : '[הודעה ללא טקסט]'),
                last_message_date: now,
                last_channel: 'whatsapp',
                unread_count: currentUnread + 1,
                // Re-open if closed
                ...(conversation.status === 'סגור' || conversation.status === 'closed' ? { status: 'פתוח' } : {})
            });
        } else {
            console.log('➕ [Webhook] Creating new conversation');
            conversation = await base44.asServiceRole.entities.Conversation.create({
                customer_id: customer.id,
                last_message: messageText || (messageType === 'media' ? '[מדיה]' : '[הודעה ללא טקסט]'),
                last_message_date: now,
                last_channel: 'whatsapp',
                unread_count: 1,
                status: 'פתוח'
            });
        }

        // Create activity
        console.log('💾 [Webhook] Creating activity');
        
        const activityData = {
            order_id: customer.id, // Using order_id as customer_id link based on app convention
            activity_type: 'וואטסאפ נכנס',
            summary: `הודעה מ-${customer.full_name || cleanPhone}`,
            content: messageText || (messageType === 'media' ? '[קובץ מצורף]' : '[הודעה ללא טקסט]'),
            thread_id: conversation.id,
            attachments: payload.media ? [payload.media] : (payload.file_url ? [payload.file_url] : []),
            read_by: []
        };

        const activity = await base44.asServiceRole.entities.Activity.create(activityData);
        console.log('✅ [Webhook] Activity created:', activity.id);

        return Response.json({
            success: true,
            message: 'Webhook processed successfully',
            activity_id: activity.id,
            conversation_id: conversation.id,
            customer_id: customer.id
        });

    } catch (error) {
        console.error('❌ [Webhook] Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});