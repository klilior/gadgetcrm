import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    console.log('🧪 [Test] Starting webhook simulation...');

    try {
        // Simulate incoming message from 0525052175
        const testPhone = '972525052175';
        const testMessage = 'הודעת בדיקה - סימולציה';
        const testName = 'ליאור כהן';

        // Normalize phone number
        const normalizePhone = (phone) => {
            if (!phone) return '';
            let clean = phone.toString().replace(/\D/g, '');
            if (clean.startsWith('972')) {
                clean = '0' + clean.substring(3);
            }
            if (clean.length === 9 && clean.startsWith('5')) {
                clean = '0' + clean;
            }
            return clean;
        };

        const cleanPhone = normalizePhone(testPhone);
        console.log('📱 [Test] Clean phone:', cleanPhone);

        // Generate all possible formats
        const phoneFormats = [
            cleanPhone,
            cleanPhone.replace(/(\d{3})(\d{7})/, '$1-$2'),
            cleanPhone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3'),
            testPhone,
            `+${testPhone}`,
        ].filter((v, i, a) => v && a.indexOf(v) === i);

        console.log('🔍 [Test] Will search with formats:', phoneFormats);

        // Search for existing customer
        let customers = [];
        const searchResults = await Promise.all(
            phoneFormats.map(async format => {
                console.log(`🔍 [Test] Searching format: "${format}"`);
                const results = await base44.asServiceRole.entities.Client.filter({ phone: format });
                console.log(`   Found ${results.length} results`);
                return results;
            })
        );

        // Flatten and deduplicate
        const allMatches = searchResults.flat();
        const seenIds = new Set();
        customers = allMatches.filter(c => {
            if (seenIds.has(c.id)) return false;
            seenIds.add(c.id);
            return true;
        });

        console.log(`✅ [Test] Total unique customers found: ${customers.length}`);
        
        if (customers.length > 0) {
            console.log('📋 [Test] Found customers:', customers.map(c => ({
                id: c.id,
                name: c.full_name,
                phone: c.phone
            })));
        }

        // Also try direct list to see all customers with similar phones
        const allClients = await base44.asServiceRole.entities.Client.list('-created_date', 20);
        const matchingClients = allClients.filter(c => 
            c.phone && (
                c.phone.includes('525052175') || 
                c.phone.includes('0525052175') ||
                c.phone === cleanPhone
            )
        );
        console.log('📋 [Test] All matching clients from full list:', matchingClients.map(c => ({
            id: c.id,
            name: c.full_name,
            phone: c.phone
        })));

        // Check conversations for these customers
        if (matchingClients.length > 0) {
            const convResults = await Promise.all(
                matchingClients.map(c => 
                    base44.asServiceRole.entities.Conversation.filter({ customer_id: c.id })
                )
            );
            console.log('💬 [Test] Existing conversations:', convResults.flat().map(conv => ({
                id: conv.id,
                customer_id: conv.customer_id,
                last_message: conv.last_message,
                unread: conv.unread_count
            })));
        }

        // Now simulate what the webhook SHOULD do
        let customer;
        if (matchingClients.length > 0) {
            // Use the first matching client
            customer = matchingClients[0];
            console.log(`✅ [Test] Would use existing customer: ${customer.id} (${customer.full_name})`);
        } else {
            console.log('❌ [Test] No matching customer found - would create new one');
            customer = null;
        }

        // Find conversation
        let conversation = null;
        if (customer) {
            const convs = await base44.asServiceRole.entities.Conversation.filter(
                { customer_id: customer.id },
                '-last_message_date',
                1
            );
            if (convs.length > 0) {
                conversation = convs[0];
                console.log(`✅ [Test] Would update existing conversation: ${conversation.id}`);
            } else {
                console.log('❌ [Test] No conversation found for customer - would create new one');
            }
        }

        // ACTUALLY ADD THE MESSAGE to verify it works
        if (customer && conversation) {
            const now = new Date().toISOString();
            
            // Update conversation
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                last_message: testMessage,
                last_message_date: now,
                last_channel: 'whatsapp',
                unread_count: (conversation.unread_count || 0) + 1
            });

            // Create activity
            const activity = await base44.asServiceRole.entities.Activity.create({
                order_id: customer.id,
                activity_type: 'וואטסאפ נכנס',
                summary: `הודעה מ-${customer.full_name || cleanPhone}`,
                content: testMessage,
                thread_id: conversation.id,
                read_by: []
            });

            console.log(`✅ [Test] Message added! Activity ID: ${activity.id}`);

            return Response.json({
                success: true,
                message: 'Simulation successful - message added to existing conversation!',
                customer_id: customer.id,
                customer_name: customer.full_name,
                conversation_id: conversation.id,
                activity_id: activity.id,
                test_message: testMessage
            });
        }

        return Response.json({
            success: false,
            message: 'Could not find existing customer/conversation',
            searched_formats: phoneFormats,
            matching_clients_from_list: matchingClients.map(c => ({ id: c.id, name: c.full_name, phone: c.phone })),
            customers_found_by_filter: customers.length
        });

    } catch (error) {
        console.error('❌ [Test] Error:', error.message);
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});