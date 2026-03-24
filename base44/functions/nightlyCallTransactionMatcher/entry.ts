import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) digits = digits.slice(3);
    else if (digits.length === 12 && digits.startsWith('972')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('0972') && digits.length > 12) digits = '0' + digits.slice(4);
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    if (digits.length >= 9 && digits.length <= 11) {
        if (!digits.startsWith('0')) digits = '0' + digits;
        return digits.slice(0, 10);
    }
    return null;
}

function phoneSearchVariants(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    return [
        normalized,
        '972' + normalized.slice(1),
        '+972' + normalized.slice(1),
        '9720' + normalized.slice(1),
        '+9720' + normalized.slice(1),
    ];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

        console.log(`🌙 [NightlyMatcher] Starting — scanning transactions since ${twoDaysAgoStr}`);

        // ── FORWARD: Transaction → Call ──
        const transactions = await sr.SalesTransaction.filter(
            { issue_date: { $gte: twoDaysAgoStr } }, '-issue_date', 500
        );
        console.log(`📊 [NightlyMatcher] ${transactions.length} transactions in last 2 days`);

        // Build a phone cache per linet_account_id
        const phoneCache = {};
        async function getPhoneForAccount(accountId, customerName) {
            if (!accountId) return null;
            if (phoneCache[accountId] !== undefined) return phoneCache[accountId];
            const clients = await sr.Client.filter({ linet_account_id: accountId }, null, 1);
            if (clients.length > 0 && clients[0].phone) {
                phoneCache[accountId] = normalizePhone(clients[0].phone);
                return phoneCache[accountId];
            }
            // Fallback by name
            if (customerName) {
                const byName = await sr.Client.filter({ full_name: customerName }, null, 1);
                if (byName.length > 0 && byName[0].phone) {
                    phoneCache[accountId] = normalizePhone(byName[0].phone);
                    return phoneCache[accountId];
                }
            }
            phoneCache[accountId] = null;
            return null;
        }

        // Load all call activities from last 3 days (covers 48h window from oldest tx)
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const callActivities = await sr.Activity.filter({
            activity_type: { $in: ['שיחה נכנסת', 'שיחה יוצאת'] },
            created_date: { $gte: threeDaysAgo }
        }, '-created_date', 1000);
        console.log(`📞 [NightlyMatcher] ${callActivities.length} call activities in last 3 days`);

        let forwardLinked = 0;
        let forwardSkipped = 0;
        let forwardNoPhone = 0;

        // Group transactions by doc_number to avoid double-linking same doc
        const processedDocs = new Set();

        for (const tx of transactions) {
            if (processedDocs.has(tx.doc_number)) continue;

            const phone = await getPhoneForAccount(tx.linet_account_id, tx.customer_name);
            if (!phone) { forwardNoPhone++; continue; }

            const variants = phoneSearchVariants(phone);
            const txDate = new Date(tx.issue_date || tx.sync_timestamp);
            const windowStart = new Date(txDate.getTime() - 48 * 60 * 60 * 1000);

            // Find matching calls: within 48h before tx, phone matches, not already linked
            const candidates = callActivities.filter(a => {
                if (a.content?.includes('עסקה:')) return false;
                const aDate = new Date(a.created_date);
                if (aDate < windowStart || aDate > txDate) return false;
                return variants.some(v => a.content?.includes(v));
            });

            if (candidates.length === 0) { forwardSkipped++; continue; }

            // Pick closest in time to the transaction
            candidates.sort((a, b) => {
                const diffA = Math.abs(txDate - new Date(a.created_date));
                const diffB = Math.abs(txDate - new Date(b.created_date));
                return diffA - diffB;
            });

            const best = candidates[0];
            await sr.Activity.update(best.id, {
                content: `${best.content} | עסקה: ${tx.doc_number} | סכום: ₪${tx.total_row_amount || 0}`
            });
            // Mark in-memory so reverse pass doesn't re-process
            best.content += ` | עסקה: ${tx.doc_number}`;
            processedDocs.add(tx.doc_number);
            forwardLinked++;
            console.log(`🔗 Forward: call ${best.id} → tx ${tx.doc_number} (${tx.customer_name})`);
        }

        // ── REVERSE: Call → Transaction ──
        let reverseLinked = 0;
        let reverseSkipped = 0;

        const unlinkedCalls = callActivities.filter(a => !a.content?.includes('עסקה:'));

        for (const call of unlinkedCalls) {
            // Extract phone from content
            const phoneMatch = call.content?.match(/\d{10,13}/);
            if (!phoneMatch) { reverseSkipped++; continue; }

            const callPhone = normalizePhone(phoneMatch[0]);
            if (!callPhone) { reverseSkipped++; continue; }

            const callDate = new Date(call.created_date);
            const windowEnd = new Date(callDate.getTime() + 48 * 60 * 60 * 1000);

            // Find customer by phone
            let customer = null;
            const clientVariants = phoneSearchVariants(callPhone);
            for (const v of clientVariants) {
                const results = await sr.Client.filter({ phone: v }, null, 1);
                if (results.length > 0) { customer = results[0]; break; }
            }
            if (!customer?.linet_account_id) { reverseSkipped++; continue; }

            // Find transactions for this customer within 48h after the call
            const matchingTx = transactions.filter(tx => {
                if (processedDocs.has(tx.doc_number)) return false;
                if (tx.linet_account_id !== customer.linet_account_id) return false;
                const txDate = new Date(tx.issue_date || tx.sync_timestamp);
                return txDate >= callDate && txDate <= windowEnd;
            });

            if (matchingTx.length === 0) { reverseSkipped++; continue; }

            // Pick closest
            matchingTx.sort((a, b) => {
                const diffA = Math.abs(new Date(a.issue_date || a.sync_timestamp) - callDate);
                const diffB = Math.abs(new Date(b.issue_date || b.sync_timestamp) - callDate);
                return diffA - diffB;
            });

            const bestTx = matchingTx[0];
            await sr.Activity.update(call.id, {
                content: `${call.content} | עסקה: ${bestTx.doc_number} | סכום: ₪${bestTx.total_row_amount || 0}`
            });
            processedDocs.add(bestTx.doc_number);
            reverseLinked++;
            console.log(`🔗 Reverse: call ${call.id} → tx ${bestTx.doc_number} (${bestTx.customer_name})`);
        }

        // ── Log results ──
        const totalLinked = forwardLinked + reverseLinked;
        await sr.SyncLog.create({
            sync_key: 'nightly_call_match',
            run_started_at: now.toISOString(),
            run_finished_at: new Date().toISOString(),
            status: 'SUCCESS',
            records_fetched: transactions.length,
            records_created: totalLinked,
            records_skipped: forwardSkipped + reverseSkipped,
            trigger_type: 'NIGHTLY',
            details_json: {
                forward_linked: forwardLinked,
                forward_skipped: forwardSkipped,
                forward_no_phone: forwardNoPhone,
                reverse_linked: reverseLinked,
                reverse_skipped: reverseSkipped,
                calls_scanned: callActivities.length,
            }
        });

        console.log(`✅ [NightlyMatcher] Done: forward=${forwardLinked}, reverse=${reverseLinked}, skipped=${forwardSkipped + reverseSkipped}`);

        return Response.json({
            success: true,
            transactions_scanned: transactions.length,
            calls_scanned: callActivities.length,
            forward_linked: forwardLinked,
            reverse_linked: reverseLinked,
            total_linked: totalLinked,
        });

    } catch (error) {
        console.error('❌ [NightlyMatcher] Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});