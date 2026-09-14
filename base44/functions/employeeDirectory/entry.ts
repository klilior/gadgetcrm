import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveActor } from '../../shared/actorResolver.ts';

const DIRECTORY_FIELDS = [
  'id', 'employee_name', 'username', 'email', 'phone', 'role', 'department',
  'is_active', 'linet_employee_code', 'user_id', 'last_login'
];

function pick(record, fields) {
  return Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try {
    user = await base44.auth.me();
  } catch {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const actor = await resolveActor(base44, { user });
  const linkedEmployee = actor.employee_id
    ? await base44.asServiceRole.entities.Employee.get(actor.employee_id).catch(() => null)
    : null;
  const adminDetail = body.mode === 'admin_detail';
  const canReadSensitiveProfile = user.role === 'admin' || linkedEmployee?.role === 'מנהל';
  if (adminDetail && !canReadSensitiveProfile) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filter = {};
  if (body.id) filter.id = String(body.id);
  if (body.email) filter.email = String(body.email).trim().toLowerCase();
  if (body.active_only === true) filter.is_active = true;

  const rows = Object.keys(filter).length
    ? await base44.asServiceRole.entities.Employee.filter(filter, 'employee_name', 200)
    : await base44.asServiceRole.entities.Employee.list('employee_name', 200);
  const fields = adminDetail ? [...DIRECTORY_FIELDS, 'id_number', 'birth_date'] : DIRECTORY_FIELDS;
  return Response.json({ employees: rows.map((row) => pick(row, fields)) });
});