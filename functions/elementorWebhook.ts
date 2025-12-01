
import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

function normalizePhone(phone) {
    if (!phone) return "";
    let s = phone.replace(/\s|-/g, "").replace(/^\+/, "");
    // Check for Israeli mobile numbers starting with '05' or landlines starting with '0', exactly 10 digits
    // And convert them to international format if they are.
    if (/^0\d{9}$/.test(s)) { // Matches 05X-XXXXXXX or 0X-XXXXXXX (10 digits total)
        s = "972" + s.slice(1);
    }
    return s;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    console.log('=== Elementor Webhook Received ===');

    try {
        const bodyText = await req.text();
        let formData = {};
        
        try {
            const params = new URLSearchParams(bodyText);
            let isFormData = false;
            params.forEach((value, key) => {
                isFormData = true;
                formData[key] = value;
            });
            if (!isFormData && bodyText.trim().startsWith('{')) { // Only try JSON if it looks like JSON
                formData = JSON.parse(bodyText);
            }
        } catch (e) {
             console.error("Could not parse body. Raw body:", bodyText, "Error:", e);
             formData = {};
        }

        console.log('Parsed Data:', JSON.stringify(formData, null, 2));

        // Updated mapping to prioritize Hebrew keys from your logs
        const customerName = formData['שם'] || formData.name || '';
        const customerPhone = formData['טלפון'] || formData.phone || '';
        const customerEmail = formData['אימייל'] || formData.email || '';
        const inquirySubjectRaw = formData['בחר נושא פניה'] || formData.subject || formData.form_name || 'פנייה חדשה מהאתר';
        const message = formData['הודעה'] || formData.message || '';

        console.log('--- Extracted Details ---');
        console.log(`Name: ${customerName}, Phone: ${customerPhone}, Email: ${customerEmail}`);
        console.log(`Raw Subject: ${inquirySubjectRaw}, Message: ${message}`);
        
        if (!customerName && !customerPhone && !customerEmail) {
            console.warn('Webhook data is missing all customer identifiers. Ignoring.');
            return new Response(JSON.stringify({ success: true, message: "Webhook received but ignored (no customer data)." }), { status: 200 });
        }
        
        // --- De-duplication Logic ---
        const normalizedPhone = normalizePhone(customerPhone);
        const normalizedEmail = (customerEmail || '').toLowerCase().trim();
        
        let customer;
        if (normalizedPhone) {
            const existingByPhone = await base44.asServiceRole.entities.Client.filter({ phone: normalizedPhone });
            customer = existingByPhone[0];
            if (customer) {
                console.log(`Found existing customer by phone: ${customer.id}`);
            }
        }
        
        if (!customer && normalizedEmail) {
            const existingByEmail = await base44.asServiceRole.entities.Client.filter({ email: normalizedEmail });
            customer = existingByEmail[0];
            if (customer) {
                console.log(`Found existing customer by email: ${customer.id}`);
            }
        }

        if (!customer) {
            customer = await base44.asServiceRole.entities.Client.create({
                full_name: customerName || `לקוח מ-${inquirySubjectRaw}`,
                phone: normalizedPhone || null,
                email: normalizedEmail || null,
                preferred_channel: 'website',
            });
            console.log('New customer created:', customer.id);
        } else {
            console.log('Found existing customer:', customer.id);
            // Optional: Update existing customer details if they are different and new values are provided
            const updates = {};
            if (!customer.full_name && customerName) updates.full_name = customerName;
            if (!customer.phone && normalizedPhone) updates.phone = normalizedPhone;
            if (!customer.email && normalizedEmail) updates.email = normalizedEmail;
            
            if (Object.keys(updates).length > 0) {
                await base44.asServiceRole.entities.Client.update(customer.id, updates);
                console.log(`Updated customer ${customer.id} with new details: ${JSON.stringify(updates)}.`);
                // Refresh customer object after update if needed for subsequent operations
                // customer = { ...customer, ...updates }; // Not strictly necessary here as we only use customer.id
            }
        }
        // --- End De-duplication Logic ---

        // **מנגנון למניעת כפלים - בדיקה אם כבר קיים טיקט דומה באותו יום**
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingTodayTickets = await base44.asServiceRole.entities.Ticket.filter({
            customer_id: customer.id,
            created_date: {
                $gte: today.toISOString(),
                $lt: tomorrow.toISOString()
            }
        });

        // בדיקה אם יש טיקט עם תוכן דומה שנוצר בשעה האחרונה
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentSimilarTickets = existingTodayTickets.filter(ticket => {
            const ticketCreated = new Date(ticket.created_date);
            const isSameSubject = ticket.subject === (inquirySubjectRaw === 'sales' ? 'מכירות' : 'שירות'); // Simplified based on later logic
            const isRecent = ticketCreated > oneHourAgo;
            const hasSimilarContent = ticket.description && message && 
                (ticket.description.includes(message.substring(0, Math.min(message.length, 50))) || 
                 message.includes(ticket.description.substring(0, Math.min(ticket.description.length, 50))));
            
            return isSameSubject && isRecent && (hasSimilarContent || message.length < 10);
        });

        if (recentSimilarTickets.length > 0) {
            console.log(`מניעת כפל טיקט: נמצא טיקט דומה שנוצר לאחרונה עבור ${customerName}. מזהה טיקט: ${recentSimilarTickets[0].id}`);
            return new Response(JSON.stringify({ 
                success: true, 
                message: "הטופס התקבל במערכת (זוהה כטיקט קיים).",
                duplicate_prevented: true,
                existing_ticket_id: recentSimilarTickets[0].id
            }), { status: 200 });
        }

        // NEW UNIFIED LOGIC: Determine if it's Sales or Service
        let ticketSubject = "שירות";
        let inquiryType = "שירות לקוחות";
        let priority = "בינונית";
        
        const subjectAndMessage = `${inquirySubjectRaw} ${message}`.toLowerCase();
        
        // Check for sales indicators
        if (inquirySubjectRaw === 'sales' || 
            subjectAndMessage.includes("מכירה") || 
            subjectAndMessage.includes("רכישה") || 
            subjectAndMessage.includes("מחיר") ||
            subjectAndMessage.includes("קנייה") ||
            subjectAndMessage.includes("הצעת מחיר")) {
            ticketSubject = "מכירות";
            inquiryType = "חקירת מכירה";
            priority = "גבוהה";
        }
        
        // Check for service indicators  
        if (inquirySubjectRaw === 'service' ||
            subjectAndMessage.includes("שירות") ||
            subjectAndMessage.includes("תיקון") ||
            subjectAndMessage.includes("בעיה") ||
            subjectAndMessage.includes("לא עובד")) {
            ticketSubject = "שירות";
            inquiryType = "שירות ואחריות";  
            priority = "גבוהה";
        }

        console.log(`Final ticket subject: ${ticketSubject}, Type: ${inquiryType}`);

        // Get the highest ticket number and add 1
        const lastTickets = await base44.asServiceRole.entities.Ticket.filter({}, "-ticket_number", 1);
        const newTicketNumber = (lastTickets[0]?.ticket_number || 1000) + 1;

        // Create ticket
        const slaHours = 4;
        const newTicket = await base44.asServiceRole.entities.Ticket.create({
            ticket_number: newTicketNumber,
            subject: ticketSubject,
            customer_id: customer.id,
            contact_channel: "website",
            source: "אתר",
            inquiry_type: inquiryType,
            priority: priority,
            status: "חדש",
            description: message || `פנייה דרך טופס: ${inquirySubjectRaw}`,
            sla_target: new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString()
        });
        console.log('Ticket created successfully:', newTicket.id);

        // Create associated activity
        await base44.asServiceRole.entities.Activity.create({
            summary: `טופס מהאתר: ${ticketSubject}`,
            activity_type: 'מייל נכנס',
            content: `שם: ${customerName}\nטלפון: ${customerPhone}\nאימייל: ${customerEmail}\n\nבחירה בטופס: ${inquirySubjectRaw}\nהודעה:\n${message}`,
            ticket_id: newTicket.id
        });
        console.log('Activity logged for new ticket.');

        return new Response(JSON.stringify({ success: true, message: "הטופס נשלח וטיקט נוצר בהצלחה!" }), { status: 200 });

    } catch (error) {
        console.error('!!! CRITICAL ERROR in elementorWebhook !!!', error.message, error.stack);
        return new Response(JSON.stringify({ success: true, message: "הטופס התקבל במערכת לעיבוד." }), { status: 200 });
    }
});
