import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Daily job: link unlinked call Activities to Client cards.
 * 
 * Scenario: a customer calls, but isn't in the system yet. Later they purchase
 * (via website or rep) and a Client record is created. This job retroactively
 * links the call activity to the new customer card.
 * 
 * Looks back 3 days by default (configurable via days_back param).
 */

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

function extractPhoneFromContent(content) {
    if (!content) return null;
    // Try multiple patterns:
    // "מ-שם (0541234567)" or "- 0541234567" or "מספר: 0541234567"
    const patterns = [
        /\((\+?[\d\-]{9,13})\)/,          // (0541234567)
        /- (\+?[\d]{9,13})/,               // - 0541234567
        /מספר:\s*([\d\-+]{9,13})/,         // מספר: 0541234567
        /(\d{10})/,                         // any 10-digit number
    ];
    for (const pat of patterns) {
        const m = content.match(pat);
        if (m) {
            const norm = normalizePhone(m[1]);
            if (norm) return norm;
        }
    }
    return null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow admin or scheduled automation
        let user = null;
        try { user = await base44.auth.me(); } catch (_) {}
        if (user && user.role !== 'admin' && user.role !== 'מנהל') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const sr = base44.asServiceRole.entities;
        const body = await req.json().catch(() => ({}));
        const daysBack = body.days_back || 3;

        const since = new Date();
        since.setDate(since.getDate() - daysBack);
        const sinceStr = since.toISOString();

        // Fetch recent call activities WITHOUT a linked customer (order_id is empty)
        const [inActivities, outActivities] = await Promise.all([
            sr.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 500),
            sr.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 200),
        ]);

        // Filter: within date range AND no customer linked yet
        const unlinkedActivities = [...inActivities, ...outActivities].filter(a =>
            a.created_date >= sinceStr && !a.order_id
        );

        console.log(`🔗 [LinkCalls] Found ${unlinkedActivities.length} unlinked call activities in last ${daysBack} days`);

        let linked = 0;
        let noMatch = 0;
        const phoneCache = {}; // phone -> client or null

        for (const activity of unlinkedActivities) {
            // Extract phone from content
            const phone = extractPhoneFromContent(activity.content);
            if (!phone) { noMatch++; continue; }

            // Check cache first
            let customer = phoneCache[phone];
            if (customer === undefined) {
                // Search by all phone variants
                const variants = [phone, '972' + phone.slice(1), '+972' + phone.slice(1)];
                customer = null;
                for (const variant of variants) {
                    const results = await sr.Client.filter({ phone: variant }, null, 1).catch(() => []);
                    if (results.length > 0) { customer = results[0]; break; }
                }
                phoneCache[phone] = customer || null;
            }

            if (!customer) { noMatch++; continue; }

            // Link: set order_id to customer ID
            const updates = { order_id: customer.id };

            // Update summary to include customer name if it's generic
            if (activity.summary && !activity.summary.includes(customer.full_name)) {
                const isIncoming = activity.activity_type === 'שיחה נכנסת';
                updates.summary = `שיחה ${isIncoming ? 'מ' : 'ל'}-${customer.full_name}`;
            }

            await sr.Activity.update(activity.id, updates);
            linked++;
            console.log(`🔗 [LinkCalls] Linked activity ${activity.id} (${phone}) → ${customer.full_name} (${customer.id})`);
        }

        const stats = { total: unlinkedActivities.length, linked, noMatch, daysBack };
        console.log(`✅ [LinkCalls] Done:`, JSON.stringify(stats));

        await sr.SyncLog.create({
            sync_key: 'link_calls_to_customers',
            run_started_at: new Date().toISOString(),
            status: linked > 0 ? 'SUCCESS' : 'PARTIAL',
            records_fetched: unlinkedActivities.length,
            records_created: linked,
            records_skipped: noMatch,
            trigger_type: body.trigger_type || 'MANUAL',
            details_json: stats,
        });

        return Response.json({ success: true, stats });
    } catch (error) {
        console.error('❌ [LinkCalls] Fatal:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});