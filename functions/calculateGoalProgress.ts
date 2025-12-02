import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const { goal_id, calculate_all } = body;

        // Load commission group mappings
        const mappings = await base44.asServiceRole.entities.CommissionGroupMapping.filter({ is_active: true });

        // Helper to check if sale matches group
        const getCommissionGroup = (sale) => {
            for (const mapping of mappings.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
                if (checkFilters(sale, mapping.filters_json)) {
                    return mapping.commission_group_code;
                }
            }
            return null;
        };

        const checkFilters = (sale, filters) => {
            if (!filters) return false;
            if (filters.category_in && filters.category_in.length > 0) {
                if (!filters.category_in.includes(sale.category)) return false;
            }
            if (filters.category && sale.category !== filters.category) return false;
            return true;
        };

        // Get goals to calculate
        let goals = [];
        if (goal_id) {
            const goal = await base44.asServiceRole.entities.GoalDefinition.filter({ id: goal_id });
            if (goal.length > 0) goals = goal;
        } else if (calculate_all) {
            goals = await base44.asServiceRole.entities.GoalDefinition.filter({ is_active: true });
        } else {
            return Response.json({ error: 'goal_id or calculate_all required' }, { status: 400 });
        }

        const results = [];

        for (const goal of goals) {
            // Fetch sales for period
            const sales = await base44.asServiceRole.entities.SalesTransaction.filter({
                issue_date: { $gte: goal.period_start, $lte: goal.period_end }
            }, null, 10000);

            // Filter by agent if scope is AGENT
            let filteredSales = sales;
            if (goal.scope_type === 'AGENT' && goal.agent_name) {
                filteredSales = sales.filter(s => s.sales_rep === goal.agent_name);
            }

            // Filter by commission group
            filteredSales = filteredSales.filter(s => getCommissionGroup(s) === goal.commission_group_code);

            // Calculate current value based on metric type
            let currentValue = 0;
            switch (goal.metric_type) {
                case 'UNITS':
                    currentValue = filteredSales.reduce((sum, s) => sum + Math.abs(s.quantity || 0), 0);
                    break;
                case 'NET_AMOUNT':
                    currentValue = filteredSales.reduce((sum, s) => sum + (s.price_ex_vat || 0), 0);
                    break;
                case 'LINES_4G_UNITS':
                    currentValue = filteredSales
                        .filter(s => !(s.product_name || '').toLowerCase().includes('5g'))
                        .reduce((sum, s) => sum + Math.abs(s.quantity || 0), 0);
                    break;
                case 'LINES_5G_UNITS':
                    currentValue = filteredSales
                        .filter(s => (s.product_name || '').toLowerCase().includes('5g'))
                        .reduce((sum, s) => sum + Math.abs(s.quantity || 0), 0);
                    break;
            }

            const progressPercent = goal.target_value > 0 ? (currentValue / goal.target_value) * 100 : 0;

            // Find existing progress record or create new
            const existingProgress = await base44.asServiceRole.entities.GoalProgress.filter({ goal_id: goal.id });
            
            const progressData = {
                goal_id: goal.id,
                goal_name: goal.name,
                current_value: currentValue,
                target_value: goal.target_value,
                progress_percent: progressPercent,
                last_calculated_at: new Date().toISOString()
            };

            if (existingProgress.length > 0) {
                await base44.asServiceRole.entities.GoalProgress.update(existingProgress[0].id, progressData);
            } else {
                await base44.asServiceRole.entities.GoalProgress.create(progressData);
            }

            results.push({
                goal_id: goal.id,
                goal_name: goal.name,
                current_value: currentValue,
                target_value: goal.target_value,
                progress_percent: progressPercent
            });
        }

        return Response.json({ success: true, results });
    } catch (error) {
        console.error("Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});