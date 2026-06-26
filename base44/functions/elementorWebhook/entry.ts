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

        // Ticket creation is temporarily frozen. Keep the lead/contact as a customer activity only.
        await base44.asServiceRole.entities.Activity.create({
            summary: `טופס מהאתר: ${inquirySubjectRaw}`,
            activity_type: 'מייל נכנס',
            content: `שם: ${customerName}\nטלפון: ${customerPhone}\nאימייל: ${customerEmail}\n\nבחירה בטופס: ${inquirySubjectRaw}\nהודעה:\n${message}`,
            order_id: customer.id
        });
        console.log('Ticket creation frozen; activity logged only.');

        return new Response(JSON.stringify({ success: true, message: "הטופס התקבל. יצירת טיקטים מוקפאת כרגע." }), { status: 200 });

    } catch (error) {
        console.error('!!! CRITICAL ERROR in elementorWebhook !!!', error.message, error.stack);
        return new Response(JSON.stringify({ success: true, message: "הטופס התקבל במערכת לעיבוד." }), { status: 200 });
    }
});