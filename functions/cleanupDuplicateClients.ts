import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Helper function to normalize phone numbers
function normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters (including +, spaces, dashes)
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle Israeli phone numbers
    if (cleaned.startsWith('972')) {
        // Already has country code, keep it
        return cleaned;
    } else if (cleaned.startsWith('0')) {
        // Remove leading 0 and add 972
        return '972' + cleaned.substring(1);
    } else if (cleaned.length >= 9) {
        // Assume it's without country code and leading 0
        return '972' + cleaned;
    }
    
    return cleaned; // Return as-is if can't normalize
}

// Helper function to merge client data intelligently
function mergeClientData(clients) {
    // Sort by created_date (oldest first) to keep the oldest ID
    const sorted = clients.sort((a, b) => 
        new Date(a.created_date) - new Date(b.created_date)
    );
    
    const primary = sorted[0];
    const others = sorted.slice(1);
    
    // Merge all data - prefer non-empty values
    const merged = {
        full_name: primary.full_name,
        phone: primary.phone,
        email: null,
        city: null,
        full_address: null,
        preferred_channel: null,
        notes: null,
        woo_customer_id: null
    };
    
    // Collect all non-empty values from all duplicates
    for (const client of clients) {
        if (!merged.email && client.email) merged.email = client.email;
        if (!merged.city && client.city) merged.city = client.city;
        if (!merged.full_address && client.full_address) merged.full_address = client.full_address;
        if (!merged.preferred_channel && client.preferred_channel) merged.preferred_channel = client.preferred_channel;
        if (!merged.woo_customer_id && client.woo_customer_id) merged.woo_customer_id = client.woo_customer_id;
        
        // Merge notes
        if (client.notes && client.notes.trim()) {
            if (!merged.notes) {
                merged.notes = client.notes;
            } else if (!merged.notes.includes(client.notes)) {
                merged.notes += '\n---\n' + client.notes;
            }
        }
    }
    
    return { primary, others, merged };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verify user is authenticated and is admin
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized - Must be logged in' }, { status: 401 });
        }

        if (user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
        }

        console.log('🔵 Starting enhanced duplicate cleanup process...');

        // Fetch all clients
        const allClients = await base44.asServiceRole.entities.Client.list('-created_date', 5000);
        
        console.log(`📊 Found ${allClients.length} total clients`);

        // Group clients by normalized phone number
        const phoneGroups = new Map();
        
        for (const client of allClients) {
            if (!client.phone) {
                console.log(`⚠️ Client ${client.id} has no phone number, skipping`);
                continue;
            }
            
            const normalizedPhone = normalizePhone(client.phone);
            
            if (!normalizedPhone || normalizedPhone.length < 9) {
                console.log(`⚠️ Client ${client.id} has invalid phone: ${client.phone}, skipping`);
                continue;
            }
            
            if (!phoneGroups.has(normalizedPhone)) {
                phoneGroups.set(normalizedPhone, []);
            }
            phoneGroups.get(normalizedPhone).push(client);
        }

        // Find duplicates
        const duplicates = [];
        for (const [phone, clients] of phoneGroups) {
            if (clients.length > 1) {
                duplicates.push({ phone, clients });
                console.log(`🔍 Found ${clients.length} duplicates for phone: ${phone}`);
                clients.forEach(c => console.log(`   - ${c.full_name} (${c.phone}) ID: ${c.id.substring(0, 8)}`));
            }
        }

        console.log(`🔍 Found ${duplicates.length} groups of duplicate clients`);

        if (duplicates.length === 0) {
            return Response.json({
                success: true,
                message: '✅ לא נמצאו כפילויות!',
                summary: {
                    totalClients: allClients.length,
                    duplicateGroups: 0,
                    clientsDeleted: 0,
                    clientsRemaining: allClients.length
                },
                details: []
            });
        }

        // Process all duplicate groups
        let deletedCount = 0;
        const mergeReport = [];
        const errors = [];

        for (const group of duplicates) {
            try {
                const { primary, others, merged } = mergeClientData(group.clients);

                console.log(`\n🔄 Processing duplicate group for phone: ${group.phone}`);
                console.log(`   ✅ Keeping: ${primary.full_name} (ID: ${primary.id.substring(0, 8)})`);
                console.log(`   ❌ Deleting: ${others.length} duplicates`);

                // Update the primary client with merged data
                await base44.asServiceRole.entities.Client.update(primary.id, merged);
                console.log(`   💾 Updated primary client with merged data`);

                // Update all related records for each duplicate
                for (const duplicate of others) {
                    console.log(`   🔄 Processing duplicate: ${duplicate.full_name} (ID: ${duplicate.id.substring(0, 8)})`);

                    try {
                        // Fetch all related records in parallel
                        const [repairs, tickets, orders, devices] = await Promise.all([
                            base44.asServiceRole.entities.Repair.filter({ client_id: duplicate.id }),
                            base44.asServiceRole.entities.Ticket.filter({ customer_id: duplicate.id }),
                            base44.asServiceRole.entities.Order.filter({ client_id: duplicate.id }),
                            base44.asServiceRole.entities.RepairDevice.filter({ client_id: duplicate.id })
                        ]);

                        console.log(`      📊 Found: ${repairs.length} repairs, ${tickets.length} tickets, ${orders.length} orders, ${devices.length} devices`);

                        // Update all repairs
                        for (const repair of repairs) {
                            await base44.asServiceRole.entities.Repair.update(repair.id, { client_id: primary.id });
                        }

                        // Update all tickets
                        for (const ticket of tickets) {
                            await base44.asServiceRole.entities.Ticket.update(ticket.id, { customer_id: primary.id });
                        }

                        // Update all orders
                        for (const order of orders) {
                            await base44.asServiceRole.entities.Order.update(order.id, { client_id: primary.id });
                        }

                        // Update all devices
                        for (const device of devices) {
                            await base44.asServiceRole.entities.RepairDevice.update(device.id, { client_id: primary.id });
                        }

                        console.log(`      ✅ Updated all related records`);

                        // Delete the duplicate client
                        await base44.asServiceRole.entities.Client.delete(duplicate.id);
                        deletedCount++;
                        console.log(`      🗑️ Deleted duplicate client`);

                    } catch (dupError) {
                        console.error(`      ❌ Error processing duplicate ${duplicate.id}:`, dupError.message);
                        throw dupError;
                    }
                }

                mergeReport.push({
                    phone: group.phone,
                    normalizedPhone: normalizePhone(group.phone),
                    keptClient: {
                        name: primary.full_name,
                        id: primary.id,
                        originalPhone: primary.phone
                    },
                    deletedCount: others.length,
                    deletedClients: others.map(c => ({ 
                        id: c.id, 
                        name: c.full_name,
                        originalPhone: c.phone
                    })),
                    mergedData: merged
                });

                console.log(`   ✅ Successfully processed group`);

            } catch (groupError) {
                console.error(`❌ Error processing group for phone ${group.phone}:`, groupError);
                errors.push({
                    phone: group.phone,
                    error: groupError.message,
                    clients: group.clients.map(c => ({ id: c.id, name: c.full_name }))
                });
            }
        }

        console.log('\n✅ Cleanup completed successfully');
        console.log(`📊 Processed ${duplicates.length} groups, deleted ${deletedCount} duplicates`);

        return Response.json({
            success: true,
            message: `✅ ניקוי הושלם בהצלחה! ${deletedCount} לקוחות כפולים נמחקו`,
            summary: {
                totalClients: allClients.length,
                duplicateGroups: duplicates.length,
                clientsDeleted: deletedCount,
                clientsRemaining: allClients.length - deletedCount,
                errors: errors.length
            },
            details: mergeReport,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('❌ Fatal error in cleanup process:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack,
            hint: 'בדוק את הלוגים בדשבורד לפרטים נוספים'
        }, { status: 500 });
    }
});