import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const dryRun = body.dry_run !== false; // default to dry run for safety

        console.log(`🧹 Starting client cleanup (dry_run: ${dryRun})...`);

        // Fetch all clients
        const allClients = await base44.asServiceRole.entities.Client.list('-created_date', 5000);
        console.log(`📊 Total clients: ${allClients.length}`);

        const stats = {
            total_clients: allClients.length,
            clients_no_phone: 0,
            clients_invalid_phone: 0,
            clients_deleted_no_phone: 0,
            duplicate_groups: 0,
            duplicates_merged: 0,
            records_reassigned: 0,
            errors: []
        };

        // --- Phase 1: Delete clients without valid phone ---
        const clientsWithPhone = [];
        const clientsToDelete = [];

        for (const client of allClients) {
            const normalized = normalizePhone(client.phone);
            if (!normalized) {
                clientsToDelete.push(client);
                if (!client.phone) stats.clients_no_phone++;
                else stats.clients_invalid_phone++;
            } else {
                client._normalizedPhone = normalized;
                clientsWithPhone.push(client);
            }
        }

        console.log(`🗑️ Clients to delete (no valid phone): ${clientsToDelete.length}`);
        console.log(`✅ Clients with valid phone: ${clientsWithPhone.length}`);

        if (!dryRun) {
            for (const client of clientsToDelete) {
                try {
                    // Check if client has any linked records
                    const [repairs, orders, tickets, devices] = await Promise.all([
                        base44.asServiceRole.entities.Repair.filter({ client_id: client.id }, null, 1),
                        base44.asServiceRole.entities.Order.filter({ client_id: client.id }, null, 1),
                        base44.asServiceRole.entities.Ticket.filter({ customer_id: client.id }, null, 1),
                        base44.asServiceRole.entities.RepairDevice.filter({ client_id: client.id }, null, 1),
                    ]);

                    const hasRecords = repairs.length > 0 || orders.length > 0 || tickets.length > 0 || devices.length > 0;
                    
                    if (hasRecords) {
                        console.log(`⚠️ Client ${client.id} (${client.full_name}) has linked records, skipping delete`);
                        stats.errors.push({ id: client.id, name: client.full_name, error: 'has linked records' });
                        continue;
                    }

                    await base44.asServiceRole.entities.Client.delete(client.id);
                    stats.clients_deleted_no_phone++;
                    console.log(`🗑️ Deleted: ${client.full_name} (no valid phone)`);
                } catch (err) {
                    stats.errors.push({ id: client.id, name: client.full_name, error: err.message });
                }
            }
        } else {
            stats.clients_deleted_no_phone = clientsToDelete.length;
        }

        // --- Phase 2: Merge duplicates by normalized phone ---
        const phoneGroups = new Map();
        for (const client of clientsWithPhone) {
            const key = client._normalizedPhone;
            if (!phoneGroups.has(key)) phoneGroups.set(key, []);
            phoneGroups.get(key).push(client);
        }

        const duplicateGroups = [];
        for (const [phone, clients] of phoneGroups) {
            if (clients.length > 1) {
                duplicateGroups.push({ phone, clients });
            }
        }

        stats.duplicate_groups = duplicateGroups.length;
        console.log(`🔍 Duplicate groups found: ${duplicateGroups.length}`);

        if (!dryRun) {
            for (const group of duplicateGroups) {
                try {
                    // Keep oldest client as primary
                    const sorted = group.clients.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                    const primary = sorted[0];
                    const duplicates = sorted.slice(1);

                    // Merge data into primary
                    const mergeData = {};
                    for (const dup of [primary, ...duplicates]) {
                        if (!mergeData.email && dup.email) mergeData.email = dup.email;
                        if (!mergeData.city && dup.city) mergeData.city = dup.city;
                        if (!mergeData.full_address && dup.full_address) mergeData.full_address = dup.full_address;
                        if (!mergeData.woo_customer_id && dup.woo_customer_id) mergeData.woo_customer_id = dup.woo_customer_id;
                        if (!mergeData.linet_account_id && dup.linet_account_id) mergeData.linet_account_id = dup.linet_account_id;
                        if (!mergeData.source && dup.source) mergeData.source = dup.source;
                    }

                    // Normalize the phone on primary
                    mergeData.phone = primary._normalizedPhone;
                    
                    await base44.asServiceRole.entities.Client.update(primary.id, mergeData);

                    for (const dup of duplicates) {
                        // Reassign all linked records
                        const [repairs, orders, tickets, devices] = await Promise.all([
                            base44.asServiceRole.entities.Repair.filter({ client_id: dup.id }),
                            base44.asServiceRole.entities.Order.filter({ client_id: dup.id }),
                            base44.asServiceRole.entities.Ticket.filter({ customer_id: dup.id }),
                            base44.asServiceRole.entities.RepairDevice.filter({ client_id: dup.id }),
                        ]);

                        for (const r of repairs) {
                            await base44.asServiceRole.entities.Repair.update(r.id, { client_id: primary.id });
                            stats.records_reassigned++;
                        }
                        for (const o of orders) {
                            await base44.asServiceRole.entities.Order.update(o.id, { client_id: primary.id });
                            stats.records_reassigned++;
                        }
                        for (const t of tickets) {
                            await base44.asServiceRole.entities.Ticket.update(t.id, { customer_id: primary.id });
                            stats.records_reassigned++;
                        }
                        for (const d of devices) {
                            await base44.asServiceRole.entities.RepairDevice.update(d.id, { client_id: primary.id });
                            stats.records_reassigned++;
                        }

                        await base44.asServiceRole.entities.Client.delete(dup.id);
                        stats.duplicates_merged++;
                        console.log(`🔄 Merged: ${dup.full_name} → ${primary.full_name}`);
                    }
                } catch (err) {
                    stats.errors.push({ phone: group.phone, error: err.message });
                }
            }
        } else {
            stats.duplicates_merged = duplicateGroups.reduce((sum, g) => sum + g.clients.length - 1, 0);
        }

        const remaining = allClients.length - stats.clients_deleted_no_phone - stats.duplicates_merged;

        console.log(`✅ Cleanup complete. Remaining: ${remaining}`);

        return Response.json({
            success: true,
            dry_run: dryRun,
            message: dryRun 
                ? `הרצת סימולציה: ${stats.clients_deleted_no_phone} לקוחות ללא טלפון ימחקו, ${stats.duplicates_merged} כפילויות ימוזגו` 
                : `✅ ניקוי הושלם! ${stats.clients_deleted_no_phone} נמחקו, ${stats.duplicates_merged} מוזגו`,
            stats,
            remaining_clients: remaining,
            duplicate_details: dryRun ? duplicateGroups.map(g => ({
                phone: g.phone,
                count: g.clients.length,
                names: g.clients.map(c => c.full_name)
            })) : undefined,
            no_phone_details: dryRun ? clientsToDelete.slice(0, 50).map(c => ({
                id: c.id,
                name: c.full_name,
                phone: c.phone || '(ריק)'
            })) : undefined
        });

    } catch (error) {
        console.error('❌ Cleanup error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});