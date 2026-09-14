function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export async function resolveActor(base44, explicit = {}) {
  let user = explicit.user || null;
  if (!user) {
    try {
      user = await base44.auth.me();
    } catch (_) {
      user = null;
    }
  }

  const userId = explicit.user_id || user?.id || null;
  let employeeId = explicit.employee_id || null;
  let method = employeeId ? "EXPLICIT_EMPLOYEE_ID" : "UNMATCHED";

  if (!employeeId && userId) {
    const linked = await base44.asServiceRole.entities.Employee.filter({ user_id: userId }, null, 2);
    if (linked.length === 1) {
      employeeId = linked[0].id;
      method = "EMPLOYEE_USER_ID";
    }
  }

  if (!employeeId && user?.email) {
    const email = normalizedEmail(user.email);
    const employees = await base44.asServiceRole.entities.Employee.filter({ email }, null, 2);
    if (employees.length === 1) {
      employeeId = employees[0].id;
      method = "EXACT_UNIQUE_EMAIL";
    }
  }

  const source = explicit.source || "USER";
  const actorType = explicit.actor_type || (employeeId ? "EMPLOYEE" : (userId ? "USER" : source));

  return {
    authenticated_user_id: userId,
    user_id: userId,
    employee_id: employeeId,
    actor_type: actorType,
    source,
    resolution_method: method,
  };
}