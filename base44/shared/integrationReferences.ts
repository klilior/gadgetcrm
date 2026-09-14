function normalizePart(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function buildExternalKey({ integration, external_entity_type, external_id }) {
  const parts = [integration, external_entity_type, external_id].map(normalizePart);
  if (parts.some((part) => !part)) throw new Error("integration, external_entity_type and external_id are required");
  return parts.join(":");
}

export async function upsertIntegrationReference(base44, input) {
  if (!input?.entity_type || !input?.entity_id) throw new Error("entity_type and entity_id are required");
  const externalKey = buildExternalKey(input);
  const now = new Date().toISOString();
  const existing = await base44.asServiceRole.entities.IntegrationReference.filter({ external_key: externalKey }, null, 2);

  if (existing.length > 1) throw new Error(`Duplicate IntegrationReference external_key: ${externalKey}`);
  if (existing.length === 1) {
    const current = existing[0];
    if (current.entity_type !== input.entity_type || current.entity_id !== input.entity_id) {
      throw new Error(`External identity conflict for ${externalKey}`);
    }
    const updated = await base44.asServiceRole.entities.IntegrationReference.update(current.id, {
      external_secondary_id: input.external_secondary_id || current.external_secondary_id || null,
      metadata: input.metadata || current.metadata || {},
      last_seen_at: now,
    });
    return { reference: updated, created: false };
  }

  const created = await base44.asServiceRole.entities.IntegrationReference.create({
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    integration: normalizePart(input.integration),
    external_entity_type: normalizePart(input.external_entity_type),
    external_id: String(input.external_id).trim(),
    external_secondary_id: input.external_secondary_id ? String(input.external_secondary_id).trim() : null,
    external_key: externalKey,
    metadata: input.metadata || {},
    first_seen_at: now,
    last_seen_at: now,
  });
  return { reference: created, created: true };
}

export async function findIntegrationReference(base44, identity) {
  const externalKey = buildExternalKey(identity);
  const matches = await base44.asServiceRole.entities.IntegrationReference.filter({ external_key: externalKey }, null, 2);
  if (matches.length > 1) throw new Error(`Duplicate IntegrationReference external_key: ${externalKey}`);
  return matches[0] || null;
}