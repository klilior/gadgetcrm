import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verify user is authenticated
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { phone, full_name, email, city, full_address, preferred_channel, notes, woo_customer_id } = await req.json();

        if (!phone) {
            return Response.json({ error: 'Phone number is required' }, { status: 400 });
        }

        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizedPhone = phone.replace(/\D/g, '');

        // Search for existing client by phone
        let existingClients = await base44.entities.Client.filter({ phone: phone });
        
        // If not found, try with normalized phone
        if (existingClients.length === 0) {
            const allClients = await base44.entities.Client.list();
            existingClients = allClients.filter(c => {
                if (!c.phone) return false;
                const clientNormalizedPhone = c.phone.replace(/\D/g, '');
                return clientNormalizedPhone === normalizedPhone;
            });
        }

        if (existingClients.length > 0) {
            // Client exists - return the first one
            const existingClient = existingClients[0];
            
            // Optionally update missing fields if new data is provided
            const updates = {};
            if (full_name && !existingClient.full_name) updates.full_name = full_name;
            if (email && !existingClient.email) updates.email = email;
            if (city && !existingClient.city) updates.city = city;
            if (full_address && !existingClient.full_address) updates.full_address = full_address;
            if (preferred_channel && !existingClient.preferred_channel) updates.preferred_channel = preferred_channel;
            if (woo_customer_id && !existingClient.woo_customer_id) updates.woo_customer_id = woo_customer_id;
            
            // Append notes if provided
            if (notes && existingClient.notes !== notes) {
                updates.notes = existingClient.notes ? `${existingClient.notes}\n${notes}` : notes;
            }

            if (Object.keys(updates).length > 0) {
                const updatedClient = await base44.entities.Client.update(existingClient.id, updates);
                return Response.json({
                    client: updatedClient,
                    isNew: false,
                    updated: true,
                    message: 'לקוח קיים - עודכן עם מידע חדש'
                });
            }

            return Response.json({
                client: existingClient,
                isNew: false,
                updated: false,
                message: 'לקוח קיים נמצא במערכת'
            });
        }

        // Client doesn't exist - create new one
        const newClient = await base44.entities.Client.create({
            phone: phone,
            full_name: full_name || 'לקוח חדש',
            email: email,
            city: city,
            full_address: full_address,
            preferred_channel: preferred_channel || 'whatsapp',
            notes: notes,
            woo_customer_id: woo_customer_id
        });

        return Response.json({
            client: newClient,
            isNew: true,
            updated: false,
            message: 'לקוח חדש נוצר בהצלחה'
        });

    } catch (error) {
        console.error('❌ Error in findOrCreateClient:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack 
        }, { status: 500 });
    }
});