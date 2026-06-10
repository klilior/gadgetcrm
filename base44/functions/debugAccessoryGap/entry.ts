import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ACCESSORY_CATEGORIES = ['אביזרים סלולריים', 'טאבלטים', 'טלפונים למבוגרים'];
// SKUs the user explicitly confirmed are NOT accessories
const EXCLUDE_SKUS = ['3333', '368459', '1991705009'];

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

        const body = await req.json().catch(() => ({}));
        const dateFrom = body.date_from || '2026-06-01';
        const dateTo = body.date_to || '2026-06-10';
        const owner = body.owner || 'דניאל';

        const txs = await base44.asServiceRole.entities.SalesTransaction.filter(
            { issue_date: { $gte: dateFrom, $lte: dateTo }, sales_rep: owner }, null, 10000
        );

        const getSign = (s) => {
            const raw = String(s?.doc_type ?? '').trim();
            const isCredit = /זיכוי|זכוי|credit/i.test(raw) || Number(s.price_ex_vat || 0) < 0 || Number(s.quantity || 0) < 0;
            return isCredit ? -1 : 1;
        };

        // Non-accessory lines, excluding the SKUs user confirmed are correct
        const nonAcc = txs.filter(t =>
            !ACCESSORY_CATEGORIES.includes((t.category || '').trim()) &&
            !EXCLUDE_SKUS.includes(String(t.sku || '').trim())
        );

        let remainingNet = 0;
        const lines = nonAcc
            .map(t => {
                const v = getSign(t) * Math.abs(Number(t.price_ex_vat || 0));
                remainingNet += v;
                return { doc: t.doc_number, sku: t.sku, name: t.product_name, category: (t.category || 'ריק').trim(), price_ex_vat: t.price_ex_vat, signed: Math.round(v * 100) / 100 };
            })
            .filter(l => Math.abs(l.signed) > 0.5)
            .sort((a, b) => b.signed - a.signed);

        return Response.json({
            success: true,
            remaining_non_accessory_net: Math.round(remainingNet * 100) / 100,
            note: 'These are non-accessory lines AFTER excluding SKUs 3333/368459/1991705009',
            lines,
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});