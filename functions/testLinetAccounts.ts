import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const BASE_URL = "https://app.linet.org.il/api";

async function getLinetCredentials(base44) {
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

    if (!login_id || !login_hash || !login_company) {
        throw new Error("Missing Linet credentials");
    }

    return { login_id, login_hash, login_company: Number(login_company) };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        const body = await req.json();
        const { account_ids } = body;

        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
            return Response.json({ error: 'חסר account_ids או רשימה ריקה' }, { status: 400 });
        }

        console.log('🔍 בודק חשבונות:', account_ids);

        const credentials = await getLinetCredentials(base44);
        
        const payload = {
            ...credentials,
            limit: 200,
            offset: 0,
            query: { id: account_ids }
        };

        console.log('📤 Request Payload:');
        console.log(JSON.stringify(payload, null, 2));

        const response = await fetch(`${BASE_URL}/newsearch/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('📥 Status:', response.status);
        console.log('📥 Headers:', Object.fromEntries(response.headers.entries()));

        const responseText = await response.text();
        console.log('📥 Raw Response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            return Response.json({
                success: false,
                error: 'Failed to parse response',
                raw_response: responseText,
                status: response.status
            }, { status: 500 });
        }

        console.log('📥 Parsed Response:');
        console.log(JSON.stringify(data, null, 2));

        // Analyze the response
        const analysis = {
            success: response.ok && data.errorCode === 0,
            status: response.status,
            error_code: data.errorCode,
            error_message: data.text,
            accounts_found: data.body?.length || 0,
            sample_account: data.body?.[0] || null
        };

        if (data.body && data.body.length > 0) {
            const sampleAccount = data.body[0];
            analysis.fields_available = Object.keys(sampleAccount);
            analysis.phone_fields = {
                phone: sampleAccount.phone || null,
                phone1: sampleAccount.phone1 || null,
                phone2: sampleAccount.phone2 || null,
                mobile: sampleAccount.mobile || null
            };
            analysis.contact_fields = {
                email: sampleAccount.email || null,
                city: sampleAccount.city || null,
                address: sampleAccount.address || null,
                id_number: sampleAccount.id_number || sampleAccount.passport_id || null
            };
        }

        return Response.json({
            success: analysis.success,
            analysis,
            full_response: data,
            requested_ids: account_ids,
            message: analysis.success 
                ? `✅ מצאנו ${analysis.accounts_found} חשבונות`
                : `❌ שגיאה: ${analysis.error_message}`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});