import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🧹 [Cleanup] Starting duplicate cleanup...');

        // 1. Fetch all clients
        // We fetch in batches or limit to a reasonable number
        const clients = await base44.entities.Client.list('-created_date', 2000);
        console.log(`📊 [Cleanup] Found ${clients.length} clients`);

        // 2. Group by normalized phone
        const phoneMap = {};
        const normalizePhone = (phone) => {
            if (!phone) return null;
            let clean = phone.toString().replace(/\D/g, '');
            if (clean.startsWith('972')) clean = '0' + clean.substring(3);
            if (clean.length === 9 && clean.startsWith('5')) clean = '0' + clean;
            return clean;
        };

        for (const client of clients) {
            const phone = normalizePhone(client.phone);
            if (!phone) continue;

            if (!phoneMap[phone]) {
                phoneMap[phone] = [];
            }
            phoneMap[phone].push(client);
        }

        // 3. Identify duplicates
        const duplicates = Object.values(phoneMap).filter(group => group.length > 1);
        console.log(`🔍 [Cleanup] Found ${duplicates.length} duplicate groups`);

        let mergedCount = 0;
        const logs = [];

        for (const group of duplicates) {
            // Sort by created date (oldest first)
            // We want to keep the oldest one as "primary" usually, or the one with more data
            // Let's prioritize:
            // 1. Clients with woo_customer_id (Synced from Woo)
            // 2. Oldest created
            
            group.sort((a, b) => {
                if (a.woo_customer_id && !b.woo_customer_id) return -1;
                if (!a.woo_customer_id && b.woo_customer_id) return 1;
                return new Date(a.created_date) - new Date(b.created_date);
            });

            const primary = group[0];
            const others = group.slice(1);

            console.log(`🔄 [Cleanup] Merging into ${primary.full_name} (${primary.id})`);
            logs.push(`Merging ${others.length} duplicates into ${primary.full_name} (${primary.phone})`);

            for (const other of others) {
                // Re-assign related entities to primary
                
                // Tickets
                const tickets = await base44.entities.Ticket.filter({ customer_id: other.id });
                for (const t of tickets) {
                    await base44.entities.Ticket.update(t.id, { customer_id: primary.id });
                }

                // Orders
                const orders = await base44.entities.Order.filter({ client_id: other.id });
                for (const o of orders) {
                    await base44.entities.Order.update(o.id, { client_id: primary.id });
                }

                // Repairs
                const repairs = await base44.entities.Repair.filter({ client_id: other.id });
                for (const r of repairs) {
                    await base44.entities.Repair.update(r.id, { client_id: primary.id });
                }

                // Activities (stored with order_id as customer_id)
                const activities = await base44.entities.Activity.filter({ order_id: other.id });
                for (const a of activities) {
                    await base44.entities.Activity.update(a.id, { order_id: primary.id });
                }

                // Conversations
                const conversations = await base44.entities.Conversation.filter({ customer_id: other.id });
                for (const c of conversations) {
                    await base44.entities.Conversation.update(c.id, { customer_id: primary.id });
                }

                // Finally, delete the duplicate client
                await base44.entities.Client.delete(other.id);
            }
            mergedCount++;
        }

        return Response.json({
            success: true,
            merged_groups: mergedCount,
            details: logs
        });

    } catch (error) {
        console.error('❌ [Cleanup] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});