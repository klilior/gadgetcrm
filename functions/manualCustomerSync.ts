import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Manual customer sync - can be triggered by admin
 * Options:
 * 1. Sync all customers from recent contracts
 * 2. Force refresh all existing customers
 * 3. Sync specific account IDs
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        const body = await req.json();
        const { mode = 'recent', days = 90, force_refresh = true } = body;

        console.log(`🔄 Manual customer sync - mode: ${mode}, days: ${days}`);

        let accountIds = [];

        if (mode === 'recent') {
            // Get all unique account_ids from recent line contracts
            const contracts = await base44.asServiceRole.entities.LineContract.filter(
                {},
                '-created_date',
                10000
            );
            
            accountIds = [...new Set(
                contracts
                    .map(c => c.linet_account_id)
                    .filter(id => id && !isNaN(Number(id)))
                    .map(id => Number(id))
            )];

            console.log(`📊 Found ${accountIds.length} unique account IDs from contracts`);

        } else if (mode === 'all_existing') {
            // Get all existing customers and force refresh them
            const customers = await base44.asServiceRole.entities.LinetCustomer.list(null, 10000);
            accountIds = customers.map(c => c.linet_account_id);

            console.log(`📊 Force refreshing ${accountIds.length} existing customers`);

        } else if (mode === 'specific' && body.account_ids) {
            accountIds = body.account_ids.map(id => Number(id));
            console.log(`📊 Syncing ${accountIds.length} specific account IDs`);
        }

        if (accountIds.length === 0) {
            return Response.json({
                success: true,
                message: 'No account IDs to sync',
                stats: { synced: 0 }
            });
        }

        // Call the sync function
        const syncResponse = await base44.asServiceRole.functions.invoke('syncLinetCustomers', {
            account_ids: accountIds,
            force_refresh
        });

        return Response.json({
            success: true,
            mode,
            total_ids: accountIds.length,
            sync_result: syncResponse
        });

    } catch (error) {
        console.error('❌ manualCustomerSync error:', error);
        return Response.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});