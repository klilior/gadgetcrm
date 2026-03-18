import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const BASE_URL = "https://app.linet.org.il/api";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

        const body = await req.json().catch(() => ({}));
        const targetDocId = body.doc_id || '27607';

        // Get Linet creds
        let login_id = Deno.env.get("LINET_LOGIN_ID");
        let login_hash = Deno.env.get("LINET_LOGIN_HASH");
        let login_company = Deno.env.get("LINET_LOGIN_COMPANY");

        if (!login_id || !login_hash || !login_company) {
            const settingsList = await base44.asServiceRole.entities.Settings.list();
            const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
            login_id = login_id || getSetting("LINET_LOGIN_ID");
            login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
            login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
        }

        const credentials = { login_id, login_hash, login_company: Number(login_company) };

        // Fetch this specific date
        const payload = {
            ...credentials,
            limit: 50,
            offset: 0,
            query: {
                issue_date: "2026-03-18 to 2026-03-18",
                doctype: ["9", "3"],
                refstatus: null
            }
        };

        const response = await fetch(`${BASE_URL}/newsearch/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const docs = data.body || [];

        // Find the target doc
        const targetDoc = docs.find(d => String(d.id) === targetDocId || String(d.docnum) === targetDocId);

        if (!targetDoc) {
            return Response.json({ 
                error: 'Doc not found',
                available_docs: docs.map(d => ({ id: d.id, docnum: d.docnum, company: d.company }))
            });
        }

        // Extract just the line items with all fields
        const lineItems = (targetDoc.docDetailes || []).map(line => ({
            name: line.name,
            sku: line.sku,
            qty: line.qty,
            serial: line.serial,
            serial_number: line.serial_number,
            imei: line.imei,
            sn: line.sn,
            // Log ALL keys so we see what Linet returns
            all_keys: Object.keys(line)
        }));

        return Response.json({
            doc_id: targetDoc.id,
            docnum: targetDoc.docnum,
            company: targetDoc.company,
            phone: targetDoc.phone,
            account_id: targetDoc.account_id,
            line_items: lineItems,
            // Also log top-level doc keys
            doc_keys: Object.keys(targetDoc)
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});