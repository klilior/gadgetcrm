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

        const { company_name } = await req.json();
        if (!company_name) {
            return Response.json({ error: 'חסר company_name' }, { status: 400 });
        }

        console.log('🔍 מחפש לקוח:', company_name);

        const credentials = await getLinetCredentials(base44);
        
        const payload = {
            ...credentials,
            limit: 5,
            offset: 0,
            query: { company_name }
        };

        console.log('📤 Payload:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${BASE_URL}/newsearch/client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('📥 Status:', response.status);

        const data = await response.json();
        console.log('📥 Response:', JSON.stringify(data, null, 2));

        return Response.json({
            success: true,
            status: response.status,
            data: data,
            found: data.body?.length || 0,
            clients: data.body || []
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