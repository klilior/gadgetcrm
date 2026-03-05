import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function normalizePhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[\s\-\(\)\.+]/g, '');
    if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
    if (cleaned.startsWith('9720')) cleaned = '0' + cleaned.slice(4);
    if (cleaned.length < 9 || cleaned.length > 11) return null;
    return cleaned;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeOp(fn, retries = 4) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
            if ((err.message?.includes('Rate limit') || err.message?.includes('AsyncWrap')) && i < retries - 1) {
                await sleep(5000 * (i + 1));
                continue;
            }
            throw err;
        }
    }
}

async function hasLinkedRecords(sr, clientId) {
    const [repairs, orders, tickets, devices] = await Promise.all([
        safeOp(() => sr.Repair.filter({ client_id: clientId }, null, 1)),
        safeOp(() => sr.Order.filter({ client_id: clientId }, null, 1)),
        safeOp(() => sr.Ticket.filter({ customer_id: clientId }, null, 1)),
        safeOp(() => sr.RepairDevice.filter({ client_id: clientId }, null, 1)),
    ]);
    return repairs.length > 0 || orders.length > 0 || tickets.length > 0 || devices.length > 0;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const phase = body.phase || 'delete_no_phone';
        const batchSize = body.batch_size || 50;
        const offset = body.offset || 0;

        const sr = base44.asServiceRole.entities;
        
        console.log(`🧹 Phase: ${phase}, batch: ${batchSize}, offset: ${offset}`);

        const allClients = await sr.Client.list('-created_date', 5000);
        console.log(`📊 Total clients: ${allClients.length}`);

        if (phase === 'delete_no_phone') {
            // ── Phase 1: Delete clients without phone that have no linked records ──
            const noPhoneClients = allClients.filter(c => !normalizePhone(c.phone));
            console.log(`📱 Clients without valid phone: ${noPhoneClients.length}`);

            // Group no-phone clients by email to find duplicates
            const emailGroups = new Map();
            for (const c of noPhoneClients) {
                const email = (c.email || '').toLowerCase().trim();
                const key = email || `__no_email_${c.id}`;
                if (!emailGroups.has(key)) emailGroups.set(key, []);
                emailGroups.get(key).push(c);
            }

            const batch = noPhoneClients.slice(offset, offset + batchSize);
            let deleted = 0, skipped = 0, errors = [];

            // For email-duplicates: keep only the oldest one (if it has linked records), delete the rest
            const processed = new Set();

            for (const client of batch) {
                if (processed.has(client.id)) continue;
                await sleep(800);

                try {
                    const email = (client.email || '').toLowerCase().trim();
                    const group = email ? (emailGroups.get(email) || []) : [client];

                    if (group.length > 1 && email) {
                        // Multiple clients with same email, no phone
                        // Sort by created_date, keep the oldest
                        const sorted = [...group].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                        
                        // Mark all in group as processed
                        for (const g of group) processed.add(g.id);

                        // Delete all but the first (oldest), unless they have linked records
                        for (let i = 1; i < sorted.length; i++) {
                            await sleep(500);
                            const dup = sorted[i];
                            const hasLinked = await hasLinkedRecords(sr, dup.id);
                            if (hasLinked) {
                                skipped++;
                                continue;
                            }
                            await safeOp(() => sr.Client.delete(dup.id));
                            deleted++;
                        }

                        // Also check if the oldest one should be deleted (no linked records, no useful data)
                        const oldest = sorted[0];
                        const hasLinked = await hasLinkedRecords(sr, oldest.id);
                        if (!hasLinked) {
                            await safeOp(() => sr.Client.delete(oldest.id));
                            deleted++;
                        } else {
                            skipped++;
                        }
                    } else {
                        // Single client without phone
                        processed.add(client.id);
                        const hasLinked = await hasLinkedRecords(sr, client.id);
                        if (hasLinked) {
                            skipped++;
                            continue;
                        }
                        await safeOp(() => sr.Client.delete(client.id));
                        deleted++;
                    }
                } catch (err) {
                    errors.push({ id: client.id, name: client.full_name, error: err.message });
                }
            }

            return Response.json({
                success: true, phase,
                total_no_phone: noPhoneClients.length,
                batch_processed: batch.length,
                deleted, skipped, errors: errors.length,
                next_offset: offset + batchSize,
                has_more: offset + batchSize < noPhoneClients.length,
                error_details: errors.slice(0, 10)
            });

        } else if (phase === 'merge_duplicates') {
            // ── Phase 2: Merge clients with same phone number ──
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

            console.log(`📞 Phone duplicate groups: ${dupGroups.length}`);

            const batch = dupGroups.slice(offset, offset + batchSize);
            let merged = 0, reassigned = 0, errors = [];

            for (const group of batch) {
                await sleep(1500);
                try {
                    const sorted = group.clients.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                    const primary = sorted[0];
                    const dups = sorted.slice(1);

                    // Merge best data into primary
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
                        await sleep(1000);
                        
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

        } else if (phase === 'merge_email_duplicates') {
            // ── Phase 3: Merge clients with same email (that have phone) ──
            const emailGroups = new Map();
            for (const c of allClients) {
                const email = (c.email || '').toLowerCase().trim();
                if (!email) continue;
                if (!emailGroups.has(email)) emailGroups.set(email, []);
                emailGroups.get(email).push(c);
            }

            const dupGroups = [];
            for (const [email, clients] of emailGroups) {
                if (clients.length > 1) dupGroups.push({ email, clients });
            }

            console.log(`📧 Email duplicate groups: ${dupGroups.length}`);

            const batch = dupGroups.slice(offset, offset + batchSize);
            let merged = 0, reassigned = 0, errors = [];

            for (const group of batch) {
                await sleep(1500);
                try {
                    // Prefer the one that has a phone number, then oldest
                    const sorted = [...group.clients].sort((a, b) => {
                        const aHasPhone = normalizePhone(a.phone) ? 1 : 0;
                        const bHasPhone = normalizePhone(b.phone) ? 1 : 0;
                        if (bHasPhone !== aHasPhone) return bHasPhone - aHasPhone;
                        return new Date(a.created_date) - new Date(b.created_date);
                    });
                    
                    const primary = sorted[0];
                    const dups = sorted.slice(1);

                    const mergeData = {};
                    for (const c of [primary, ...dups]) {
                        if (!mergeData.phone && normalizePhone(c.phone)) mergeData.phone = normalizePhone(c.phone);
                        if (!mergeData.city && c.city) mergeData.city = c.city;
                        if (!mergeData.full_address && c.full_address) mergeData.full_address = c.full_address;
                        if (!mergeData.woo_customer_id && c.woo_customer_id) mergeData.woo_customer_id = c.woo_customer_id;
                        if (!mergeData.linet_account_id && c.linet_account_id) mergeData.linet_account_id = c.linet_account_id;
                        if (!mergeData.source && c.source) mergeData.source = c.source;
                    }

                    if (Object.keys(mergeData).length > 0) {
                        await safeOp(() => sr.Client.update(primary.id, mergeData));
                    }

                    for (const dup of dups) {
                        await sleep(1000);
                        
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
                    errors.push({ email: group.email, error: err.message });
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

        return Response.json({ error: 'Unknown phase. Use: delete_no_phone, merge_duplicates, merge_email_duplicates' }, { status: 400 });

    } catch (error) {
        console.error('❌ Cleanup error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});