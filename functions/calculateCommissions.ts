import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * Calculate commissions for sales transactions
 * Idempotent - safe to re-run with recalculate=true
 */
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

        // Load commission models
        const models = await base44.asServiceRole.entities.CommissionModel.filter({ is_active: true });
        const defaultModel = models.find(m => m.is_default);
        
        if (!defaultModel && models.length === 0) {
            return Response.json({ error: 'No active commission models found' }, { status: 400 });
        }

        // Load agent-model assignments
        const agentModelAssignments = await base44.asServiceRole.entities.AgentCommissionModel.filter({ is_active: true });

        // Load commission rules (grouped by model)
        const allRules = await base44.asServiceRole.entities.CommissionRule.filter({ is_active: true });
        const rulesByModel = {};
        allRules.forEach(rule => {
            if (!rulesByModel[rule.model_id]) rulesByModel[rule.model_id] = [];
            rulesByModel[rule.model_id].push(rule);
        });

        // Fetch sales for the period
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
                stats: { sales: 0, entries: 0, totalCommission: 0 }
            });
        }

        // If recalculate, delete existing entries for the period
        if (recalculate) {
            console.log(`🗑️ Deleting existing entries for period...`);
            const existingEntries = await base44.asServiceRole.entities.CommissionEntry.filter({
                issue_date: { $gte: date_from, $lte: date_to }
            }, null, 10000);
            
            for (const entry of existingEntries) {
                await base44.asServiceRole.entities.CommissionEntry.delete(entry.id);
            }
            console.log(`🗑️ Deleted ${existingEntries.length} existing entries`);
        } else {
            // Check for existing entries to avoid duplicates
            const existingEntries = await base44.asServiceRole.entities.CommissionEntry.filter({
                issue_date: { $gte: date_from, $lte: date_to }
            }, null, 10000);
            const existingSaleIds = new Set(existingEntries.map(e => e.sale_id));
            
            if (existingSaleIds.size > 0) {
                console.log(`⚠️ Found ${existingSaleIds.size} existing commission entries. Use recalculate=true to recreate.`);
            }
        }

        // Process each sale
        let entriesCreated = 0;
        let totalCommission = 0;
        const statsByAgent = {};
        const statsByRule = {};
        const processedSaleIds = new Set(); // Prevent duplicates within this run

        for (const sale of sales) {
            // Skip if already processed in this run
            if (processedSaleIds.has(sale.id)) continue;
            processedSaleIds.add(sale.id);

            const agentName = sale.sales_rep || 'Unknown';
            
            // Filter by agent_ids if specified
            if (agent_ids && agent_ids.length > 0) {
                if (!agent_ids.includes(agentName)) continue;
            }

            // Find commission model for this agent and date
            let selectedModel = null;
            
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

            if (!selectedModel) {
                selectedModel = defaultModel;
            }

            if (!selectedModel) {
                console.log(`⚠️ No model found for agent ${agentName}, skipping sale ${sale.id}`);
                continue;
            }

            const modelRules = rulesByModel[selectedModel.id] || [];

            // Check each rule (but only apply first matching rule to avoid double-counting)
            let matched = false;
            for (const rule of modelRules.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
                if (matched) break; // Only first match
                if (!checkFilters(sale, rule.filters_json)) continue;

                // Calculate commission based on rule type
                let commissionAmount = 0;
                let baseNetAmount = 0;
                let baseQuantity = 0;

                switch (rule.rule_type) {
                    case 'PERCENT_OF_NET':
                        baseNetAmount = sale.price_ex_vat || 0;
                        commissionAmount = baseNetAmount * ((rule.percentage || 0) / 100);
                        break;
                    
                    case 'PER_UNIT':
                    case 'LINE_4G':
                    case 'LINE_5G':
                        baseQuantity = Math.abs(sale.quantity || 0);
                        commissionAmount = baseQuantity * (rule.amount_per_unit || 0);
                        break;
                }

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
                matched = true;

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
            message: `נוצרו ${entriesCreated} רשומות עמלה`,
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

    // Categories
    if (filters.categories_included && filters.categories_included.length > 0) {
        if (!filters.categories_included.includes(sale.category)) return false;
    }
    if (filters.category_in && filters.category_in.length > 0) {
        if (!filters.category_in.includes(sale.category)) return false;
    }
    if (filters.category && sale.category !== filters.category) return false;

    // Product
    if (filters.product_sku && sale.sku !== filters.product_sku) return false;
    if (filters.product_name_contains) {
        if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) {
            return false;
        }
    }

    // Line type (4G/5G)
    if (filters.line_type) {
        const productName = (sale.product_name || '').toLowerCase();
        const sku = (sale.sku || '').toLowerCase();
        
        if (filters.line_type === '4G') {
            if (productName.includes('5g') || sku.includes('5g')) return false;
        } else if (filters.line_type === '5G') {
            if (!productName.includes('5g') && !sku.includes('5g')) return false;
        }
    }

    // Amount range
    if (filters.min_amount && (sale.price_ex_vat || 0) < filters.min_amount) return false;
    if (filters.max_amount && (sale.price_ex_vat || 0) > filters.max_amount) return false;

    return true;
}