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

async function safeOp(fn, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
            if ((err.message?.includes('Rate limit') || err.message?.includes('429') || err.message?.includes('AsyncWrap')) && i < retries - 1) {
                const delay = 8000 * (i + 1);
                console.log(`⏳ Rate limited, waiting ${delay/1000}s (attempt ${i+1}/${retries})...`);
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
}

/*
  Automated cleanup - runs in small batches to avoid rate limits.
  
  Workflow (sequential phases managed by SyncMetadata):
  1. delete_no_phone_safe – bulk-delete clients without phone AND without email (no value at all)
  2. delete_no_phone_with_email – delete no-phone clients grouped by email (keep one per email if linked records exist)  
  3. merge_phone_duplicates – merge clients with duplicate phone numbers
  4. merge_email_duplicates – merge clients with duplicate emails
  
  Called by scheduled automation every 5 minutes.
*/

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Allow both admin calls and scheduled automation (service role)
        let isAdmin = false;
        try {
            const user = await base44.auth.me();
            isAdmin = user?.role === 'admin';
        } catch (_) {
            // Scheduled automation - no user context, that's OK
        }

        const body = await req.json().catch(() => ({}));
        const sr = base44.asServiceRole.entities;

        // Get or create progress tracker
        let meta;
        try {
            const metas = await sr.SyncMetadata.filter({ sync_key: 'client_cleanup' });
            meta = metas[0];
        } catch (_) {}

        if (!meta) {
            meta = await sr.SyncMetadata.create({
                sync_key: 'client_cleanup',
                status: 'RUNNING',
                last_attempt: new Date().toISOString()
            });
        }

        // Determine current phase from metadata or body override
        const statusData = meta.last_error_message ? JSON.parse(meta.last_error_message || '{}') : {};
        const currentPhase = body.phase || statusData.current_phase || 'delete_no_phone_safe';
        const currentOffset = body.offset !== undefined ? body.offset : (statusData.current_offset || 0);

        console.log(`🧹 Phase: ${currentPhase}, offset: ${currentOffset}`);

        // Update status to running
        await sr.SyncMetadata.update(meta.id, {
            status: 'RUNNING',
            last_attempt: new Date().toISOString()
        });

        // Load all clients once
        const allClients = await sr.Client.list('-created_date', 5000);
        console.log(`📊 Total clients: ${allClients.length}`);

        let result;

        if (currentPhase === 'delete_no_phone_safe') {
            result = await deleteNoPhoneSafe(sr, allClients, currentOffset);
        } else if (currentPhase === 'delete_no_phone_with_email') {
            result = await deleteNoPhoneWithEmail(sr, allClients, currentOffset);
        } else if (currentPhase === 'merge_phone_duplicates') {
            result = await mergePhoneDuplicates(sr, allClients, currentOffset);
        } else if (currentPhase === 'merge_email_duplicates') {
            result = await mergeEmailDuplicates(sr, allClients, currentOffset);
        } else {
            // All done!
            await sr.SyncMetadata.update(meta.id, {
                status: 'SUCCESS',
                last_successful_sync: new Date().toISOString(),
                last_error_message: JSON.stringify({ current_phase: 'done', current_offset: 0, completed: true })
            });
            return Response.json({ success: true, message: 'All cleanup phases complete!' });
        }

        // Determine next phase/offset
        let nextPhase = currentPhase;
        let nextOffset = result.next_offset;

        if (!result.has_more) {
            // Move to next phase
            const phases = ['delete_no_phone_safe', 'delete_no_phone_with_email', 'merge_phone_duplicates', 'merge_email_duplicates', 'done'];
            const idx = phases.indexOf(currentPhase);
            nextPhase = phases[idx + 1] || 'done';
            nextOffset = 0;
        }

        // Save progress
        await sr.SyncMetadata.update(meta.id, {
            status: nextPhase === 'done' ? 'SUCCESS' : 'RUNNING',
            last_successful_sync: new Date().toISOString(),
            last_error_message: JSON.stringify({
                current_phase: nextPhase,
                current_offset: nextOffset,
                last_result: { phase: currentPhase, ...result }
            })
        });

        return Response.json({
            success: true,
            phase: currentPhase,
            ...result,
            next_phase: nextPhase,
            next_offset: nextOffset
        });

    } catch (error) {
        console.error('❌ Cleanup error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});


// ── Phase 1: Delete clients without phone AND without email (safe, no linked check needed for worthless records) ──
async function deleteNoPhoneSafe(sr, allClients, offset) {
    const targets = allClients.filter(c => !normalizePhone(c.phone) && !(c.email || '').trim());
    console.log(`🗑️ Phase 1: ${targets.length} clients without phone or email`);

    const BATCH = 10;
    const batch = targets.slice(offset, offset + BATCH);
    let deleted = 0, skipped = 0;

    for (const client of batch) {
        await sleep(3000);
        try {
            // Quick check for linked records
            const hasLinks = await checkLinkedRecords(sr, client.id);
            if (hasLinks) { skipped++; continue; }
            await safeOp(() => sr.Client.delete(client.id));
            deleted++;
        } catch (err) {
            console.error(`Error deleting ${client.id}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`✅ Phase 1 batch: deleted=${deleted}, skipped=${skipped}`);
    return { deleted, skipped, total: targets.length, has_more: offset + BATCH < targets.length, next_offset: offset + BATCH };
}


// ── Phase 2: Delete no-phone clients that have email (dedup by email, keep one) ──
async function deleteNoPhoneWithEmail(sr, allClients, offset) {
    const noPhone = allClients.filter(c => !normalizePhone(c.phone) && (c.email || '').trim());
    
    // Group by email
    const emailGroups = new Map();
    for (const c of noPhone) {
        const email = c.email.toLowerCase().trim();
        if (!emailGroups.has(email)) emailGroups.set(email, []);
        emailGroups.get(email).push(c);
    }

    // Convert to array - both duplicates AND singles (all no-phone with email)
    const groups = [];
    for (const [email, clients] of emailGroups) {
        groups.push({ email, clients });
    }

    console.log(`📧 Phase 2: ${groups.length} email groups (${noPhone.length} clients without phone)`);

    const BATCH = 5;
    const batch = groups.slice(offset, offset + BATCH);
    let deleted = 0, skipped = 0;

    for (const group of batch) {
        await sleep(2000);
        try {
            // Sort: oldest first
            const sorted = [...group.clients].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
            
            // For the oldest one - check if it has linked records. If not, delete it too.
            // For all others - reassign linked records to oldest, then delete.
            const primary = sorted[0];
            const dups = sorted.slice(1);

            // Delete duplicates
            for (const dup of dups) {
                await sleep(2500);
                const hasLinks = await checkLinkedRecords(sr, dup.id);
                if (hasLinks) {
                    // Reassign to primary
                    await reassignRecords(sr, dup.id, primary.id);
                }
                await safeOp(() => sr.Client.delete(dup.id));
                deleted++;
            }

            // Check if primary should also be deleted (no phone, no useful links)
            await sleep(2000);
            const primaryHasLinks = await checkLinkedRecords(sr, primary.id);
            if (!primaryHasLinks) {
                await safeOp(() => sr.Client.delete(primary.id));
                deleted++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error(`Error processing email group ${group.email}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`✅ Phase 2 batch: deleted=${deleted}, skipped=${skipped}`);
    return { deleted, skipped, total: groups.length, has_more: offset + BATCH < groups.length, next_offset: offset + BATCH };
}


// ── Phase 3: Merge phone duplicates ──
async function mergePhoneDuplicates(sr, allClients, offset) {
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

    console.log(`📞 Phase 3: ${dupGroups.length} phone duplicate groups`);

    const BATCH = 3;
    const batch = dupGroups.slice(offset, offset + BATCH);
    let merged = 0, reassigned = 0;

    for (const group of batch) {
        await sleep(3000);
        try {
            const sorted = group.clients.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
            const primary = sorted[0];
            const dups = sorted.slice(1);

            // Merge best data into primary
            const mergeData = {};
            for (const c of [primary, ...dups]) {
                if (!mergeData.email && c.email) mergeData.email = c.email;
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
                await sleep(3000);
                const count = await reassignRecords(sr, dup.id, primary.id);
                reassigned += count;
                await safeOp(() => sr.Client.delete(dup.id));
                merged++;
            }
        } catch (err) {
            console.error(`Error merging phone group ${group.phone}: ${err.message}`);
        }
    }

    console.log(`✅ Phase 3 batch: merged=${merged}, reassigned=${reassigned}`);
    return { merged, reassigned, total: dupGroups.length, has_more: offset + BATCH < dupGroups.length, next_offset: offset + BATCH };
}


// ── Phase 4: Merge email duplicates ──
async function mergeEmailDuplicates(sr, allClients, offset) {
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

    console.log(`📧 Phase 4: ${dupGroups.length} email duplicate groups`);

    const BATCH = 3;
    const batch = dupGroups.slice(offset, offset + BATCH);
    let merged = 0, reassigned = 0;

    for (const group of batch) {
        await sleep(3000);
        try {
            // Prefer client with phone, then oldest
            const sorted = [...group.clients].sort((a, b) => {
                const aPhone = normalizePhone(a.phone) ? 1 : 0;
                const bPhone = normalizePhone(b.phone) ? 1 : 0;
                if (bPhone !== aPhone) return bPhone - aPhone;
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
            }

            if (Object.keys(mergeData).length > 0) {
                await safeOp(() => sr.Client.update(primary.id, mergeData));
            }

            for (const dup of dups) {
                await sleep(3000);
                const count = await reassignRecords(sr, dup.id, primary.id);
                reassigned += count;
                await safeOp(() => sr.Client.delete(dup.id));
                merged++;
            }
        } catch (err) {
            console.error(`Error merging email group ${group.email}: ${err.message}`);
        }
    }

    console.log(`✅ Phase 4 batch: merged=${merged}, reassigned=${reassigned}`);
    return { merged, reassigned, total: dupGroups.length, has_more: offset + BATCH < dupGroups.length, next_offset: offset + BATCH };
}


// ── Helpers ──

async function checkLinkedRecords(sr, clientId) {
    try {
        const [repairs, orders, tickets, devices] = await Promise.all([
            safeOp(() => sr.Repair.filter({ client_id: clientId }, null, 1)),
            safeOp(() => sr.Order.filter({ client_id: clientId }, null, 1)),
            safeOp(() => sr.Ticket.filter({ customer_id: clientId }, null, 1)),
            safeOp(() => sr.RepairDevice.filter({ client_id: clientId }, null, 1)),
        ]);
        return repairs.length > 0 || orders.length > 0 || tickets.length > 0 || devices.length > 0;
    } catch (_) {
        return true; // If we can't check, assume it has links (safe)
    }
}

async function reassignRecords(sr, fromId, toId) {
    let count = 0;
    try {
        const [repairs, orders, tickets, devices] = await Promise.all([
            safeOp(() => sr.Repair.filter({ client_id: fromId })),
            safeOp(() => sr.Order.filter({ client_id: fromId })),
            safeOp(() => sr.Ticket.filter({ customer_id: fromId })),
            safeOp(() => sr.RepairDevice.filter({ client_id: fromId })),
        ]);

        for (const r of repairs) {
            await sleep(1500);
            await safeOp(() => sr.Repair.update(r.id, { client_id: toId }));
            count++;
        }
        for (const o of orders) {
            await sleep(1500);
            await safeOp(() => sr.Order.update(o.id, { client_id: toId }));
            count++;
        }
        for (const t of tickets) {
            await sleep(1500);
            await safeOp(() => sr.Ticket.update(t.id, { customer_id: toId }));
            count++;
        }
        for (const d of devices) {
            await sleep(1500);
            await safeOp(() => sr.RepairDevice.update(d.id, { client_id: toId }));
            count++;
        }
    } catch (err) {
        console.error(`Error reassigning from ${fromId} to ${toId}: ${err.message}`);
    }
    return count;
}