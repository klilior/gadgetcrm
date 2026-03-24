import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { to, subject, body, ticketId, attachments = [] } = await req.json();
        
        console.log("📧 Email request:", { to, subject, ticketId, hasAttachments: attachments.length > 0 });
        
        const user = await base44.auth.me().catch(() => null);
        
        const resendKeySetting = (await base44.asServiceRole.entities.Settings.filter({ 
            setting_name: 'RESEND_API_KEY' 
        }))[0];
        
        if (!resendKeySetting?.setting_value) {
            throw new Error('RESEND_API_KEY לא נמצא בהגדרות המערכת.');
        }
        
        const resendApiKey = resendKeySetting.setting_value;
        
        // טען את הטיקט ואת ההיסטוריה
        let ticket = null;
        let inReplyTo = null;
        let references = null;
        let emailHistory = '';
        
        if (ticketId) {
            try {
                ticket = await base44.asServiceRole.entities.Ticket.get(ticketId);
                if (ticket.email_message_id) {
                    inReplyTo = ticket.email_message_id;
                }
                if (ticket.email_references) {
                    references = ticket.email_references;
                }
                
                // טען את כל הפעילויות של הטיקט (לא רק מייל!)
                const activities = await base44.asServiceRole.entities.Activity.filter({
                    ticket_id: ticketId
                }, 'created_date', 50);
                
                // בנה היסטוריית שיחה מלאה
                if (activities.length > 0) {
                    emailHistory = '\n\n' + '═'.repeat(60) + '\n';
                    emailHistory += '📜 היסטוריית התכתבות:\n';
                    emailHistory += '═'.repeat(60) + '\n\n';
                    
                    activities.forEach(activity => {
                        const date = new Date(activity.created_date);
                        const dateStr = date.toLocaleString('he-IL', { 
                            timeZone: 'Asia/Jerusalem',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        
                        // זהה מי שלח
                        let from = '';
                        let icon = '';
                        if (activity.activity_type === 'מייל יוצא' || activity.activity_type === 'וואטסאפ יוצא') {
                            from = 'Gadget Team';
                            icon = '👨‍💼';
                        } else if (activity.activity_type === 'מייל נכנס' || activity.activity_type === 'וואטסאפ נכנס') {
                            from = 'אתה';
                            icon = '👤';
                        } else if (activity.activity_type === 'הערה') {
                            from = 'הערת נציג';
                            icon = '📝';
                        } else {
                            from = activity.activity_type;
                            icon = '📌';
                        }
                        
                        emailHistory += `${icon} ${from} | ${dateStr}\n`;
                        
                        if (activity.email_subject) {
                            emailHistory += `נושא: ${activity.email_subject}\n`;
                        }
                        
                        emailHistory += `${activity.content}\n`;
                        
                        if (activity.attachments && activity.attachments.length > 0) {
                            emailHistory += `📎 קבצים מצורפים: ${activity.attachments.length}\n`;
                        }
                        
                        emailHistory += '\n' + '─'.repeat(60) + '\n\n';
                    });
                }
            } catch (error) {
                console.warn('Could not load ticket history:', error);
            }
        }
        
        // בנה את תוכן המייל
        let emailBody = body;
        
        // הוסף קבצים מצורפים
        if (attachments.length > 0) {
            emailBody += '\n\n📎 קבצים מצורפים:\n';
            attachments.forEach((url, index) => {
                const fileName = url.split('/').pop() || `קובץ ${index + 1}`;
                emailBody += `${index + 1}. ${fileName}: ${url}\n`;
            });
        }
        
        // הוסף היסטוריה
        emailBody += emailHistory;
        
        // הוסף פרטי טיקט בתחתית
        if (ticket) {
            emailBody += '\n\n' + '═'.repeat(60) + '\n';
            emailBody += `📋 פרטי הפנייה שלך:\n`;
            emailBody += `מספר טיקט: #${ticket.ticket_number}\n`;
            emailBody += `נושא: ${ticket.subject}\n`;
            if (ticket.order_number) {
                emailBody += `מספר הזמנה: ${ticket.order_number}\n`;
            }
            emailHistory += '═'.repeat(60) + '\n';
            emailBody += '\n💬 יש לך שאלה נוספת? פשוט ענה למייל זה ונחזור אליך בהקדם!\n';
            emailBody += '📱 מעדיף וואטסאפ? 054-123-4567\n';
        }
        
        // צור Message-ID ייחודי
        const messageId = `<${Date.now()}.${Math.random().toString(36).substring(7)}@gadget-team.co.il>`;
        
        // בנה את הבקשה ל-Resend
        const emailPayload = {
            from: 'Gadget Team - תמיכה <service@gadget-team.co.il>',
            to: [to],
            subject: subject,
            text: emailBody,
            reply_to: 'service@gadget-team.co.il',
            headers: {
                'Message-ID': messageId
            }
        };
        
        // הוסף כותרות שרשור אם יש
        if (inReplyTo) {
            emailPayload.headers['In-Reply-To'] = inReplyTo;
        }
        if (references) {
            emailPayload.headers['References'] = `${references} ${messageId}`;
        } else {
            emailPayload.headers['References'] = messageId;
        }
        
        console.log('📤 Sending email via Resend...');
        
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(emailPayload)
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Resend API Error:', data);
            throw new Error(`Resend API error: ${data.message || 'Unknown error'}`);
        }

        console.log('✅ Email sent successfully:', data.id);

        // עדכן את הטיקט
        if (ticket) {
            const newReferences = references ? `${references} ${messageId}` : messageId;
            
            await base44.asServiceRole.entities.Ticket.update(ticket.id, {
                email_message_id: messageId,
                email_references: newReferences,
                last_channel: 'email',
                status: 'ממתין ללקוח'
            });

            // צור פעילות
            await base44.asServiceRole.entities.Activity.create({
                summary: 'מייל נשלח ללקוח',
                activity_type: 'מייל יוצא',
                content: body,
                ticket_id: ticket.id,
                agent_id: user?.id || null,
                email_subject: subject,
                email_message_id: messageId,
                attachments: attachments.length > 0 ? attachments : undefined
            });
        }

        return new Response(JSON.stringify({ 
            success: true, 
            emailId: data.id,
            messageId: messageId
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Error sending email:', error);
        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});