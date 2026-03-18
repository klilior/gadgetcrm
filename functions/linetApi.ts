import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const BASE_URL = "https://app.linet.org.il/api";

/**
 * Helper function to perform generic newsearch requests to Linet API
 * Handles authentication injection and standard payload structure
 */
async function genericNewsearch(base44, resource, query, limit = 100, offset = 0) {
    // Try to get from Env Vars first
    let login_id = Deno.env.get("LINET_LOGIN_ID");
    let login_hash = Deno.env.get("LINET_LOGIN_HASH");
    let login_company = Deno.env.get("LINET_LOGIN_COMPANY");

    // If not in Env, try to get from DB Settings
    if (!login_id || !login_hash || !login_company) {
        try {
            // Use service role to read settings to ensure we can read them even if RLS restricts
            const settingsList = await base44.asServiceRole.entities.Settings.list();
            const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;

            login_id = login_id || getSetting("LINET_LOGIN_ID");
            login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
            login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
        } catch (e) {
            console.warn("Failed to fetch settings from DB:", e);
        }
    }

    if (!login_id || !login_hash || !login_company) {
        throw new Error("Configuration Error: Missing Linet credentials. Please set LINET_LOGIN_ID, LINET_LOGIN_HASH, and LINET_LOGIN_COMPANY in Settings.");
    }

    const payload = {
        login_id,
        login_hash,
        login_company: Number(login_company), // Ensure number format as per API docs
        limit: Number(limit),
        offset: Number(offset),
        query,
        // Request owner_id field which is sometimes not included by default or named differently
        // Linet API is flexible, but ensuring we get fields if possible. 
        // Actually generic search returns what it returns. We can't easily force fields in newsearch payload structure 
        // without knowing specific projection params. We'll assume default returns enough.
    };

    console.log(`🚀 [Linet API] Requesting ${resource}:`, JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(`${BASE_URL}/newsearch/${resource}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        console.log(`✅ [Linet API] Response from ${resource}:`, JSON.stringify(data, null, 2).substring(0, 2000));

        // Check for Linet specific application errors (sometimes returns 200 but with error code)
        if (data.errorCode && data.errorCode !== 0) {
             throw new Error(`Linet App Error (${data.errorCode}): ${data.text || 'Unknown error'}`);
        }

        return data;

    } catch (error) {
        console.error(`❌ [Linet API] Error in ${resource}:`, error);
        throw error;
    }
}

Deno.serve(async (req) => {
    try {
        // 1. Authentication Check
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse Request
        const { action, params } = await req.json();
        
        let result;

        // 3. Route Actions
        switch (action) {
            case 'searchDocuments': {
                // Params: date_from (YYYY-MM-DD), date_to (YYYY-MM-DD), doctypes (array), refstatus (optional)
                const { date_from, date_to, doctypes, refstatus, limit, offset } = params || {};
                
                if (!date_from || !date_to) {
                    throw new Error("Missing required params: date_from, date_to");
                }

                const query = {
                    issue_date: `${date_from} to ${date_to}`,
                    doctype: doctypes || ["3", "4", "9"], // Default to Tax Invoice (3), Credit Invoice (4), and Receipt-Invoice (9)
                    refstatus: refstatus !== undefined ? refstatus : null
                };

                result = await genericNewsearch(base44, 'docs', query, limit || 100, offset || 0);
                break;
            }

            case 'searchItemBySku': {
                // Params: sku (string)
                const { sku } = params || {};

                if (!sku) {
                    throw new Error("Missing required param: sku");
                }

                const query = {
                    sku: sku
                };

                // Limit 1 for single item search
                result = await genericNewsearch(base44, 'item', query, 1, 0);
                break;
            }

            case 'searchClient': {
                // Params: company_name (string) or client_id (number)
                const { company_name, client_id } = params || {};

                if (!company_name && !client_id) {
                    throw new Error("Missing required param: company_name or client_id");
                }

                const query = {};
                if (client_id) query.id = client_id;
                if (company_name) query.company_name = company_name;

                result = await genericNewsearch(base44, 'client', query, 10, 0);
                break;
            }

            default:
                return Response.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
        }

        return Response.json({ success: true, data: result });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});