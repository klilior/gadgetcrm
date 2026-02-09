import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isManager = me?.role === 'admin' || me?.app_role === 'מנהל' || me?.data?.app_role === 'מנהל';
    if (!isManager) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const users = await base44.asServiceRole.entities.User.list();
    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});