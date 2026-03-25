import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Helper: normalize names for safer matching
function norm(str) {
  return (str || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { dry_run = true, limit = 500, entity = 'all' } = await req.json().catch(() => ({ dry_run: true, limit: 500, entity: 'all' }));

    // Load Employees and build quick lookup maps
    const employees = await base44.asServiceRole.entities.Employee.list();
    const empById = new Map(employees.map(e => [e.id, e]));
    const empByEmail = new Map(
      employees
        .filter(e => !!e.email)
        .map(e => [norm(e.email), e])
    );
    const empByName = new Map(
      employees
        .filter(e => !!e.employee_name)
        .map(e => [norm(e.employee_name), e])
    );

    // Optional: LinetUsersMap to map external names -> employee_id
    let linetMap = [];
    try {
      linetMap = await base44.asServiceRole.entities.LinetUsersMap.list();
    } catch (_) {
      // If map doesn't exist, continue gracefully
      linetMap = [];
    }
    const empByLinet = new Map(
      linetMap
        .map(m => {
          // Try common field names conservatively
          const key = norm(m.linet_user_name || m.linet_name || m.owner_name || m.username);
          const eid = m.employee_id || m.employeeId || m.emp_id;
          return key ? [key, eid] : null;
        })
        .filter(Boolean)
    );

    const summary = { dry_run: !!dry_run, processed: {}, updated: {}, skipped: {} };

    // 1) Backfill User.employee_id (by email/name match to Employee)
    if (entity === 'all' || entity === 'users') {
      const users = await base44.asServiceRole.entities.User.list();
      let processed = 0, updated = 0, skipped = 0;
      for (const u of users.slice(0, limit)) {
        processed++;
        if (u.employee_id) { skipped++; continue; }
        // Prefer match by email, fallback to name
        const emp = empByEmail.get(norm(u.email)) || empByName.get(norm(u.full_name));
        if (!emp) { skipped++; continue; }
        if (!dry_run) {
          await base44.asServiceRole.entities.User.update(u.id, { employee_id: emp.id });
        }
        updated++;
      }
      summary.processed.users = processed;
      summary.updated.users = updated;
      summary.skipped.users = skipped;
    }

    // Helper to get employee_id from multiple hints
    const resolveEmployeeId = ({ email, name, linetName, userId }) => {
      // 1) From User
      if (userId) {
        // Cannot query single user in a map here; caller should pass already fetched user when possible.
      }
      // 2) Linet mapping name
      if (linetName) {
        const byLinet = empByLinet.get(norm(linetName));
        if (byLinet) return byLinet;
      }
      // 3) Email
      if (email) {
        const byEmail = empByEmail.get(norm(email));
        if (byEmail) return byEmail.id;
      }
      // 4) Name
      if (name) {
        const byName = empByName.get(norm(name));
        if (byName) return byName.id;
      }
      return null;
    };

    // 2) Backfill SalesTransaction.employee_id (from sales_rep via Linet map or Employee name)
    if (entity === 'all' || entity === 'salesTransactions') {
      const txs = await base44.asServiceRole.entities.SalesTransaction.list();
      let processed = 0, updated = 0, skipped = 0;
      for (const t of txs.slice(0, limit)) {
        processed++;
        if (t.employee_id) { skipped++; continue; }
        const eid = resolveEmployeeId({ name: t.sales_rep, linetName: t.sales_rep });
        if (!eid) { skipped++; continue; }
        if (!dry_run) {
          await base44.asServiceRole.entities.SalesTransaction.update(t.id, { employee_id: eid });
        }
        updated++;
      }
      summary.processed.salesTransactions = processed;
      summary.updated.salesTransactions = updated;
      summary.skipped.salesTransactions = skipped;
    }

    // 3) Backfill SalesActivity.employee_id (from linked user_id -> User.employee_id or by user_name)
    if (entity === 'all' || entity === 'salesActivities') {
      const acts = await base44.asServiceRole.entities.SalesActivity.list();
      let processed = 0, updated = 0, skipped = 0;

      // Build a quick map of Users by id to get their employee_id
      const users = await base44.asServiceRole.entities.User.list();
      const userById = new Map(users.map(u => [u.id, u]));

      for (const a of acts.slice(0, limit)) {
        processed++;
        if (a.employee_id) { skipped++; continue; }
        let eid = null;
        if (a.user_id && userById.has(a.user_id)) {
          const u = userById.get(a.user_id);
          eid = u?.employee_id || null;
        }
        if (!eid) {
          eid = resolveEmployeeId({ name: a.user_name });
        }
        if (!eid) { skipped++; continue; }
        if (!dry_run) {
          await base44.asServiceRole.entities.SalesActivity.update(a.id, { employee_id: eid });
        }
        updated++;
      }
      summary.processed.salesActivities = processed;
      summary.updated.salesActivities = updated;
      summary.skipped.salesActivities = skipped;
    }

    // 4) Backfill Target.employee_id (from user_id -> User.employee_id or by user_name)
    if (entity === 'all' || entity === 'targets') {
      const targets = await base44.asServiceRole.entities.Target.list();
      let processed = 0, updated = 0, skipped = 0;

      const users = await base44.asServiceRole.entities.User.list();
      const userById = new Map(users.map(u => [u.id, u]));

      for (const tg of targets.slice(0, limit)) {
        processed++;
        if (tg.employee_id) { skipped++; continue; }
        let eid = null;
        if (tg.user_id && userById.has(tg.user_id)) {
          const u = userById.get(tg.user_id);
          eid = u?.employee_id || null;
        }
        if (!eid) {
          eid = resolveEmployeeId({ name: tg.user_name });
        }
        if (!eid) { skipped++; continue; }
        if (!dry_run) {
          await base44.asServiceRole.entities.Target.update(tg.id, { employee_id: eid });
        }
        updated++;
      }
      summary.processed.targets = processed;
      summary.updated.targets = updated;
      summary.skipped.targets = skipped;
    }

    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});