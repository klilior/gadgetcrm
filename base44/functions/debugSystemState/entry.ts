import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

export const debugSystemState = async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // 1. Check LineContract count
        const contracts = await base44.entities.LineContract.list(null, 50);
        const totalContracts = await base44.entities.LineContract.count ? await base44.entities.LineContract.count() : contracts.length;

        // 2. Check Agents
        const agents = await base44.entities.LinetUsersMap.list(null, 10);

        // 3. Check sample contract structure
        const sample = contracts.length > 0 ? contracts[0] : null;

        return Response.json({
            success: true,
            stats: {
                total_contracts_visible: contracts.length,
                total_contracts_estimated: totalContracts,
                total_agents_mapped: agents.length
            },
            sample_contract: sample,
            contracts_summary: contracts.map(c => ({
                id: c.id,
                customer: c.customer_name,
                status: c.status,
                owner: c.account_owner_id,
                carrier: c.carrier_code,
                safe_date: c.safe_retarget_date
            }))
        });

    } catch (error) {
        return Response.json({ success: false, error: error.message, stack: error.stack }, { status: 500 });
    }
};

Deno.serve(debugSystemState);