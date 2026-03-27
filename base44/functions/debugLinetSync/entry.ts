import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format, subDays } from 'npm:date-fns@2.30.0';

const BASE_URL = "https://app.linet.org.il/api";

Deno.serve(async (req) => {
    const logs = [];
    const log = (msg) => { console.log(msg); logs.push(msg); };
    
    try {
        log("🚀 Debug Sync Starting...");
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        // Get Linet credentials from Settings
        const settingsList = await base44.asServiceRole.entities.Settings.list();
        const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
        
        const login_id = getSetting("LINET_LOGIN_ID");
        const login_hash = getSetting("LINET_LOGIN_HASH");
        const login_company = getSetting("LINET_LOGIN_COMPANY");

        log(`📋 Credentials found: login_id=${login_id ? 'YES' : 'NO'}, hash=${login_hash ? 'YES' : 'NO'}, company=${login_company}`);

        if (!login_id || !login_hash || !login_company) {
            return Response.json({ success: false, error: "Missing Linet credentials in Settings", logs });
        }

        // Date range - Targeted for specific document debug
        const dateFrom = format(subDays(new Date(), 30), 'yyyy-MM-dd');
        const dateTo = format(new Date(), 'yyyy-MM-dd');
        const targetDocNum = "300142";
        log(`📅 Date range: ${dateFrom} to ${dateTo} (Targeting doc ${targetDocNum})`);

        // Call Linet API
        const payload = {
            login_id,
            login_hash,
            login_company: Number(login_company),
            limit: 200, // Increased limit to find it
            offset: 0,
            query: {
                issue_date: `${dateFrom} to ${dateTo}`
            }
        };

        log("📡 Calling Linet API with payload...");
        
        const response = await fetch(`${BASE_URL}/newsearch/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        log(`📡 Response status: ${response.status}`);

        if (!response.ok) {
            const errText = await response.text();
            log(`❌ HTTP Error: ${errText}`);
            return Response.json({ success: false, error: errText, logs });
        }

        const apiResponse = await response.json();
        
        log(`📦 API Response keys: ${Object.keys(apiResponse).join(', ')}`);
        log(`📦 status: ${apiResponse.status}`);
        log(`📦 text: ${apiResponse.text}`);
        log(`📦 body type: ${typeof apiResponse.body}`);
        log(`📦 body is array: ${Array.isArray(apiResponse.body)}`);
        log(`📦 body length: ${apiResponse.body?.length}`);

        if (!Array.isArray(apiResponse.body) || apiResponse.body.length === 0) {
            return Response.json({ 
                success: false, 
                error: "No documents in response.body", 
                apiResponse,
                logs 
            });
        }

        // Find target doc
        const targetDoc = apiResponse.body.find(d => String(d.docnum) === targetDocNum || String(d.name) === targetDocNum);

        if (!targetDoc) {
            log(`❌ Document ${targetDocNum} not found in the response`);
            return Response.json({ success: false, error: `Doc ${targetDocNum} not found`, logs, allDocsFound: apiResponse.body.map(d => `${d.docnum} (Type: ${d.doctype})`) });
        }

        log(`\n🎯 FOUND DOCUMENT ${targetDocNum}:`);
        log(JSON.stringify(targetDoc, null, 2));

        const docType = Number(targetDoc.doctype);
        let analysis = "";
        if ([3, 4, 9].includes(docType)) {
            const typeName = docType === 4 ? 'Credit Invoice' : (docType === 3 ? 'Invoice (3)' : 'Invoice-Receipt');
            analysis = `✅ TYPE ${docType}: VALID. Will be synced as ${typeName}.`;
        } else {
            analysis = `⛔ TYPE ${docType}: INVALID. Will be SKIPPED (Only types 3, 4, and 9 are allowed).`;
        }
        log(`\n⚖️ SYNC DECISION: ${analysis}`);

        // Return debug info
        return Response.json({ 
            success: true, 
            logs,
            targetDocRaw: targetDoc,
            analysis
        });

    } catch (error) {
        log(`❌ Error: ${error.message}`);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            logs 
        }, { status: 500 });
    }
});