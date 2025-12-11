import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format } from 'npm:date-fns@2.30.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        const { file_url } = await req.json();
        if (!file_url) return Response.json({ error: 'חסר file_url' }, { status: 400 });

        console.log('📥 ייבוא פשוט:', file_url);
        
        const fileRes = await fetch(file_url);
        const XLSX = await import('npm:xlsx@0.18.5');
        const wb = XLSX.read(new Uint8Array(await fileRes.arrayBuffer()), { type: 'array' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

        if (data.length < 2) return Response.json({ error: 'קובץ ריק' }, { status: 400 });

        const headers = data[0];
        
        // טוען לקוחות וסוכנים קיימים
        const [existingClients, agents, carriers] = await Promise.all([
            base44.asServiceRole.entities.Client.list(null, 10000),
            base44.asServiceRole.entities.LinetUsersMap.list(null, 200),
            base44.asServiceRole.entities.CarrierPolicy.filter({ is_active: true })
        ]);

        const clientMap = Object.fromEntries(existingClients.map(c => [c.full_name?.trim(), c.id]));
        const agentMap = Object.fromEntries(agents.map(a => [a.user_name.toLowerCase(), a.user_id]));
        const carrierMap = Object.fromEntries(carriers.map(c => [c.carrier_code, c]));
        const defaultAgent = agents[0];
        const defaultCarrier = carriers[0]; // פלאפון ברירת מחדל

        // מיפוי עמודות
        const colMap = {};
        headers.forEach(h => {
            h = String(h || '').trim();
            if (h === 'חברה') colMap[h] = 'customer_name';
            else if (h === 'מספר מסמך') colMap[h] = 'doc_number';
            else if (h.includes('תאריך')) colMap[h] = 'issue_date';
            else if (h === 'יצ"מ' || h === 'יצמ') colMap[h] = 'agent_name';
        });

        const stats = { total: 0, created: 0, skipped: 0 };
        const clientsToCreate = new Map();
        const contractsToCreate = [];

        // איסוף לקוחות חדשים
        for (let i = 1; i < data.length; i++) {
            const rowData = data[i];
            const row = {};
            headers.forEach((h, idx) => {
                if (colMap[h]) row[colMap[h]] = rowData[idx];
            });

            if (!row.customer_name || !row.doc_number || !row.issue_date) continue;

            const name = String(row.customer_name).trim();
            if (!clientMap[name] && !clientsToCreate.has(name)) {
                clientsToCreate.set(name, { full_name: name });
            }
        }

        console.log(`👥 יוצר ${clientsToCreate.size} לקוחות...`);
        
        if (clientsToCreate.size > 0) {
            const created = [];
            const clientRecords = Array.from(clientsToCreate.values());
            for (let i = 0; i < clientRecords.length; i += 50) {
                const batch = await base44.asServiceRole.entities.Client.bulkCreate(clientRecords.slice(i, i + 50));
                created.push(...batch);
            }
            created.forEach(c => clientMap[c.full_name.trim()] = c.id);
        }

        console.log('📝 יוצר חוזים...');

        // יצירת חוזים
        for (let i = 1; i < data.length; i++) {
            stats.total++;
            const rowData = data[i];
            const row = {};
            headers.forEach((h, idx) => {
                if (colMap[h]) row[colMap[h]] = rowData[idx];
            });

            if (!row.customer_name || !row.doc_number || !row.issue_date) {
                stats.skipped++;
                continue;
            }

            // עיבוד תאריך
            let date = row.issue_date;
            if (typeof date === 'number') {
                date = format(new Date((date - 25569) * 86400 * 1000), 'yyyy-MM-dd');
            } else if (String(date).includes('/')) {
                const p = String(date).split('/');
                date = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            }

            const customer_id = clientMap[String(row.customer_name).trim()];
            if (!customer_id) {
                stats.skipped++;
                continue;
            }

            const agent_id = agentMap[String(row.agent_name || '').toLowerCase()] || defaultAgent?.user_id;
            const agent_name = row.agent_name || defaultAgent?.user_name || 'לא ידוע';

            // חוזה פשוט - ללא ספק ספציפי, סטטוס ELIGIBLE
            contractsToCreate.push({
                customer_id,
                customer_name: row.customer_name,
                carrier_code: defaultCarrier.carrier_code,
                carrier_name: defaultCarrier.carrier_name,
                activation_date: date,
                original_invoice_id: row.doc_number,
                agent_id,
                agent_name,
                account_owner_id: agent_id,
                account_owner_name: agent_name,
                safe_retarget_date: date, // אותו תאריך - זמין מיד
                status: 'ELIGIBLE',
                msisdn: null,
                customer_phone: null,
                customer_id_number: null,
                last_action_date: new Date().toISOString(),
                last_action_type: 'IMPORTED'
            });
        }

        console.log(`💾 שומר ${contractsToCreate.length} חוזים...`);

        if (contractsToCreate.length > 0) {
            for (let i = 0; i < contractsToCreate.length; i += 50) {
                await base44.asServiceRole.entities.LineContract.bulkCreate(contractsToCreate.slice(i, i + 50));
                console.log(`✅ ${i + 50}/${contractsToCreate.length}`);
            }
            stats.created = contractsToCreate.length;
        }

        return Response.json({
            success: true,
            stats,
            message: `✅ ${stats.created} חוזים נוצרו`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});