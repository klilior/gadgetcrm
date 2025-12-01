import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    
    // Try to fetch repairs with different methods
    const allRepairs = await base44.asServiceRole.entities.Repair.list("-created_date", 50);
    const userRepairs = await base44.entities.Repair.list("-created_date", 50);
    
    const debugInfo = {
      currentUser: {
        id: user.id,
        email: user.email,
        role: user.role,
        employee_name: user.employee_name
      },
      totalRepairsInDB: allRepairs.length,
      repairsUserCanSee: userRepairs.length,
      lastFiveRepairs: allRepairs.slice(0, 5).map(r => ({
        id: r.id,
        repair_id: r.repair_id,
        client_id: r.client_id,
        status: r.status,
        created_date: r.created_date,
        created_by: r.created_by
      }))
    };
    
    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});