import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function stripHtml(html) {
    if (!html) return '';
    let text = html.replace(/<[^>]*>/g, '');
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&apos;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

function normalizePhone(phone) {
    if (!phone) return "";
    let clean = phone.replace(/\D/g, "");
    if (/^05\d{8}$/.test(clean)) {
        clean = "972" + clean.slice(1);
    } else if (/^0\d{8,9}$/.test(clean)) {
        clean = "972" + clean.slice(1);
    }
    return clean;
}

function extractPhoneFromText(text) {
    if (!text) return [];
    const phonePatterns = [
        /(?:972[-\s]?)?0?5[0-9][-\s]?\d{3}[-\s]?\d{4}/g,
        /(?:972[-\s]?)?0?[2-4,8-9][0-9][-\s]?\d{3}[-\s]?\d{4}/g,
        /\b\d{2,3}[-\s]?\d{7,8}\b/g
    ];
    const phones = [];
    phonePatterns.forEach(pattern => {
        const matches = text.match(pattern) || [];
        matches.forEach(match => {
            const normalized = normalizePhone(match);
            if (normalized && normalized.length >= 9) {
                phones.push(normalized);
            }
        });
    });
    return [...new Set(phones)];
}

function extractOrderNumberFromText(text) {
    if (!text) return [];
    const orderPatterns = [
        /(?:הזמנה|order|מספר הזמנה)[\s#:]*(\d{3,8})/gi,
        /(?:order|הזמנה)[\s]*[#]?[\s]*(\d{3,8})/gi,
        /#(\d{3,8})/g,
        /\b(\d{4,8})\b/g
    ];
    const orderNumbers = [];
    orderPatterns.forEach(pattern => {
        const matches = Array.from(text.matchAll(pattern));
        matches.forEach(match => {
            if (match[1] && match[1].length >= 3) {
                orderNumbers.push(match[1]);
            }
        });
    });
    return [...new Set(orderNumbers)];
}

async function findCustomerByMultipleMethods(base44, emailAddress, emailContent) {
    let customer = (await base44.asServiceRole.entities.Client.filter({ 
        email: emailAddress 
    }))[0];
    
    if (customer) {
        console.log(`Found client by email: ${customer.id}`);
        return customer;
    }

    const phonesInContent = extractPhoneFromText(emailContent);
    for (const phone of phonesInContent) {
        const normalizedPhone = normalizePhone(phone);
        if (normalizedPhone) {
            const clients = await base44.asServiceRole.entities.Client.filter({ 
                phone: normalizedPhone
            });
            if (clients.length > 0) {
                customer = clients[0];
                console.log(`Found client by phone: ${customer.id}`);
                return customer;
            }
        }
    }

    const orderNumbers = extractOrderNumberFromText(emailContent);
    for (const orderNum of orderNumbers) {
        const orders = await base44.asServiceRole.entities.Order.filter({ 
            external_order_number: orderNum 
        });
        if (orders.length > 0 && orders[0].customer_id) {
            const orderClient = await base44.asServiceRole.entities.Client.get(orders[0].customer_id);
            if (orderClient) {
                console.log(`Found client by order number: ${orderClient.id}`);
                return orderClient;
            }
        }
    }

    return null;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const payload = await req.json();
        const { from, subject, threadId, plain, html, attachments, messageId, inReplyTo, references } = payload;
        
        let emailAddress = from;
        const emailMatch = from.match(/<(.+)>/);
        if (emailMatch && emailMatch[1]) {
            emailAddress = emailMatch[1];
        }
        emailAddress = emailAddress.trim().toLowerCase();
        
        console.log(`📧 Processing email from: ${emailAddress}, Message-ID: ${messageId}`);

        // 🛡️ בדיקה 1: האם זה מייל מהמערכת עצמה?
        if (emailAddress.includes('@gadget-team.co.il')) {
            console.log(`⚠️ Ignoring email from our own domain: ${emailAddress}`);
            return new Response(JSON.stringify({ 
                success: true, 
                message: 'Ignored - email from own domain' 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 🛡️ בדיקה 2: האם ה-messageId כבר עובד?
        if (messageId) {
            const existingWebhookLog = await base44.asServiceRole.entities.WebhookLog.filter({
                source: 'gmail',
                'payload.messageId': messageId
            });
            
            if (existingWebhookLog.length > 0) {
                console.log(`⚠️ Message already processed: ${messageId}`);
                return new Response(JSON.stringify({ 
                    success: true, 
                    message: 'Already processed',
                    existingLog: existingWebhookLog[0].id
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // ✅ שמור log שההודעה התקבלה
            await base44.asServiceRole.entities.WebhookLog.create({
                source: 'gmail',
                payload: { messageId, from: emailAddress, subject, threadId },
                headers: {}
            });
            console.log(`✅ Saved webhook log for messageId: ${messageId}`);
        }
        
        let senderName = from.split('<')[0].trim();
        if (senderName.includes('@')) {
            senderName = emailAddress.split('@')[0];
        }

        const cleanContent = plain || stripHtml(html) || 'תוכן אימייל ריק';

        // חיפוש טיקט קיים
        let ticket = null;
        
        // 1. חפש לפי In-Reply-To
        if (inReplyTo && !ticket) {
            const existingTickets = await base44.asServiceRole.entities.Ticket.filter({
                email_message_id: inReplyTo
            }, '-created_date', 1);
            
            if (existingTickets.length > 0) {
                ticket = existingTickets[0];
                console.log(`✅ Found existing ticket by In-Reply-To: ${ticket.id}`);
            }
        }
        
        // 2. חפש לפי thread_id
        if (threadId && !ticket) {
            const threadTickets = await base44.asServiceRole.entities.Ticket.filter({
                thread_id: threadId
            }, '-created_date', 1);
            
            if (threadTickets.length > 0) {
                ticket = threadTickets[0];
                console.log(`✅ Found existing ticket by thread_id: ${ticket.id}`);
            }
        }

        // מצא או צור לקוח
        let customer = await findCustomerByMultipleMethods(base44, emailAddress, cleanContent + ' ' + subject);
        
        // 3. אם עדיין אין טיקט - חפש לפי לקוח + סטטוס פתוח
        if (customer && !ticket) {
            const customerTickets = await base44.asServiceRole.entities.Ticket.filter({
                customer_id: customer.id,
                status: { $nin: ["נסגר", "נסגר ללא מענה"] },
                contact_channel: "email"
            }, '-updated_date', 1);
            
            if (customerTickets.length > 0) {
                ticket = customerTickets[0];
                console.log(`✅ Found open ticket for customer: ${ticket.id}`);
            }
        }
        
        if (!customer) {
            const existingByEmail = await base44.asServiceRole.entities.Client.filter({ email: emailAddress });
            if (existingByEmail.length > 0) {
                customer = existingByEmail[0];
                console.log(`Found existing client: ${customer.id}`);
            } else {
                customer = await base44.asServiceRole.entities.Client.create({
                    full_name: senderName,
                    email: emailAddress,
                    preferred_channel: 'email',
                });
                console.log(`Created new client: ${customer.id}`);
            }
        }

        let isNewTicket = false;
        if (ticket) {
            console.log(`Appending message to existing ticket: ${ticket.id}`);
            
            // פתח טיקט סגור מחדש
            if (ticket.status === "נסגר" || ticket.status === "נסגר ללא מענה") {
                await base44.asServiceRole.entities.Ticket.update(ticket.id, {
                    status: 'בטיפול'
                });
                console.log(`🔓 Reopened closed ticket: ${ticket.id}`);
            }
            
            // הוסף פעילות
            await base44.asServiceRole.entities.Activity.create({
                summary: `הודעת מייל נכנסת: ${subject}`,
                activity_type: 'מייל נכנס',
                content: cleanContent,
                ticket_id: ticket.id,
                email_subject: subject,
                email_message_id: messageId,
                attachments: attachments || []
            });
            
            // עדכן את ה-references
            const newReferences = ticket.email_references 
                ? `${ticket.email_references} ${messageId}`
                : (references || messageId);
            
            await base44.asServiceRole.entities.Ticket.update(ticket.id, { 
                email_references: newReferences,
                email_message_id: messageId,
                status: ticket.status === 'ממתין ללקוח' ? 'בטיפול' : ticket.status
            });
            
        } else {
            console.log('Creating new ticket from email');
            isNewTicket = true;
            const slaTarget = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
            const lastTickets = await base44.asServiceRole.entities.Ticket.filter({}, "-ticket_number", 1);
            const newTicketNumber = (lastTickets[0]?.ticket_number || 1000) + 1;

            ticket = await base44.asServiceRole.entities.Ticket.create({
                subject: subject || 'ללא נושא',
                ticket_number: newTicketNumber,
                customer_id: customer.id,
                contact_channel: 'email',
                last_channel: 'email',
                source: 'email',
                status: 'חדש',
                description: cleanContent,
                thread_id: threadId,
                email_message_id: messageId,
                email_references: references || messageId,
                sla_target: slaTarget,
                sla_plan: 'שירות'
            });

            await base44.asServiceRole.entities.Activity.create({
                summary: `טיקט חדש נוצר ממייל: ${subject}`,
                activity_type: 'מייל נכנס',
                content: cleanContent,
                ticket_id: ticket.id,
                email_subject: subject,
                email_message_id: messageId,
                attachments: attachments || []
            });

            // הקצאה אוטומטית
            try {
                await base44.asServiceRole.functions.invoke('assignTicketRoundRobin', { ticketId: ticket.id });
            } catch (assignError) {
                console.error(`Failed to auto-assign ticket ${ticket.id}:`, assignError);
            }
        }

        // מענה אוטומטי רק לטיקטים חדשים
        if (isNewTicket) {
            const autoReplySetting = (await base44.asServiceRole.entities.Settings.filter({ setting_name: 'AUTO_REPLY_EMAIL' }))[0];
            if (autoReplySetting?.setting_value === 'ON') {
                console.log(`Sending auto-reply for new ticket ${ticket.id}`);
                const templateSetting = (await base44.asServiceRole.entities.Settings.filter({ setting_name: 'EMAIL_AUTOREPLY_TEMPLATE' }))[0];
                
                let body = templateSetting?.setting_value || 'תודה על פנייתך, קיבלנו את הודעתך ונטפל בה בהקדם.';
                
                await base44.asServiceRole.functions.invoke('sendEmail', {
                    to: emailAddress,
                    subject: `Re: ${subject}`,
                    body: body,
                    ticketId: ticket.id
                });
            }
        }

        return new Response(JSON.stringify({ success: true, ticketId: ticket.id, isNew: isNewTicket }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Gmail Webhook Error:', error.message, error.stack);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});