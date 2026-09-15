/**
 * Central customer identity resolution + guarded creation.
 * Every producer MUST go through resolveCustomerIdentity / resolveOrCreateCustomer.
 * No merges, no deletes, no historical rewrites happen here.
 */
import {
  buildCustomerIdempotencyKey,
  classifyCustomerEmail,
  phoneLookupVariants,
  validateCustomerPhone,
} from "./customerIdentityPolicy.ts";
import { logAudit } from "./audit.ts";

export const PRODUCERS = {
  MANUAL_UI: "MANUAL_UI",
  FIND_OR_CREATE_CLIENT: "FIND_OR_CREATE_CLIENT",
  LINET_SYNC: "LINET_SYNC",
  WOOCOMMERCE_WEBHOOK: "WOOCOMMERCE_WEBHOOK",
  GMAIL_WEBHOOK: "GMAIL_WEBHOOK",
  BACKFILL_CLIENT_LINKS: "BACKFILL_CLIENT_LINKS",
  SUPERPHARM_SYNC: "SUPERPHARM_SYNC",
};

/** Producers allowed to create customers at this rollout stage. */
export const CREATION_ALLOWED_PRODUCERS = new Set([
  PRODUCERS.MANUAL_UI,
  PRODUCERS.FIND_OR_CREATE_CLIENT,
  PRODUCERS.LINET_SYNC,
  PRODUCERS.WOOCOMMERCE_WEBHOOK,
]);

type ExternalRef = { integration: string; external_entity_type: string; external_id: string | number };

export type IdentityInput = {
  producer: string;
  phone?: unknown;
  email?: unknown;
  name?: unknown;
  linet_account_id?: number | string | null;
  woo_customer_id?: number | string | null;
  external?: ExternalRef | null;
  source_record_id?: string | null;
  correlation_id?: string;
  dry_run?: boolean;
};

const nameKey = (v: unknown) =>
  String(v ?? "")
    .replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, "")
    .toLowerCase();

function externalRefs(input: IdentityInput): ExternalRef[] {
  const refs: ExternalRef[] = [];
  if (input.linet_account_id != null && String(input.linet_account_id).trim() !== "") {
    refs.push({ integration: "LINET", external_entity_type: "CUSTOMER", external_id: Number(input.linet_account_id) });
  }
  if (input.woo_customer_id != null && Number(input.woo_customer_id) > 0) {
    refs.push({ integration: "WOOCOMMERCE", external_entity_type: "CUSTOMER", external_id: Number(input.woo_customer_id) });
  }
  if (input.external?.integration && input.external?.external_id != null) {
    refs.push({
      integration: input.external.integration,
      external_entity_type: input.external.external_entity_type || "CUSTOMER",
      external_id: input.external.external_id,
    });
  }
  return refs;
}

export function idempotencyKeysFor(input: IdentityInput): string[] {
  return externalRefs(input)
    .map((r) => buildCustomerIdempotencyKey(r.integration, r.external_entity_type, r.external_id))
    .filter((k): k is string => Boolean(k));
}

const usable = (c: any) => c && !c.excluded_from_identity_matching && c.customer_quality_status !== "TEST_DATA";

/**
 * Resolve a customer identity.
 * status: MATCHED | NO_MATCH | AMBIGUOUS | INVALID_IDENTITY
 */
export async function resolveCustomerIdentity(base44: any, input: IdentityInput) {
  const sr = base44.asServiceRole.entities;
  const phone = validateCustomerPhone(input.phone);
  const email = classifyCustomerEmail(input.email);
  const refs = externalRefs(input);
  const keys = idempotencyKeysFor(input);
  const base = {
    normalized_phone: phone.normalized_phone,
    phone_validity: phone.validity,
    normalized_email: email.normalized_email,
    email_identity_class: email.email_identity_class,
    idempotency_keys: keys,
  };

  // Priority 1 — IntegrationReference exact unique match
  for (const key of keys) {
    const found = await sr.IntegrationReference.filter({ external_key: key, entity_type: "Customer" }, null, 5);
    const ids = [...new Set(found.map((r: any) => r.entity_id))];
    if (ids.length === 1) {
      const client = await sr.Client.get(ids[0]).catch(() => null);
      if (client) {
        return { status: "MATCHED", client_id: client.id, match_method: "integration_reference", confidence: "certain", evidence: key, ...base };
      }
    } else if (ids.length > 1) {
      return { status: "AMBIGUOUS", client_id: null, match_method: "external_id_conflict", confidence: "ambiguous", evidence: `${key} → ${ids.length} clients`, data_conflict: true, ...base };
    }
  }

  // Priority 2 — legacy external id fields
  for (const ref of refs) {
    const field = ref.integration === "LINET" ? "linet_account_id" : ref.integration === "WOOCOMMERCE" ? "woo_customer_id" : null;
    if (!field) continue;
    const found = await sr.Client.filter({ [field]: Number(ref.external_id) }, null, 5);
    const candidates = found.filter(usable);
    if (candidates.length === 1) {
      return { status: "MATCHED", client_id: candidates[0].id, match_method: `legacy_${field}`, confidence: "certain", evidence: `${field}=${ref.external_id}`, ...base };
    }
    if (candidates.length > 1) {
      return { status: "AMBIGUOUS", client_id: null, match_method: "external_id_conflict", confidence: "ambiguous", evidence: `${field}=${ref.external_id} → ${candidates.length} clients`, data_conflict: true, ...base };
    }
  }

  const hasUsablePhone = phone.validity === "VALID_MOBILE" || phone.validity === "VALID_LANDLINE";
  if (!hasUsablePhone && !email.usable_for_identity && keys.length === 0) {
    return { status: "INVALID_IDENTITY", client_id: null, match_method: "none", confidence: "none", evidence: `phone=${phone.validity}, email=${email.email_identity_class}`, ...base };
  }

  // Priority 3 — canonical phone
  let phoneCandidates: any[] = [];
  if (hasUsablePhone) {
    const variants = phoneLookupVariants(phone.normalized_phone);
    const [byNormalized, byRaw] = await Promise.all([
      sr.Client.filter({ normalized_phone: phone.normalized_phone }, null, 50),
      sr.Client.filter({ phone: { $in: variants } }, null, 50),
    ]);
    const map = new Map<string, any>();
    [...byNormalized, ...byRaw].filter(usable).forEach((c: any) => map.set(c.id, c));
    phoneCandidates = [...map.values()];
    if (phoneCandidates.length === 1) {
      return { status: "MATCHED", client_id: phoneCandidates[0].id, match_method: "normalized_phone", confidence: "strong", evidence: phone.normalized_phone, ...base };
    }
  }

  // Priority 4 — corroboration
  if (phoneCandidates.length > 1) {
    const key = nameKey(input.name);
    const byName = key ? phoneCandidates.filter((c) => nameKey(c.full_name) === key) : [];
    if (byName.length === 1) {
      return { status: "MATCHED", client_id: byName[0].id, match_method: "phone_plus_name", confidence: "strong", evidence: `${phone.normalized_phone} + name`, ...base };
    }
    const byEmail = email.usable_for_identity
      ? phoneCandidates.filter((c) => (c.normalized_email || String(c.email || "").toLowerCase()) === email.normalized_email)
      : [];
    if (byEmail.length === 1) {
      return { status: "MATCHED", client_id: byEmail[0].id, match_method: "phone_plus_email", confidence: "strong", evidence: `${phone.normalized_phone} + email`, ...base };
    }
    return {
      status: "AMBIGUOUS",
      client_id: null,
      match_method: "normalized_phone_multi",
      confidence: "ambiguous",
      evidence: `${phone.normalized_phone} → ${phoneCandidates.length} clients`,
      candidates: phoneCandidates.slice(0, 10).map((c) => ({ id: c.id, full_name: c.full_name, linet_account_id: c.linet_account_id || null, woo_customer_id: c.woo_customer_id || null })),
      ...base,
    };
  }

  if (email.usable_for_identity) {
    const byEmail = (
      await Promise.all([
        sr.Client.filter({ normalized_email: email.normalized_email }, null, 20),
        sr.Client.filter({ email: email.normalized_email }, null, 20),
      ])
    ).flat().filter(usable);
    const map = new Map<string, any>();
    byEmail.forEach((c: any) => map.set(c.id, c));
    const list = [...map.values()];
    if (list.length === 1) {
      return { status: "MATCHED", client_id: list[0].id, match_method: "normalized_email", confidence: "strong", evidence: email.normalized_email, ...base };
    }
    if (list.length > 1) {
      const key = nameKey(input.name);
      const byName = key ? list.filter((c) => nameKey(c.full_name) === key) : [];
      if (byName.length === 1) {
        return { status: "MATCHED", client_id: byName[0].id, match_method: "email_plus_name", confidence: "strong", evidence: `${email.normalized_email} + name`, ...base };
      }
      return { status: "AMBIGUOUS", client_id: null, match_method: "normalized_email_multi", confidence: "ambiguous", evidence: `${email.normalized_email} → ${list.length} clients`, ...base };
    }
  }

  return { status: "NO_MATCH", client_id: null, match_method: "none", confidence: "none", evidence: null, ...base };
}

async function upsertReferences(base44: any, input: IdentityInput, clientId: string, onLinked?: (key: string) => Promise<void>) {
  const sr = base44.asServiceRole.entities;
  const now = new Date().toISOString();
  for (const ref of externalRefs(input)) {
    const key = buildCustomerIdempotencyKey(ref.integration, ref.external_entity_type, ref.external_id);
    if (!key) continue;
    const existing = await sr.IntegrationReference.filter({ external_key: key }, null, 1);
    if (existing.length > 0) {
      await sr.IntegrationReference.update(existing[0].id, { last_seen_at: now });
      continue;
    }
    if (onLinked) await onLinked(key);
    await sr.IntegrationReference.create({
      entity_type: "Customer",
      entity_id: clientId,
      integration: ref.integration.toUpperCase(),
      external_entity_type: ref.external_entity_type.toUpperCase(),
      external_id: String(ref.external_id),
      external_key: key,
      first_seen_at: now,
      last_seen_at: now,
    }).catch(() => null);
  }
}

/**
 * Guarded creation. Creates only for approved producers, and only when identity is resolvable
 * and unambiguous. Never merges and never deletes.
 */
export async function resolveOrCreateCustomer(base44: any, input: IdentityInput, createData: Record<string, any> = {}) {
  const sr = base44.asServiceRole.entities;
  const correlation_id = input.correlation_id || `cust_${crypto.randomUUID()}`;
  const audit = async (action: string, entityId: string, after: Record<string, any>) => {
    await logAudit(base44, {
      entity_type: "Client",
      entity_id: entityId,
      action,
      source: input.producer === PRODUCERS.MANUAL_UI ? "USER" : "INTEGRATION",
      integration: input.producer,
      correlation_id,
      after_data: after,
    }).catch(() => null);
  };

  const resolution = await resolveCustomerIdentity(base44, input);

  if (resolution.status === "MATCHED") {
    await upsertReferences(base44, input, resolution.client_id as string, async (key) => {
      await audit("CUSTOMER_EXTERNAL_ID_LINKED", resolution.client_id as string, { external_key: key, producer: input.producer, match_method: resolution.match_method });
    });
    await audit("CUSTOMER_RESOLUTION_MATCH", resolution.client_id as string, {
      match_method: resolution.match_method,
      confidence: resolution.confidence,
      producer: input.producer,
    });
    return { ...resolution, created: false, correlation_id };
  }

  if (resolution.status === "AMBIGUOUS") {
    await audit(resolution.data_conflict ? "CUSTOMER_EXTERNAL_ID_CONFLICT" : "CUSTOMER_RESOLUTION_AMBIGUOUS", "unresolved", {
      producer: input.producer,
      evidence: resolution.evidence,
      source_record_id: input.source_record_id || null,
    });
    return { ...resolution, created: false, blocked_reason: "AMBIGUOUS", correlation_id };
  }

  if (resolution.status === "INVALID_IDENTITY") {
    await audit("CUSTOMER_CREATION_BLOCKED", "unresolved", {
      producer: input.producer,
      reason: "INVALID_IDENTITY",
      evidence: resolution.evidence,
      source_record_id: input.source_record_id || null,
    });
    return { ...resolution, created: false, blocked_reason: "INVALID_IDENTITY", correlation_id };
  }

  // NO_MATCH → creation path
  if (!CREATION_ALLOWED_PRODUCERS.has(input.producer)) {
    await audit("CUSTOMER_CREATION_BLOCKED", "unresolved", { producer: input.producer, reason: "PRODUCER_NOT_APPROVED_FOR_CREATION" });
    return { ...resolution, created: false, blocked_reason: "PRODUCER_NOT_APPROVED_FOR_CREATION", correlation_id };
  }
  if (input.dry_run) {
    return { ...resolution, created: false, would_create: true, correlation_id };
  }

  // Idempotency + re-check immediately before create
  const recheck = await resolveCustomerIdentity(base44, input);
  if (recheck.status === "MATCHED") {
    await upsertReferences(base44, input, recheck.client_id as string);
    return { ...recheck, created: false, correlation_id };
  }
  if (recheck.status !== "NO_MATCH") {
    return { ...recheck, created: false, blocked_reason: recheck.status, correlation_id };
  }

  const payload: Record<string, any> = {
    ...createData,
    full_name: String(createData.full_name || input.name || "").trim() || "לקוח חדש",
    normalized_phone: resolution.normalized_phone || null,
    phone_validity: resolution.phone_validity,
    normalized_email: resolution.normalized_email || null,
    email_identity_class: resolution.email_identity_class,
    customer_quality_status: "ACTIVE",
    excluded_from_identity_matching: false,
    created_by_producer: input.producer,
    identity_correlation_id: correlation_id,
  };
  if (input.linet_account_id != null && String(input.linet_account_id) !== "") payload.linet_account_id = Number(input.linet_account_id);
  if (input.woo_customer_id != null && Number(input.woo_customer_id) > 0) payload.woo_customer_id = Number(input.woo_customer_id);

  const created = await sr.Client.create(payload);
  await upsertReferences(base44, input, created.id);

  // Idempotency safety net — DETERMINISTIC EVIDENCE ONLY.
  // Auto-archive of the race loser is permitted exclusively when the duplicate is proven by an
  // identical external identity (IntegrationReference / Linet account ID / Woo customer ID /
  // idempotency key). Phone-only, email-only and phone+name similarity NEVER auto-archive —
  // those paths return AMBIGUOUS / DUPLICATE_CANDIDATE earlier in the flow.
  const keys = idempotencyKeysFor(input);
  for (const key of keys) {
    const refs = await sr.IntegrationReference.filter({ external_key: key, entity_type: "Customer" }, null, 5);
    const otherId = refs.map((r: any) => r.entity_id).find((id: string) => id !== created.id);
    if (otherId) {
      await sr.Client.update(created.id, {
        customer_quality_status: "ARCHIVED",
        excluded_from_identity_matching: true,
        quality_reason: "IDEMPOTENCY_RACE_LOSER",
        canonical_client_id: otherId,
      });
      await audit("CUSTOMER_CREATION_BLOCKED", created.id, { reason: "IDEMPOTENCY_RACE", canonical_client_id: otherId });
      return { ...resolution, status: "MATCHED", client_id: otherId, match_method: "idempotency_key", confidence: "certain", created: false, correlation_id };
    }
  }

  await audit("CUSTOMER_CREATION", created.id, {
    producer: input.producer,
    normalized_phone: resolution.normalized_phone || null,
    email_identity_class: resolution.email_identity_class,
  });
  return { ...resolution, status: "MATCHED", client_id: created.id, match_method: "created", confidence: "certain", created: true, correlation_id };
}