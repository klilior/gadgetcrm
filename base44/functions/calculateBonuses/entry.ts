import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * Calculate target and shift bonuses
 * Idempotent - checks for existing bonuses to avoid duplicates
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const { date_from, date_to, calculate_targets, calculate_shifts, recalculate } = body;

        if (!date_from || !date_to) {
            return Response.json({ error: 'date_from and date_to required' }, { status: 400 });
        }

        console.log(`🎁 Calculating bonuses from ${date_from} to ${date_to}`);

        const results = { target_bonuses: [], shift_bonuses: [] };

        // ========== TARGET BONUSES ==========
        if (calculate_targets !== false) {
            console.log('🎯 Processing target bonuses...');
            
            const goals = await base44.asServiceRole.entities.GoalDefinition.filter({ is_active: true });
            const relevantGoals = goals.filter(g => 
                g.period_start <= date_to && g.period_end >= date_from
            );

            const targetBonusDefs = await base44.asServiceRole.entities.TargetBonusDefinition.filter({ is_active: true });
            const bonusDefByGoal = {};
            targetBonusDefs.forEach(d => { bonusDefByGoal[d.goal_id] = d; });

            const progressList = await base44.asServiceRole.entities.GoalProgress.list(null, 500);
            const progressByGoal = {};
            progressList.forEach(p => { progressByGoal[p.goal_id] = p; });

            // Get existing target bonuses to avoid duplicates (unless recalculate)
            if (recalculate) {
                const existingBonuses = await base44.asServiceRole.entities.BonusEntry.filter({
                    bonus_type: 'TARGET',
                    period_start: { $lte: date_to },
                    period_end: { $gte: date_from }
                }, null, 1000);
                for (const bonus of existingBonuses) {
                    await base44.asServiceRole.entities.BonusEntry.delete(bonus.id);
                }
                console.log(`🗑️ Deleted ${existingBonuses.length} existing target bonuses`);
            }

            const existingTargetBonuses = await base44.asServiceRole.entities.BonusEntry.filter({
                bonus_type: 'TARGET',
                period_start: { $lte: date_to },
                period_end: { $gte: date_from }
            }, null, 1000);
            
            const existingKeys = new Set(existingTargetBonuses.map(b => 
                `${b.goal_id}_${b.agent_id || b.agent_name}`
            ));

            for (const goal of relevantGoals) {
                const bonusDef = bonusDefByGoal[goal.id];
                if (!bonusDef) continue;

                const progress = progressByGoal[goal.id];
                if (!progress) continue;

                if (progress.progress_percent >= bonusDef.min_progress_percent) {
                    const agentName = goal.agent_name || 'צוות';
                    const agentId = goal.agent_id || agentName;
                    const key = `${goal.id}_${agentId}`;
                    const keyByName = `${goal.id}_${agentName}`;
                    
                    if (existingKeys.has(key) || existingKeys.has(keyByName)) {
                        console.log(`⏭️ Bonus already exists for goal ${goal.name}, agent ${agentName}`);
                        continue;
                    }

                    const bonusEntry = {
                        agent_id: agentId,
                        agent_name: agentName,
                        bonus_type: 'TARGET',
                        period_start: goal.period_start,
                        period_end: goal.period_end,
                        goal_id: goal.id,
                        goal_name: goal.name,
                        meta_json: {
                            current_value: progress.current_value,
                            target_value: progress.target_value,
                            progress_percent: progress.progress_percent,
                            min_required: bonusDef.min_progress_percent
                        },
                        bonus_amount: bonusDef.bonus_amount
                    };

                    await base44.asServiceRole.entities.BonusEntry.create(bonusEntry);
                    results.target_bonuses.push(bonusEntry);
                    existingKeys.add(key); // Prevent duplicates in same run
                }
            }
        }

        // ========== SHIFT BONUSES ==========
        if (calculate_shifts !== false) {
            console.log('📅 Processing shift bonuses...');
            
            const shifts = await base44.asServiceRole.entities.ShiftAssignment.list(null, 1000);
            const weeklySchedules = await base44.asServiceRole.entities.WeeklySchedule.list(null, 100);
            const scheduleById = {};
            weeklySchedules.forEach(ws => { scheduleById[ws.id] = ws; });

            // Count shifts per agent
            const shiftCountByAgent = {};
            
            for (const shift of shifts) {
                const schedule = scheduleById[shift.weekly_schedule_id];
                if (!schedule) continue;
                
                const dayIndex = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].indexOf(shift.day);
                if (dayIndex === -1) continue;
                
                const weekStart = new Date(schedule.week_start_date);
                const shiftDate = new Date(weekStart);
                shiftDate.setDate(weekStart.getDate() + dayIndex);
                const shiftDateStr = shiftDate.toISOString().split('T')[0];
                
                if (shiftDateStr < date_from || shiftDateStr > date_to) continue;

                const assignedIds = shift.assigned_employee_ids || [];
                for (const empId of assignedIds) {
                    if (!shiftCountByAgent[empId]) shiftCountByAgent[empId] = 0;
                    shiftCountByAgent[empId]++;
                }
            }

            const shiftBonusDefs = await base44.asServiceRole.entities.ShiftBonusDefinition.filter({ is_active: true });
            const employees = await base44.asServiceRole.entities.Employee.list(null, 100);
            const employeeNameById = {};
            employees.forEach(e => { employeeNameById[e.id] = e.employee_name; });

            // Get existing shift bonuses (unless recalculate)
            if (recalculate) {
                const existingBonuses = await base44.asServiceRole.entities.BonusEntry.filter({
                    bonus_type: 'SHIFT',
                    period_start: date_from,
                    period_end: date_to
                }, null, 1000);
                for (const bonus of existingBonuses) {
                    await base44.asServiceRole.entities.BonusEntry.delete(bonus.id);
                }
                console.log(`🗑️ Deleted ${existingBonuses.length} existing shift bonuses`);
            }

            const existingShiftBonuses = await base44.asServiceRole.entities.BonusEntry.filter({
                bonus_type: 'SHIFT',
                period_start: date_from,
                period_end: date_to
            }, null, 1000);
            const existingShiftAgents = new Set(existingShiftBonuses.map(b => b.agent_id));

            for (const bonusDef of shiftBonusDefs) {
                const agentId = bonusDef.agent_id;
                const agentName = bonusDef.agent_name || employeeNameById[agentId] || agentId;
                
                // Check validity period
                if (bonusDef.valid_from && date_to < bonusDef.valid_from) continue;
                if (bonusDef.valid_to && date_from > bonusDef.valid_to) continue;

                const shiftsCount = shiftCountByAgent[agentId] || 0;
                if (shiftsCount === 0) continue;
                if (existingShiftAgents.has(agentId)) {
                    console.log(`⏭️ Shift bonus already exists for agent ${agentName}`);
                    continue;
                }

                const bonusAmount = shiftsCount * bonusDef.bonus_per_shift;

                const bonusEntry = {
                    agent_id: agentId,
                    agent_name: agentName,
                    bonus_type: 'SHIFT',
                    period_start: date_from,
                    period_end: date_to,
                    meta_json: {
                        shifts_count: shiftsCount,
                        bonus_per_shift: bonusDef.bonus_per_shift
                    },
                    bonus_amount: bonusAmount
                };

                await base44.asServiceRole.entities.BonusEntry.create(bonusEntry);
                results.shift_bonuses.push(bonusEntry);
                existingShiftAgents.add(agentId);
            }
        }

        console.log(`✅ Created ${results.target_bonuses.length} target bonuses, ${results.shift_bonuses.length} shift bonuses`);

        return Response.json({
            success: true,
            results,
            summary: {
                target_bonuses_created: results.target_bonuses.length,
                shift_bonuses_created: results.shift_bonuses.length,
                total_target_amount: results.target_bonuses.reduce((s, b) => s + b.bonus_amount, 0),
                total_shift_amount: results.shift_bonuses.reduce((s, b) => s + b.bonus_amount, 0)
            },
            message: `נוצרו ${results.target_bonuses.length} בונוס יעדים, ${results.shift_bonuses.length} בונוס משמרות`
        });

    } catch (error) {
        console.error("❌ Bonus Calculation Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});