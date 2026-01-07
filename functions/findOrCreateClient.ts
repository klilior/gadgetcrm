import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        console.log('🔵 findOrCreateClient: Starting...');
        const base44 = createClientFromRequest(req);
        
        // Verify user is authenticated
        console.log('🔵 Checking authentication...');
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (authErr) {
            console.log('⚠️ Auth error (continuing with service role):', authErr.message);
        }
        console.log('✅ User check done:', user?.email || 'no user - using service role');

        let bodyData;
        try {
            bodyData = await req.json();
        } catch (parseErr) {
            console.error('❌ Failed to parse request body:', parseErr.message);
            return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        console.log('🔵 Received data:', { phone: bodyData.phone, full_name: bodyData.full_name });
        
        const { phone, full_name, email, city, full_address, preferred_channel, notes, woo_customer_id } = bodyData;

        if (!phone) {
            console.error('❌ Phone number missing');
            return Response.json({ error: 'Phone number is required' }, { status: 400 });
        }

        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizedPhone = phone.replace(/\D/g, '');
        console.log('🔵 Normalized phone:', normalizedPhone);

        // Search for existing client by phone (using service role for admin access)
        console.log('🔵 Searching for existing client...');
        let existingClients = await base44.asServiceRole.entities.Client.filter({ phone: phone });
        console.log('✅ Found clients with exact phone match:', existingClients.length);
        
        // If not found, try with normalized phone
        if (existingClients.length === 0) {
            const allClients = await base44.asServiceRole.entities.Client.list();
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
                const updatedClient = await base44.asServiceRole.entities.Client.update(existingClient.id, updates);
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

        // Client doesn't exist - create new one (using service role for admin access)
        console.log('🔵 Creating new client with data:', { phone, full_name, email });
        
        // Build create payload - only include non-empty fields to avoid unique constraint issues
        const createPayload = {
            phone: phone,
            full_name: full_name || 'לקוח חדש',
            preferred_channel: preferred_channel || 'whatsapp'
        };
        
        // Only add optional fields if they have actual values
        if (email && email.trim()) createPayload.email = email.trim();
        if (city && city.trim()) createPayload.city = city.trim();
        if (full_address && full_address.trim()) createPayload.full_address = full_address.trim();
        if (notes && notes.trim()) createPayload.notes = notes.trim();
        if (woo_customer_id) createPayload.woo_customer_id = woo_customer_id;
        
        console.log('🔵 Final create payload:', createPayload);
        const newClient = await base44.asServiceRole.entities.Client.create(createPayload);

        console.log('✅ New client created successfully:', newClient.id);
        return Response.json({
            client: newClient,
            isNew: true,
            updated: false,
            message: 'לקוח חדש נוצר בהצלחה'
        });

    } catch (error) {
        console.error('❌ Error in findOrCreateClient:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error name:', error.name);
        console.error('❌ Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        return Response.json({ 
            error: error.message || String(error),
            details: error.stack || 'No stack trace available',
            errorName: error.name || 'Unknown',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
});