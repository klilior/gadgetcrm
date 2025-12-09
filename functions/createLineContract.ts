import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { addMonths, addDays, format } from 'npm:date-fns@2.30.0';

/**
 * Creates a line contract and updates customer ownership
 * Only updates ownership for significant categories (Lines)
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const {
            customer_id,
            customer_name,
            customer_phone,
            customer_id_number,
            msisdn,
            carrier_code,
            activation_date,
            original_invoice_id,
            agent_id,
            agent_name,
            commission_group_code // To check if this is a "Lines" sale
        } = await req.json();

        if (!customer_id || !carrier_code || !activation_date || !agent_id) {
            return Response.json({ 
                success: false, 
                error: 'Missing required fields' 
            }, { status: 400 });
        }

        // Get carrier policy
        const policies = await base44.asServiceRole.entities.CarrierPolicy
            .filter({ carrier_code, is_active: true });
        
        if (policies.length === 0) {
            return Response.json({ 
                success: false, 
                error: `No active policy found for carrier: ${carrier_code}` 
            }, { status: 400 });
        }

        const policy = policies[0];

        // Calculate safe retarget date
        const activationDateObj = new Date(activation_date);
        let safeDate = addMonths(activationDateObj, policy.churn_window_months || 12);
        safeDate = addDays(safeDate, policy.safety_buffer_days || 30);
        const safe_retarget_date = format(safeDate, 'yyyy-MM-dd');

        // Determine account owner
        // Only update ownership if this is a "Lines" sale
        let account_owner_id = agent_id;
        let account_owner_name = agent_name;

        if (commission_group_code === 'LINES') {
            // This is a significant sale - update customer ownership
            // Check if customer already has contracts
            const existingContracts = await base44.asServiceRole.entities.LineContract
                .filter({ customer_id }, null, 1);
            
            if (existingContracts.length > 0) {
                // Customer exists - agent becomes new owner
                account_owner_id = agent_id;
                account_owner_name = agent_name;
            } else {
                // New customer - agent is owner
                account_owner_id = agent_id;
                account_owner_name = agent_name;
            }

            // Update all existing contracts for this customer to reflect new owner
            const existingCustomerContracts = await base44.asServiceRole.entities.LineContract.filter({ customer_id });
            for (const contract of existingCustomerContracts) {
                await base44.asServiceRole.entities.LineContract.update(contract.id, {
                    account_owner_id: agent_id,
                    account_owner_name: agent_name
                });
            }
        } else {
            // Not a Lines sale - keep existing ownership
            const existingContracts = await base44.asServiceRole.entities.LineContract
                .filter({ customer_id }, null, 1);
            
            if (existingContracts.length > 0) {
                // Use existing owner
                account_owner_id = existingContracts[0].account_owner_id;
                account_owner_name = existingContracts[0].account_owner_name;
            }
        }

        // Create line contract
        const contract = await base44.asServiceRole.entities.LineContract.create({
            customer_id,
            customer_name,
            customer_phone,
            customer_id_number,
            msisdn,
            carrier_code,
            carrier_name: policy.carrier_name,
            activation_date,
            original_invoice_id,
            agent_id,
            agent_name,
            account_owner_id,
            account_owner_name,
            safe_retarget_date,
            status: 'LOCKED',
            last_action_date: new Date().toISOString(),
            last_action_type: 'CREATED'
        });

        return Response.json({ 
            success: true, 
            contract,
            ownership_updated: commission_group_code === 'LINES'
        });

    } catch (error) {
        console.error("Error creating line contract:", error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});