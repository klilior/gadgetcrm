import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const BASE_URL = "https://app.linet.org.il/api";

Deno.serve(async (req) => {
    console.log("🔬 Checking Linet for recent days...");
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        // Get credentials
        const settingsList = await base44.asServiceRole.entities.Settings.list();
        const getSetting = (name) => settingsList.find(s => s.setting_name === name)?.setting_value;
        
        const login_id = Deno.env.get("LINET_LOGIN_ID") || getSetting("LINET_LOGIN_ID");
        const login_hash = Deno.env.get("LINET_LOGIN_HASH") || getSetting("LINET_LOGIN_HASH");
        const login_company = Number(Deno.env.get("LINET_LOGIN_COMPANY") || getSetting("LINET_LOGIN_COMPANY"));

        // Test for dates 2025-12-03 and 2025-12-04
        const results = {};
        
        for (const testDate of ['2025-12-02', '2025-12-03', '2025-12-04']) {
            console.log(`📡 Checking ${testDate}...`);
            
            const payload = {
                login_id,
                login_hash,
                login_company,
                limit: 100,
                offset: 0,
                query: { 
                    issue_date: `${testDate} to ${testDate}`,
                    doctype: ["9", "3", "4"],
                    refstatus: null
                }
            };

            const res = await fetch(`${BASE_URL}/newsearch/docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            
            results[testDate] = {
                httpStatus: res.status,
                count: data.body?.length || 0,
                errorCode: data.errorCode,
                docs: (data.body || []).slice(0, 5).map(d => ({
                    id: d.id,
                    docnum: d.docnum,
                    doctype: d.doctype,
                    issue_date: d.issue_date,
                    company_name: d.company_name
                }))
            };
        }

        return Response.json({ 
            success: true, 
            message: "בדיקת מסמכים ל-3 ימים אחרונים",
            results,
            summary: {
                '2025-12-02': results['2025-12-02']?.count || 0,
                '2025-12-03': results['2025-12-03']?.count || 0,
                '2025-12-04': results['2025-12-04']?.count || 0
            }
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});