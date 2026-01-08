import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function toDate(d) { return d ? new Date(d) : null; }
function inRange(d, from, to) {
  if (!d) return false; const x = new Date(d);
  if (from && x < from) return false; if (to && x > to) return false; return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (me.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { date_from, date_to, limit_targets = 5000, limit_activities = 20000 } = body || {};

    const from = toDate(date_from);
    const to = toDate(date_to);

    // Load employees and users for names and mapping
    const [employees, users] = await Promise.all([
      base44.asServiceRole.entities.Employee.list(undefined, 5000),
      base44.asServiceRole.entities.User.list(undefined, 5000)
    ]);
    const empById = new Map(employees.map(e => [e.id, e]));
    const userById = new Map(users.map(u => [u.id, u]));

    // Load targets and activities (large limits, narrow client-side by date)
    const [targets, activities] = await Promise.all([
      base44.asServiceRole.entities.Target.list(undefined, limit_targets),
      base44.asServiceRole.entities.SalesActivity.list(undefined, limit_activities)
    ]);

    // Aggregate targets by employee_id and metric_type for overlapping period
    const targetsByEmp = new Map();
    for (const t of targets) {
      // Determine employee
      let eid = t.employee_id;
      if (!eid && t.user_id && userById.has(t.user_id)) {
        const u = userById.get(t.user_id);
        eid = u?.employee_id || null;
      }
      if (!eid) continue;

      // Period overlap check
      const ps = toDate(t.period_start);
      const pe = toDate(t.period_end);
      // Overlap if start <= to and end >= from (or if from/to missing)
      const overlap = (!from || (ps ? ps <= to : true)) && (!to || (pe ? pe >= from : true));
      if (!overlap) continue;

      const key = eid;
      if (!targetsByEmp.has(key)) targetsByEmp.set(key, {});
      const bucket = targetsByEmp.get(key);
      const type = t.target_type;
      bucket[type] = (bucket[type] || 0) + (Number(t.target_value) || 0);
    }

    // Aggregate actuals from SalesActivity within date range
    const actualsByEmp = new Map();
    for (const a of activities) {
      if (!inRange(a.activity_date, from, to)) continue;
      const eid = a.employee_id || (a.user_id && userById.get(a.user_id)?.employee_id) || null;
      if (!eid) continue;
      if (!actualsByEmp.has(eid)) actualsByEmp.set(eid, {});
      const bucket = actualsByEmp.get(eid);
      const type = a.metric_type;
      bucket[type] = (bucket[type] || 0) + (Number(a.metric_value) || 0);
    }

    // Build unified results
    const metricTypes = ['Devices', 'AccessoriesRevenue', 'Lines4G', 'Lines5G', 'TotalSalesRevenue'];
    const employeeIds = new Set([...targetsByEmp.keys(), ...actualsByEmp.keys()]);

    const rows = [];
    for (const eid of employeeIds) {
      const emp = empById.get(eid);
      const t = targetsByEmp.get(eid) || {};
      const a = actualsByEmp.get(eid) || {};
      const row = {
        employee_id: eid,
        employee_name: emp?.employee_name || '—',
        role: emp?.role || '',
        metrics: {}
      };
      for (const m of metricTypes) {
        const actual = a[m] || 0;
        const target = t[m] || 0;
        const percent = target > 0 ? Math.round((actual / target) * 100) : null;
        row.metrics[m] = { actual, target, percent };
      }
      rows.push(row);
    }

    // Sort by name
    rows.sort((x, y) => (x.employee_name || '').localeCompare(y.employee_name || ''));

    return Response.json({ success: true, period: { date_from, date_to }, count: rows.length, rows });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});