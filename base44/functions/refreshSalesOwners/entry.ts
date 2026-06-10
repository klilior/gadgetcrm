import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = "https://app.linet.org.il/api";

/**
 * Refreshes ONLY the sales_rep (owner) field of existing SalesTransaction records
 * for a date range, based on the current owner in Linet.
 * Lightweight: fetches docs once, updates only changed owners. No create/delete.
 * Admin only.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const dateFrom = body.date_from || '2026-06-01';
        const dateTo = body.date_to || '2026-06-10';

        // Credentials
        let login_id = Deno.env.get("LINET_LOGIN_ID");
        let login_hash = Deno.env.get("LINET_LOGIN_HASH");
        let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
        if (!login_id || !login_hash || !login_company) {
            const settingsList = await base44.asServiceRole.entities.Settings.list();
            const get = (n) => settingsList.find((s) => s.setting_name === n)?.setting_value;
            login_id = login_id || get("LINET_LOGIN_ID");
            login_hash = login_hash || get("LINET_LOGIN_HASH");
            login_company = login_company || get("LINET_LOGIN_COMPANY");
        }

        // Users map
        const usersList = await base44.asServiceRole.entities.LinetUsersMap.list(null, 1000);
        const usersMap = {};
        usersList.forEach((u) => (usersMap[String(u.user_id)] = u.user_name));

        // Fetch all docs in range (build doc_id -> owner_name map)
        const ownerByDocId = {};
        let offset = 0;
        const LIMIT = 50;
        let more = true;
        while (more) {
            const payload = {
                login_id, login_hash, login_company: Number(login_company),
                limit: LIMIT, offset,
                query: { issue_date: `${dateFrom} to ${dateTo}`, doctype: ["9", "3", "4"], refstatus: null },
            };
            const resp = await fetch(`${BASE_URL}/newsearch/docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) break;
            const data = await resp.json();
            const docs = data.body || [];
            for (const d of docs) {
                const ownerName = usersMap[String(d.owner)] || String(d.owner);
                ownerByDocId[String(d.id)] = ownerName;
            }
            if (docs.length < LIMIT) more = false;
            else offset += LIMIT;
        }

        // Load existing transactions in range and update sales_rep where it differs
        const txs = await base44.asServiceRole.entities.SalesTransaction.filter(
            { issue_date: { $gte: dateFrom, $lte: dateTo } }, null, 10000
        );

        let updated = 0, unchanged = 0, no_linet_match = 0;
        const changes = {};
        for (const tx of txs) {
            const correctOwner = ownerByDocId[String(tx.linet_doc_id)];
            if (!correctOwner) { no_linet_match++; continue; }
            if (tx.sales_rep !== correctOwner) {
                await base44.asServiceRole.entities.SalesTransaction.update(tx.id, { sales_rep: correctOwner });
                updated++;
                const key = `${tx.sales_rep || 'ריק'} → ${correctOwner}`;
                changes[key] = (changes[key] || 0) + 1;
            } else {
                unchanged++;
            }
        }

        return Response.json({
            success: true,
            date_range: `${dateFrom} to ${dateTo}`,
            docs_from_linet: Object.keys(ownerByDocId).length,
            transactions_checked: txs.length,
            updated, unchanged, no_linet_match,
            changes,
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});