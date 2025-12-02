import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    console.log("🧮 Starting Commission Calculation...");
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const { date_from, date_to, agent_ids, recalculate } = body;

        if (!date_from || !date_to) {
            return Response.json({ error: 'date_from and date_to are required' }, { status: 400 });
        }

        console.log(`📅 Calculating commissions from ${date_from} to ${date_to}`);

        // 1. Load all commission models
        const models = await base44.asServiceRole.entities.CommissionModel.filter({ is_active: true });
        const defaultModel = models.find(m => m.is_default);
        
        if (!defaultModel && models.length === 0) {
            return Response.json({ error: 'No active commission models found' }, { status: 400 });
        }

        // 2. Load all agent-model assignments
        const agentModelAssignments = await base44.asServiceRole.entities.AgentCommissionModel.filter({ is_active: true });

        // 3. Load all commission rules (grouped by model)
        const allRules = await base44.asServiceRole.entities.CommissionRule.filter({ is_active: true });
        const rulesByModel = {};
        allRules.forEach(rule => {
            if (!rulesByModel[rule.model_id]) rulesByModel[rule.model_id] = [];
            rulesByModel[rule.model_id].push(rule);
        });

        // 4. Load LinetUsersMap for agent name resolution
        const usersMapList = await base44.asServiceRole.entities.LinetUsersMap.list(null, 1000);
        const usersMap = {};
        usersMapList.forEach(u => usersMap[String(u.user_id)] = u.user_name);

        // 5. Fetch sales for the period
        let salesQuery = {
            issue_date: { $gte: date_from, $lte: date_to }
        };

        console.log(`📦 Fetching sales...`);
        const sales = await base44.asServiceRole.entities.SalesTransaction.filter(salesQuery, '-issue_date', 10000);
        console.log(`📦 Found ${sales.length} sales transactions`);

        if (sales.length === 0) {
            return Response.json({ 
                success: true, 
                message: 'No sales found for the period',
                stats: { sales: 0, entries: 0 }
            });
        }

        // 6. If recalculate, delete existing entries for the period
        if (recalculate) {
            console.log(`🗑️ Deleting existing entries for period...`);
            const existingEntries = await base44.asServiceRole.entities.CommissionEntry.filter({
                issue_date: { $gte: date_from, $lte: date_to }
            }, null, 10000);
            
            for (const entry of existingEntries) {
                await base44.asServiceRole.entities.CommissionEntry.delete(entry.id);
            }
            console.log(`🗑️ Deleted ${existingEntries.length} existing entries`);
        }

        // 7. Process each sale
        let entriesCreated = 0;
        let totalCommission = 0;
        const statsByAgent = {};
        const statsByRule = {};

        for (const sale of sales) {
            // Get agent info
            const agentName = sale.sales_rep || 'Unknown';
            
            // Filter by agent_ids if specified
            if (agent_ids && agent_ids.length > 0) {
                if (!agent_ids.includes(agentName)) continue;
            }

            // Find the appropriate commission model for this agent and date
            let selectedModel = null;
            
            // Check for specific agent assignment
            const agentAssignment = agentModelAssignments.find(a => {
                if (a.agent_name !== agentName && a.agent_id !== agentName) return false;
                if (!a.is_active) return false;
                
                const saleDate = sale.issue_date;
                if (a.valid_from && saleDate < a.valid_from) return false;
                if (a.valid_to && saleDate > a.valid_to) return false;
                
                return true;
            });

            if (agentAssignment) {
                selectedModel = models.find(m => m.id === agentAssignment.commission_model_id);
            }

            // Fall back to default model
            if (!selectedModel) {
                selectedModel = defaultModel;
            }

            if (!selectedModel) {
                console.log(`⚠️ No model found for agent ${agentName}, skipping sale ${sale.id}`);
                continue;
            }

            // Get rules for the selected model
            const modelRules = rulesByModel[selectedModel.id] || [];

            // Check each rule against the sale
            for (const rule of modelRules) {
                if (!checkFilters(sale, rule.filters_json)) continue;

                // Calculate commission based on rule type
                let commissionAmount = 0;
                let baseNetAmount = 0;
                let baseQuantity = 0;

                switch (rule.rule_type) {
                    case 'PERCENT_OF_NET':
                        baseNetAmount = sale.price_ex_vat || 0;
                        commissionAmount = baseNetAmount * (rule.percentage / 100);
                        break;
                    
                    case 'PER_UNIT':
                    case 'LINE_4G':
                    case 'LINE_5G':
                        baseQuantity = Math.abs(sale.quantity || 0);
                        commissionAmount = baseQuantity * (rule.amount_per_unit || 0);
                        break;
                }

                // Skip if no commission
                if (commissionAmount === 0) continue;

                // Create commission entry
                const entry = {
                    sale_id: sale.id,
                    agent_id: agentName,
                    agent_name: agentName,
                    commission_model_id: selectedModel.id,
                    commission_rule_id: rule.id,
                    rule_name: rule.rule_name,
                    rule_type: rule.rule_type,
                    issue_date: sale.issue_date,
                    base_net_amount: baseNetAmount,
                    base_quantity: baseQuantity,
                    commission_amount: commissionAmount,
                    calculation_period: sale.issue_date ? sale.issue_date.substring(0, 7) : '',
                    sale_details: {
                        doc_number: sale.doc_number,
                        customer_name: sale.customer_name,
                        product_name: sale.product_name,
                        category: sale.category,
                        sku: sale.sku
                    }
                };

                await base44.asServiceRole.entities.CommissionEntry.create(entry);
                entriesCreated++;
                totalCommission += commissionAmount;

                // Update stats
                if (!statsByAgent[agentName]) {
                    statsByAgent[agentName] = { total: 0, count: 0 };
                }
                statsByAgent[agentName].total += commissionAmount;
                statsByAgent[agentName].count++;

                if (!statsByRule[rule.rule_name]) {
                    statsByRule[rule.rule_name] = { total: 0, count: 0 };
                }
                statsByRule[rule.rule_name].total += commissionAmount;
                statsByRule[rule.rule_name].count++;
            }
        }

        console.log(`✅ Created ${entriesCreated} commission entries, total: ₪${totalCommission.toFixed(2)}`);

        return Response.json({
            success: true,
            message: `Created ${entriesCreated} commission entries`,
            stats: {
                sales: sales.length,
                entries: entriesCreated,
                totalCommission: totalCommission,
                byAgent: statsByAgent,
                byRule: statsByRule
            }
        });

    } catch (error) {
        console.error("❌ Commission Calculation Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});

// Helper function to check if a sale matches the rule filters
function checkFilters(sale, filters) {
    if (!filters) return true;

    // Check categories_included
    if (filters.categories_included && filters.categories_included.length > 0) {
        if (!filters.categories_included.includes(sale.category)) {
            return false;
        }
    }

    // Check specific category
    if (filters.category && sale.category !== filters.category) {
        return false;
    }

    // Check product_sku
    if (filters.product_sku && sale.sku !== filters.product_sku) {
        return false;
    }

    // Check product_name contains
    if (filters.product_name_contains) {
        if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) {
            return false;
        }
    }

    // Check line_type (for 4G/5G)
    if (filters.line_type) {
        const productName = (sale.product_name || '').toLowerCase();
        const sku = (sale.sku || '').toLowerCase();
        
        if (filters.line_type === '4G') {
            if (!productName.includes('4g') && !sku.includes('4g')) {
                return false;
            }
        } else if (filters.line_type === '5G') {
            if (!productName.includes('5g') && !sku.includes('5g')) {
                return false;
            }
        }
    }

    // Check min_amount
    if (filters.min_amount && (sale.price_ex_vat || 0) < filters.min_amount) {
        return false;
    }

    // Check max_amount
    if (filters.max_amount && (sale.price_ex_vat || 0) > filters.max_amount) {
        return false;
    }

    return true;
}