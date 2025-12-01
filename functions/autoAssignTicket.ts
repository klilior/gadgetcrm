import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { ticketId, category } = await req.json();
        
        if (!ticketId) {
            throw new Error("Ticket ID is required");
        }

        console.log(`🤖 [AutoAssign] Starting assignment for ticket ${ticketId}, category: ${category}`);
        
        // Get current Israel time
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const currentHour = israelTime.getHours();
        
        // Determine shift
        let currentShift = "בוקר";
        if (currentHour >= 15 && currentHour < 21) {
            currentShift = "ערב";
        }
        
        // 1. Find candidates based on department/category
        const allEmployees = await base44.asServiceRole.entities.Employee.filter({ 
            is_active: true 
        });

        // Determine target department
        let targetDepartment = "כללי";
        if (category === "מכירות") targetDepartment = "מכירות";
        if (category === "שירות" || category === "תיקון" || category === "תמיכה") targetDepartment = "שירות";

        console.log(`🎯 [AutoAssign] Target department: ${targetDepartment}`);

        // Filter agents
        let eligibleAgents = allEmployees.filter(emp => {
            // Always exclude managers unless it's a fallback (handled later)
            if (emp.role === "מנהל") return false;
            
            // If specific department is needed, filter by it
            if (targetDepartment !== "כללי") {
                return emp.department === targetDepartment;
            }
            
            // For 'general', take any agent/picker
            return emp.role === "נציג" || emp.role === "מלקט";
        });

        console.log(`👥 [AutoAssign] Found ${eligibleAgents.length} agents in department ${targetDepartment}`);

        // Fallback 1: If no agents in department, try 'general' department agents
        if (eligibleAgents.length === 0 && targetDepartment !== "כללי") {
            console.log('⚠️ [AutoAssign] No agents in target department, falling back to general agents');
            eligibleAgents = allEmployees.filter(emp => 
                (emp.role === "נציג" || emp.role === "מלקט") && 
                (emp.department === "כללי" || !emp.department)
            );
        }

        // Fallback 2: If still no agents, try ANY active agent from any department
        if (eligibleAgents.length === 0) {
            console.log('⚠️ [AutoAssign] Still no agents, falling back to ANY active agent');
            eligibleAgents = allEmployees.filter(emp => 
                emp.role === "נציג" || emp.role === "מלקט"
            );
        }

        // Fallback 3: Managers
        if (eligibleAgents.length === 0) {
            console.log('⚠️ [AutoAssign] No agents at all, falling back to managers');
            eligibleAgents = allEmployees.filter(emp => emp.role === "מנהל");
        }

        if (eligibleAgents.length === 0) {
            console.log('❌ [AutoAssign] No eligible employees found');
            return Response.json({ success: false, message: "No employees found for assignment" });
        }

        // 2. Round Robin Logic
        // Get recent tickets to check load/rotation
        const recentTickets = await base44.asServiceRole.entities.Ticket.filter({
            assigned_to: { $in: eligibleAgents.map(a => a.id) }
        }, "-created_date", 50);
        
        const assignmentCounts = {};
        eligibleAgents.forEach(agent => {
            assignmentCounts[agent.id] = recentTickets.filter(t => t.assigned_to === agent.id).length;
        });
        
        // Select agent with minimum assignments
        // We shuffle first to randomize if counts are equal
        const shuffledAgents = eligibleAgents.sort(() => 0.5 - Math.random());
        const selectedAgent = shuffledAgents.reduce((prev, current) => {
            return (assignmentCounts[current.id] < assignmentCounts[prev.id]) ? current : prev;
        });

        console.log(`✅ [AutoAssign] Selected agent: ${selectedAgent.employee_name} (${selectedAgent.department})`);

        // 3. Update Ticket
        await base44.asServiceRole.entities.Ticket.update(ticketId, {
            assigned_to: selectedAgent.id,
            shift: currentShift,
            status: 'בטיפול' // Auto move to 'in progress' if assigned? or keep 'new'? Let's keep 'new' or 'assigned' if we had that status. Standard is 'בטיפול' or 'חדש'. Let's set to 'חדש' but assigned. Actually status 'בטיפול' usually implies someone is working on it. Let's stick to 'חדש' but with assignee, or maybe 'מוקצה'. The enum has 'חדש', 'בטיפול'. Let's use 'חדש' and let agent move to 'בטיפול', OR move to 'בטיפול' to show it's taken. Let's leave status as is or update to 'בטיפול' if user wants. Let's assume assignment means it's in someone's queue.
            // Re-reading requirements: "להקצות אותה לנציג". Usually status 'חדש' with assignee is fine.
            // But to be visible in "My Tickets" tab, it usually needs to be assigned.
        });

        // Log activity
        await base44.asServiceRole.entities.Activity.create({
            ticket_id: ticketId,
            activity_type: 'העברת טיפול', // or similar
            summary: 'הקצאה אוטומטית',
            content: `הטיקט הוקצה אוטומטית ל-${selectedAgent.employee_name} (${selectedAgent.department})`,
            agent_id: null // System action
        });
        
        return Response.json({
            success: true,
            assigned_to: selectedAgent.id,
            agent_name: selectedAgent.employee_name,
            department: selectedAgent.department
        });
        
    } catch (error) {
        console.error('❌ [AutoAssign] Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});