import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { ticketId } = await req.json();
        
        if (!ticketId) {
            throw new Error("Ticket ID is required");
        }
        
        // Get current Israel time to determine shift
        const israelTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        const currentHour = israelTime.getHours();
        
        // Determine current shift: 09:00-15:00 = בוקר, 15:00-21:00 = ערב
        let currentShift;
        if (currentHour >= 9 && currentHour < 15) {
            currentShift = "בוקר";
        } else if (currentHour >= 15 && currentHour < 21) {
            currentShift = "ערב";
        } else {
            // Outside working hours - assign to morning shift
            currentShift = "בוקר";
        }
        
        // Get all active employees for current shift
        const allEmployees = await base44.asServiceRole.entities.Employee.filter({ 
            is_active: true 
        });
        
        // Filter employees by role (exclude managers from round-robin unless needed)
        const availableAgents = allEmployees.filter(emp => 
            emp.role === "נציג" || emp.role === "מלקט"
        );
        
        if (availableAgents.length === 0) {
            // Fallback to managers if no agents available
            const managers = allEmployees.filter(emp => emp.role === "מנהל");
            availableAgents.push(...managers);
        }
        
        if (availableAgents.length === 0) {
            throw new Error("No available agents found for assignment");
        }
        
        // Get recent ticket assignments to determine round-robin order
        const recentTickets = await base44.asServiceRole.entities.Ticket.filter({
            assigned_to: { $exists: true }
        }, "-created_date", 50);
        
        // Count assignments per agent in recent tickets
        const assignmentCounts = {};
        availableAgents.forEach(agent => {
            assignmentCounts[agent.id] = recentTickets.filter(t => t.assigned_to === agent.id).length;
        });
        
        // Find agent with least assignments (round-robin)
        const selectedAgent = availableAgents.reduce((prev, current) => {
            return (assignmentCounts[current.id] < assignmentCounts[prev.id]) ? current : prev;
        });
        
        // Update ticket with assigned agent and shift
        await base44.asServiceRole.entities.Ticket.update(ticketId, {
            assigned_to: selectedAgent.id,
            shift: currentShift
        });
        
        console.log(`Ticket ${ticketId} assigned to ${selectedAgent.employee_name} (${currentShift} shift)`);
        
        return new Response(JSON.stringify({
            success: true,
            assigned_to: selectedAgent.id,
            agent_name: selectedAgent.employee_name,
            shift: currentShift
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Error in round-robin assignment:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});