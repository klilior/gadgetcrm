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

    return { login_id, login_hash, login_company: Number(login_company) };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        console.log('🔍 Step 1: Looking for recent sales transactions with account_id...');

        // Get recent sales transactions from Linet sync
        const transactions = await base44.asServiceRole.entities.SalesTransaction.filter(
            { linet_account_id: { $exists: true } },
            '-sync_timestamp',
            10
        );

        if (transactions.length === 0) {
            return Response.json({
                success: false,
                error: 'No sales transactions with linet_account_id found'
            });
        }

        const sampleTx = transactions[0];
        const accountId = sampleTx.linet_account_id;

        console.log(`✅ Found transaction: ${sampleTx.customer_name} (Doc: ${sampleTx.doc_number})`);
        console.log(`   Account ID: ${accountId}`);

        // Try to fetch from Linet
        console.log('\n📞 Step 2: Fetching account from Linet API...');

        const credentials = await getLinetCredentials(base44);
        
        const payload = {
            ...credentials,
            limit: 5,
            offset: 0,
            query: { id: [accountId] }
        };

        console.log('Request:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${BASE_URL}/newsearch/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('\nRaw Response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            return Response.json({
                success: false,
                error: 'Failed to parse Linet response',
                raw_response: responseText,
                contract: {
                    customer_name: sampleContract.customer_name,
                    linet_account_id: accountId
                }
            });
        }

        console.log('\nParsed Response:', JSON.stringify(data, null, 2));

        // Analyze what we got
        const result = {
            transaction_sample: {
                customer_name: sampleTx.customer_name,
                doc_number: sampleTx.doc_number,
                linet_account_id: accountId,
                sync_date: sampleTx.sync_timestamp
            },
            linet_api_response: {
                status: response.status,
                error_code: data.errorCode,
                error_message: data.text,
                accounts_found: data.body?.length || 0
            },
            success: false
        };

        if (data.errorCode && data.errorCode !== 0) {
            result.error = `Linet API Error ${data.errorCode}: ${data.text}`;
            return Response.json(result);
        }

        if (!data.body || data.body.length === 0) {
            result.error = 'Account not found in Linet';
            return Response.json(result);
        }

        const account = data.body[0];
        result.success = true;
        result.linet_account = {
            id: account.id,
            uuid: account.uuid,
            name: account.name || account.company || account.company_name,
            phone: account.phone,
            phone1: account.phone1,
            phone2: account.phone2,
            mobile: account.mobile,
            email: account.email,
            city: account.city,
            address: account.address,
            id_number: account.id_number || account.passport_id,
            all_fields: Object.keys(account)
        };

        result.mapping_preview = {
            linet_account_id: account.id,
            name: account.name || account.company || account.company_name || 'Unknown',
            phone_1: account.phone || account.phone1 || null,
            phone_2: account.phone2 || null,
            mobile: account.mobile || null,
            email: account.email || null,
            city: account.city || null,
            address: account.address || null,
            id_number: account.id_number || account.passport_id || null
        };

        result.comparison = {
            linet_has_phone: !!(account.phone || account.phone1 || account.mobile),
            best_phone: account.phone || account.phone1 || account.mobile || 'אין טלפון'
        };

        console.log('\n✅ SUCCESS - Account data retrieved from Linet');

        return Response.json(result);

    } catch (error) {
        console.error('❌', error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});