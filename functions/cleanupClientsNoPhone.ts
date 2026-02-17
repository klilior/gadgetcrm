import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeOp(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
            if ((err.message?.includes('Rate limit') || err.message?.includes('AsyncWrap')) && i < retries - 1) {
                await sleep(3000 * (i + 1));
                continue;
            }
            throw err;
        }
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const phase = body.phase || 'delete_no_phone'; // 'delete_no_phone' | 'merge_duplicates'
        const batchSize = body.batch_size || 30;
        const offset = body.offset || 0;

        const sr = base44.asServiceRole.entities;
        
        console.log(`🧹 Phase: ${phase}, batch: ${batchSize}, offset: ${offset}`);

        const allClients = await sr.Client.list('-created_date', 5000);
        console.log(`📊 Total clients: ${allClients.length}`);

        if (phase === 'delete_no_phone') {
            // Find clients without valid phone
            const toDelete = allClients.filter(c => !normalizePhone(c.phone));
            const batch = toDelete.slice(offset, offset + batchSize);
            
            let deleted = 0, skipped = 0, errors = [];
            
            for (const client of batch) {
                await sleep(500); // throttle
                try {
                    // Check for linked records
                    const [repairs, orders, tickets, devices] = await Promise.all([
                        safeOp(() => sr.Repair.filter({ client_id: client.id }, null, 1)),
                        safeOp(() => sr.Order.filter({ client_id: client.id }, null, 1)),
                        safeOp(() => sr.Ticket.filter({ customer_id: client.id }, null, 1)),
                        safeOp(() => sr.RepairDevice.filter({ client_id: client.id }, null, 1)),
                    ]);

                    if (repairs.length > 0 || orders.length > 0 || tickets.length > 0 || devices.length > 0) {
                        skipped++;
                        continue;
                    }

                    await safeOp(() => sr.Client.delete(client.id));
                    deleted++;
                } catch (err) {
                    errors.push({ id: client.id, name: client.full_name, error: err.message });
                }
            }

            return Response.json({
                success: true, phase,
                total_no_phone: toDelete.length,
                batch_processed: batch.length,
                deleted, skipped, errors: errors.length,
                next_offset: offset + batchSize,
                has_more: offset + batchSize < toDelete.length,
                error_details: errors.slice(0, 10)
            });

        } else if (phase === 'merge_duplicates') {
            // Group by normalized phone
            const phoneGroups = new Map();
            for (const c of allClients) {
                const norm = normalizePhone(c.phone);
                if (!norm) continue;
                if (!phoneGroups.has(norm)) phoneGroups.set(norm, []);
                phoneGroups.get(norm).push(c);
            }

            const dupGroups = [];
            for (const [phone, clients] of phoneGroups) {
                if (clients.length > 1) dupGroups.push({ phone, clients });
            }

            const batch = dupGroups.slice(offset, offset + batchSize);
            let merged = 0, reassigned = 0, errors = [];

            for (const group of batch) {
                await sleep(800); // throttle per group
                try {
                    const sorted = group.clients.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                    const primary = sorted[0];
                    const dups = sorted.slice(1);

                    // Merge fields into primary
                    const mergeData = { phone: group.phone };
                    for (const c of [primary, ...dups]) {
                        if (!mergeData.email && c.email) mergeData.email = c.email;
                        if (!mergeData.city && c.city) mergeData.city = c.city;
                        if (!mergeData.full_address && c.full_address) mergeData.full_address = c.full_address;
                        if (!mergeData.woo_customer_id && c.woo_customer_id) mergeData.woo_customer_id = c.woo_customer_id;
                        if (!mergeData.linet_account_id && c.linet_account_id) mergeData.linet_account_id = c.linet_account_id;
                        if (!mergeData.source && c.source) mergeData.source = c.source;
                    }

                    await safeOp(() => sr.Client.update(primary.id, mergeData));

                    for (const dup of dups) {
                        await sleep(300);
                        
                        const [repairs, orders, tickets, devices] = await Promise.all([
                            safeOp(() => sr.Repair.filter({ client_id: dup.id })),
                            safeOp(() => sr.Order.filter({ client_id: dup.id })),
                            safeOp(() => sr.Ticket.filter({ customer_id: dup.id })),
                            safeOp(() => sr.RepairDevice.filter({ client_id: dup.id })),
                        ]);

                        for (const r of repairs) {
                            await safeOp(() => sr.Repair.update(r.id, { client_id: primary.id }));
                            reassigned++;
                        }
                        for (const o of orders) {
                            await safeOp(() => sr.Order.update(o.id, { client_id: primary.id }));
                            reassigned++;
                        }
                        for (const t of tickets) {
                            await safeOp(() => sr.Ticket.update(t.id, { customer_id: primary.id }));
                            reassigned++;
                        }
                        for (const d of devices) {
                            await safeOp(() => sr.RepairDevice.update(d.id, { client_id: primary.id }));
                            reassigned++;
                        }

                        await safeOp(() => sr.Client.delete(dup.id));
                        merged++;
                    }
                } catch (err) {
                    errors.push({ phone: group.phone, error: err.message });
                }
            }

            return Response.json({
                success: true, phase,
                total_duplicate_groups: dupGroups.length,
                batch_processed: batch.length,
                merged, reassigned, errors: errors.length,
                next_offset: offset + batchSize,
                has_more: offset + batchSize < dupGroups.length,
                error_details: errors.slice(0, 10)
            });
        }

        return Response.json({ error: 'Unknown phase' }, { status: 400 });

    } catch (error) {
        console.error('❌ Cleanup error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});