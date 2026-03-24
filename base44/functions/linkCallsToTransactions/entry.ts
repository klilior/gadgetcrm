import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 13 && digits.startsWith('9720')) {
        digits = digits.slice(3);
    } else if (digits.length === 12 && digits.startsWith('972')) {
        digits = '0' + digits.slice(3);
    } else if (digits.startsWith('0972') && digits.length > 12) {
        digits = '0' + digits.slice(4);
    }
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
    const variants = new Set();
    variants.add(normalized);
    variants.add('972' + normalized.slice(1));
    variants.add('+972' + normalized.slice(1));
    variants.add('9720' + normalized.slice(1));
    variants.add('+9720' + normalized.slice(1));
    return [...variants];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;

        // Get transactions from last 2 hours
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const recentTransactions = await sr.SalesTransaction.filter({
            sync_timestamp: { $gte: twoHoursAgo }
        }, '-sync_timestamp', 200);

        console.log(`🔗 [LinkCalls] Found ${recentTransactions.length} recent transactions`);

        let linked = 0;
        let skipped = 0;
        let noPhone = 0;

        for (const tx of recentTransactions) {
            // Find customer for this transaction
            let customerPhone = null;

            // Try by linet_account_id first
            if (tx.linet_account_id) {
                const clients = await sr.Client.filter({ linet_account_id: tx.linet_account_id }, null, 1);
                if (clients.length > 0 && clients[0].phone) {
                    customerPhone = normalizePhone(clients[0].phone);
                }
            }

            // Fallback: try by customer_name
            if (!customerPhone && tx.customer_name) {
                const clients = await sr.Client.filter({ full_name: tx.customer_name }, null, 1);
                if (clients.length > 0 && clients[0].phone) {
                    customerPhone = normalizePhone(clients[0].phone);
                }
            }

            if (!customerPhone) {
                noPhone++;
                continue;
            }

            // Search for call activities within 3 hours BEFORE the transaction
            const txDate = new Date(tx.issue_date || tx.sync_timestamp);
            const threeHoursBefore = new Date(txDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
            const txDateStr = txDate.toISOString();

            const callActivities = await sr.Activity.filter({
                activity_type: { $in: ['שיחה נכנסת', 'שיחה יוצאת'] },
                created_date: { $gte: threeHoursBefore, $lte: txDateStr }
            }, '-created_date', 20);

            // Find a matching call by phone number in content
            const variants = phoneSearchVariants(customerPhone);
            let matchedCall = null;

            for (const call of callActivities) {
                // Skip if already linked to a transaction
                if (call.content?.includes('עסקה:')) continue;

                // Check if any phone variant appears in the content
                const hasPhoneMatch = variants.some(v => call.content?.includes(v));
                if (hasPhoneMatch) {
                    matchedCall = call;
                    break; // Most recent match (already sorted by -created_date)
                }
            }

            if (matchedCall) {
                const updateContent = `${matchedCall.content} | עסקה: ${tx.doc_number} | סכום: ₪${tx.total_row_amount || 0}`;
                await sr.Activity.update(matchedCall.id, { content: updateContent });
                console.log(`🔗 Linked call ${matchedCall.id} to transaction ${tx.doc_number} for customer ${tx.customer_name}`);
                linked++;
            } else {
                skipped++;
            }
        }

        // Log results
        await sr.SyncLog.create({
            sync_key: 'link_calls_transactions',
            run_started_at: new Date().toISOString(),
            status: 'SUCCESS',
            records_fetched: recentTransactions.length,
            records_created: linked,
            records_skipped: skipped,
            trigger_type: 'MANUAL',
            details_json: { no_phone: noPhone, linked, skipped }
        });

        console.log(`✅ [LinkCalls] Done: ${linked} linked, ${skipped} skipped, ${noPhone} no phone`);

        return Response.json({
            success: true,
            transactions_checked: recentTransactions.length,
            linked,
            skipped,
            no_phone: noPhone
        });

    } catch (error) {
        console.error('❌ [LinkCalls] Error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});