import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Calculate progress for goals
 * Idempotent - safe to re-run
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Try to get user, but allow service-level calls too (e.g., from automation or custom login sessions)
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (authErr) {
            // User not authenticated via Base44 auth - allow if request has valid SDK token
            console.log('[calculateGoalProgress] No Base44 user, proceeding with service role');
        }

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
            const normalize = (v) => String(v || '').trim().toLowerCase();
            const saleCategory = normalize(sale.category);
            
            if (filters.category_in && filters.category_in.length > 0) {
                const categories = filters.category_in.map(normalize);
                if (!categories.includes(saleCategory)) return false;
            }
            if (filters.categories_included && filters.categories_included.length > 0) {
                const categories = filters.categories_included.map(normalize);
                if (!categories.includes(saleCategory)) return false;
            }
            if (filters.category && saleCategory !== normalize(filters.category)) return false;
            
            if (filters.product_name_contains) {
                const terms = Array.isArray(filters.product_name_contains) ? filters.product_name_contains : [filters.product_name_contains];
                const productName = normalize(sale.product_name);
                if (!terms.map(normalize).some(term => productName.includes(term))) return false;
            }
            
            return true;
        };

        const getTxSign = (sale) => {
            const raw = String(sale?.doc_type ?? '').trim();
            const num = parseInt(raw, 10);
            const isCredit = num === 3 || /credit/i.test(raw) || raw.includes('זיכוי') || raw.includes('זכוי');
            const hasNegative = Number(sale.total_row_amount || 0) < 0 || Number(sale.price_ex_vat || 0) < 0 || Number(sale.quantity || 0) < 0;
            return (isCredit || hasNegative) ? -1 : 1;
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
                    currentValue = filteredSales.reduce((sum, s) => sum + (getTxSign(s) * Math.abs(Number(s.quantity || 0))), 0);
                    break;
                case 'NET_AMOUNT':
                    currentValue = filteredSales.reduce((sum, s) => sum + (getTxSign(s) * Math.abs(Number(s.price_ex_vat || 0))), 0);
                    currentValue = Math.round(currentValue * 100) / 100;
                    break;
                case 'LINES_4G_UNITS':
                    currentValue = filteredSales
                        .filter(s => !(s.product_name || '').toLowerCase().includes('5g'))
                        .reduce((sum, s) => sum + (getTxSign(s) * Math.abs(Number(s.quantity || 0))), 0);
                    break;
                case 'LINES_5G_UNITS':
                    currentValue = filteredSales
                        .filter(s => (s.product_name || '').toLowerCase().includes('5g'))
                        .reduce((sum, s) => sum + (getTxSign(s) * Math.abs(Number(s.quantity || 0))), 0);
                    break;
            }

            // Prevent division by zero
            const targetValue = goal.target_value || 0;
            const progressPercent = targetValue > 0 ? (currentValue / targetValue) * 100 : 0;

            // Upsert progress record (idempotent)
            const existingProgress = await base44.asServiceRole.entities.GoalProgress.filter({ goal_id: goal.id });
            
            const progressData = {
                goal_id: goal.id,
                goal_name: goal.name,
                current_value: currentValue,
                target_value: targetValue,
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
                target_value: targetValue,
                progress_percent: progressPercent
            });
        }

        console.log(`✅ Calculated progress for ${results.length} goals`);

        return Response.json({ 
            success: true, 
            results,
            message: `חושב התקדמות עבור ${results.length} יעדים`
        });

    } catch (error) {
        console.error("❌ Goal Progress Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});