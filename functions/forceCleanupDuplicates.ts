import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Helper function to normalize phone numbers
function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('972')) {
        return cleaned;
    } else if (cleaned.startsWith('0')) {
        return '972' + cleaned.substring(1);
    } else if (cleaned.length >= 9) {
        return '972' + cleaned;
    }
    
    return cleaned;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔵 Starting FORCE cleanup...');

        const allClients = await base44.asServiceRole.entities.Client.list('-created_date', 5000);
        console.log(`📊 Found ${allClients.length} total clients`);

        const phoneGroups = new Map();
        
        for (const client of allClients) {
            if (!client.phone) continue;
            
            const normalized = normalizePhone(client.phone);
            if (!normalized || normalized.length < 9) continue;
            
            if (!phoneGroups.has(normalized)) {
                phoneGroups.set(normalized, []);
            }
            phoneGroups.get(normalized).push(client);
        }

        const duplicates = [];
        for (const [phone, clients] of phoneGroups) {
            if (clients.length > 1) {
                duplicates.push({ phone, clients });
            }
        }

        console.log(`🔍 Found ${duplicates.length} groups of duplicates`);

        if (duplicates.length === 0) {
            return Response.json({
                success: true,
                message: 'לא נמצאו כפילויות',
                deleted: 0
            });
        }

        let deletedCount = 0;

        for (const group of duplicates) {
            try {
                const sorted = group.clients.sort((a, b) => 
                    new Date(a.created_date) - new Date(b.created_date)
                );
                
                const keepClient = sorted[0];
                const deleteClients = sorted.slice(1);

                console.log(`🔄 Phone ${group.phone}: Keep "${keepClient.full_name}" (${keepClient.id.substring(0, 8)}), Delete ${deleteClients.length}`);

                for (const dupClient of deleteClients) {
                    try {
                        // Update related records
                        const [repairs, tickets, orders, devices] = await Promise.all([
                            base44.asServiceRole.entities.Repair.filter({ client_id: dupClient.id }),
                            base44.asServiceRole.entities.Ticket.filter({ customer_id: dupClient.id }),
                            base44.asServiceRole.entities.Order.filter({ client_id: dupClient.id }),
                            base44.asServiceRole.entities.RepairDevice.filter({ client_id: dupClient.id })
                        ]);

                        for (const repair of repairs) {
                            await base44.asServiceRole.entities.Repair.update(repair.id, { client_id: keepClient.id });
                        }

                        for (const ticket of tickets) {
                            await base44.asServiceRole.entities.Ticket.update(ticket.id, { customer_id: keepClient.id });
                        }

                        for (const order of orders) {
                            await base44.asServiceRole.entities.Order.update(order.id, { client_id: keepClient.id });
                        }

                        for (const device of devices) {
                            await base44.asServiceRole.entities.RepairDevice.update(device.id, { client_id: keepClient.id });
                        }

                        await base44.asServiceRole.entities.Client.delete(dupClient.id);
                        deletedCount++;
                        console.log(`   ✅ Deleted "${dupClient.full_name}" (${dupClient.id.substring(0, 8)})`);

                    } catch (dupError) {
                        console.error(`   ❌ Error with duplicate ${dupClient.id}:`, dupError.message);
                    }
                }

            } catch (groupError) {
                console.error(`❌ Error processing group:`, groupError);
            }
        }

        console.log(`✅ Cleanup complete: ${deletedCount} duplicates deleted`);

        return Response.json({
            success: true,
            message: `נמחקו ${deletedCount} לקוחות כפולים`,
            duplicateGroups: duplicates.length,
            deleted: deletedCount
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});