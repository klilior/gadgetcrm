import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ACCESSORY_CATEGORIES = ['אביזרים סלולריים', 'טאבלטים', 'טלפונים למבוגרים'];

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

        const acc = txs.filter(t => ACCESSORY_CATEGORIES.includes((t.category || '').trim()));
        let accNet = 0;
        acc.forEach(t => { accNet += getSign(t) * Math.abs(Number(t.price_ex_vat || 0)); });

        // Only return non-accessory categories summary (this holds the missing gap)
        const nonAcc = txs.filter(t => !ACCESSORY_CATEGORIES.includes((t.category || '').trim()));
        const nonAccByCat = {};
        nonAcc.forEach(t => {
            const c = (t.category || 'ריק').trim();
            if (!nonAccByCat[c]) nonAccByCat[c] = { count: 0, net: 0, lines: [] };
            const v = getSign(t) * Math.abs(Number(t.price_ex_vat || 0));
            nonAccByCat[c].count++;
            nonAccByCat[c].net += v;
            nonAccByCat[c].lines.push({ doc: t.doc_number, sku: t.sku, name: t.product_name, price_ex_vat: t.price_ex_vat });
        });
        Object.values(nonAccByCat).forEach(g => g.net = Math.round(g.net * 100) / 100);

        return Response.json({
            success: true,
            accessory_lines_count: acc.length,
            accessories_net_ex_vat: Math.round(accNet * 100) / 100,
            file_target: 15031.55,
            gap: Math.round((15031.55 - accNet) * 100) / 100,
            non_accessory_categories: nonAccByCat,
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});