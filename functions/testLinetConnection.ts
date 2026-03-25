import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const BASE_URL = "https://app.linet.org.il/api";

Deno.serve(async (req) => {
    console.log("🔬 Testing Linet Connection...");
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        // Get credentials
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

        const credentialsStatus = {
            login_id: login_id ? `✅ Set (${String(login_id).substring(0, 4)}...)` : "❌ MISSING",
            login_hash: login_hash ? `✅ Set (${String(login_hash).substring(0, 4)}...)` : "❌ MISSING",
            login_company: login_company ? `✅ Set (${login_company})` : "❌ MISSING"
        };

        if (!login_id || !login_hash || !login_company) {
            return Response.json({ 
                success: false, 
                error: "Missing Linet credentials",
                credentials: credentialsStatus 
            });
        }

        // Parse body for test parameters
        let body = {};
        try {
            const text = await req.text();
            if (text) body = JSON.parse(text);
        } catch (e) {
            console.log("No body or invalid JSON, using defaults");
        }
        const testDateFrom = body.date_from || '2025-11-01';
        const testDateTo = body.date_to || '2025-12-01';

        // Test 1: Basic API Connection (no query)
        console.log("📡 Test 1: Basic docs query...");
        
        const payload1 = {
            login_id,
            login_hash,
            login_company: Number(login_company),
            limit: 5,
            offset: 0
        };

        const res1 = await fetch(`${BASE_URL}/newsearch/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload1)
        });

        const data1 = await res1.json();
        
        // Test 2: With date filter (exact format that works)
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        console.log(`📡 Test 2: Docs for yesterday ${yesterday}...`);
        
        const payload2 = {
            login_id,
            login_hash,
            login_company: Number(login_company),
            limit: 100,
            query: { 
                issue_date: `${yesterday} to ${yesterday}`,
                doctype: ["9", "3"],
                refstatus: null
            }
        };

        console.log("Payload 2:", JSON.stringify(payload2));

        const res2 = await fetch(`${BASE_URL}/newsearch/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload2)
        });

        const data2 = await res2.json();

        // Test 3: With custom date range
        console.log(`📡 Test 3: Docs with custom range ${testDateFrom} to ${testDateTo}...`);
        
        const payload3 = {
            login_id,
            login_hash,
            login_company: Number(login_company),
            limit: 100,
            query: { 
                issue_date: `${testDateFrom} to ${testDateTo}`,
                doctype: ["9", "3"],
                refstatus: null
            }
        };

        console.log("Payload 3:", JSON.stringify(payload3));

        const res3 = await fetch(`${BASE_URL}/newsearch/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload3)
        });

        const data3 = await res3.json();

        // Analyze results
        const analysis = {
            test1_basic: {
                status: res1.status,
                hasBody: !!data1.body,
                bodyLength: data1.body?.length || 0,
                errorCode: data1.errorCode,
                firstDoc: data1.body?.[0] ? {
                    id: data1.body[0].id,
                    docnum: data1.body[0].docnum,
                    doctype: data1.body[0].doctype,
                    issue_date: data1.body[0].issue_date,
                    owner: data1.body[0].owner,
                    company_name: data1.body[0].company_name
                } : null
            },
            test2_dateFilter: {
                status: res2.status,
                hasBody: !!data2.body,
                bodyLength: data2.body?.length || 0,
                errorCode: data2.errorCode,
                sampleDocs: data2.body?.slice(0, 3).map(d => ({
                    id: d.id,
                    docnum: d.docnum,
                    doctype: d.doctype,
                    issue_date: d.issue_date
                })) || []
            },
            test3_withDoctype: {
                status: res3.status,
                hasBody: !!data3.body,
                bodyLength: data3.body?.length || 0,
                errorCode: data3.errorCode,
                doctypes: [...new Set((data3.body || []).map(d => d.doctype))]
            }
        };

        // Check if any test found data
        const totalDocsFound = (data1.body?.length || 0) + (data2.body?.length || 0) + (data3.body?.length || 0);

        return Response.json({ 
            success: true, 
            credentials: credentialsStatus,
            testParams: { date_from: testDateFrom, date_to: testDateTo },
            analysis,
            totalDocsFound,
            recommendation: totalDocsFound === 0 
                ? "❌ לא נמצאו מסמכים בכלל - בדוק את פרטי ההתחברות או שאין מסמכים בטווח זה"
                : `✅ נמצאו ${totalDocsFound} מסמכים בבדיקות`,
            rawResponses: {
                test1: data1,
                test2: data2,
                test3: data3
            }
        });

    } catch (error) {
        console.error("❌ Test Error:", error.message);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});