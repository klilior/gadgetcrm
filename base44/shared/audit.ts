const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|hash)/i;

function sanitize(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (depth >= 5) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(child, depth + 1);
    }
    return result;
  }
  return String(value);
}

export async function logAudit(base44, event) {
  if (!event?.entity_type || !event?.entity_id || !event?.action || !event?.source || !event?.correlation_id) {
    throw new Error("Audit event requires entity_type, entity_id, action, source and correlation_id");
  }
  return await base44.asServiceRole.entities.AuditLog.create({
    actor_user_id: event.actor_user_id || null,
    actor_employee_id: event.actor_employee_id || null,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    action: event.action,
    field_changes: sanitize(event.field_changes || {}),
    before_data: sanitize(event.before_data || {}),
    after_data: sanitize(event.after_data || {}),
    source: event.source,
    integration: event.integration || null,
    correlation_id: event.correlation_id,
    request_context: sanitize(event.request_context || {}),
  });
}