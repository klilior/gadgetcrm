/**
 * Super-Pharm (Mirakl) customer identity.
 *
 * Mirakl gives no stable customer external ID (customer.customer_id is an email address),
 * so NO IntegrationReference is ever fabricated for Super-Pharm. Idempotency is anchored on the
 * source order/customer event key `SUPERPHARM:ORDER_CUSTOMER:<mirakl_order_id>`, stored on the
 * created Client as source metadata (Client.source_identity_key).
 *
 * Resolution order (policy §2): valid phone → phone+name → phone+email → phone+address →
 * email+name (support only, never email alone) . Never name-only, never invalid phone,
 * never placeholder/test email.
 */
import { PRODUCERS, resolveCustomerIdentity, resolveOrCreateCustomer } from "./customerIdentity.ts";
import { classifyCustomerEmail, validateCustomerPhone } from "./customerIdentityPolicy.ts";

export const SP_INTEGRATION = "SUPERPHARM";

/** Deterministic idempotency key for one Super-Pharm order/customer event. */
export function spIdentityKey(order: any): string {
  return `${SP_INTEGRATION}:ORDER_CUSTOMER:${order.mirakl_order_id}`;
}

const isEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());

/** Identity + snapshot data as it appeared in the source order. Never rewritten later. */
export function extractSpCustomer(order: any) {
  let raw: any = {};
  try { raw = JSON.parse(order.raw_mirakl_json || "{}"); } catch (_) { raw = {}; }
  const cust = raw.customer || {};
  const ship = cust.shipping_address || {};
  const bill = cust.billing_address || {};

  const firstName = String(order.customer_first_name || cust.firstname || "").trim();
  const lastName = String(order.customer_last_name || cust.lastname || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
    || String(ship.lastname || bill.lastname || "").trim();

  const email = isEmail(cust.customer_id)
    ? String(cust.customer_id).trim()
    : (isEmail(raw.customer_notification_email) ? String(raw.customer_notification_email).trim() : "");

  return {
    name: fullName,
    phone: String(order.customer_phone || ship.phone || bill.phone || "").trim(),
    email,
    city: String(order.shipping_city || ship.city || "").trim(),
    street: String(order.shipping_street || ship.street_1 || "").trim(),
    zip: String(order.shipping_zip || ship.zip_code || "").trim(),
    address_full: String(order.shipping_address_full || "").trim(),
  };
}

/** Match methods Super-Pharm is allowed to link an order on (deterministic / high confidence). */
const SP_LINKABLE_METHODS = new Set([
  "source_identity_key",
  "integration_reference",
  "legacy_linet_account_id",
  "legacy_woo_customer_id",
  "normalized_phone",
  "phone_plus_name",
  "phone_plus_email",
  "phone_plus_address",
  "email_plus_name",
  "created",
  "idempotency_key",
]);

export function buildSpIdentityInput(order: any, correlation_id?: string, dry_run = false) {
  const c = extractSpCustomer(order);
  return {
    input: {
      producer: PRODUCERS.SUPERPHARM_SYNC,
      phone: c.phone,
      email: c.email,
      name: c.name,
      address: { city: c.city, street: c.street, zip: c.zip },
      source_identity_key: spIdentityKey(order),
      source_record_id: order.mirakl_order_id,
      correlation_id,
      dry_run,
    },
    snapshot: c,
  };
}

const hasUsableName = (name: string) => name.replace(/[^\u0590-\u05FFa-zA-Z]/g, "").length >= 2;

/**
 * Read-only classification of one order.
 * category: MATCHED_EXISTING | SAFE_NEW_CUSTOMER | AMBIGUOUS | INVALID_IDENTITY | NO_USABLE_IDENTITY
 */
export async function classifySpOrder(base44: any, order: any) {
  const { input, snapshot } = buildSpIdentityInput(order);
  const phone = validateCustomerPhone(snapshot.phone);
  const email = classifyCustomerEmail(snapshot.email);

  if (!snapshot.phone && !email.usable_for_identity) {
    return { category: "NO_USABLE_IDENTITY", client_id: null, match_method: "none", evidence: "no phone, no usable email", snapshot };
  }

  const resolution = await resolveCustomerIdentity(base44, input);

  if (resolution.status === "MATCHED") {
    const linkable = SP_LINKABLE_METHODS.has(resolution.match_method as string);
    return {
      category: linkable ? "MATCHED_EXISTING" : "AMBIGUOUS",
      client_id: linkable ? resolution.client_id : null,
      match_method: resolution.match_method,
      confidence: resolution.confidence,
      evidence: linkable ? resolution.evidence : `low-confidence method ${resolution.match_method}`,
      snapshot,
    };
  }
  if (resolution.status === "AMBIGUOUS") {
    return { category: "AMBIGUOUS", client_id: null, match_method: resolution.match_method, evidence: resolution.evidence, candidates: (resolution as any).candidates || null, snapshot };
  }
  if (resolution.status === "INVALID_IDENTITY") {
    const cat = !snapshot.phone ? "NO_USABLE_IDENTITY" : "INVALID_IDENTITY";
    return { category: cat, client_id: null, match_method: "none", evidence: resolution.evidence, snapshot };
  }

  // NO_MATCH — is it a safe new customer?
  const phoneOk = phone.validity === "VALID_MOBILE" || phone.validity === "VALID_LANDLINE";
  if (!phoneOk) {
    return { category: snapshot.phone ? "INVALID_IDENTITY" : "NO_USABLE_IDENTITY", client_id: null, match_method: "none", evidence: `phone=${phone.validity}`, snapshot };
  }
  if (!hasUsableName(snapshot.name)) {
    return { category: "INVALID_IDENTITY", client_id: null, match_method: "none", evidence: "unusable customer name", snapshot };
  }
  return { category: "SAFE_NEW_CUSTOMER", client_id: null, match_method: "none", evidence: `no match for ${phone.normalized_phone}`, snapshot };
}

/**
 * Guarded resolve + link for one order.
 * Never merges clients, never overwrites the order's own customer snapshot.
 */
export async function resolveSpOrderCustomer(
  base44: any,
  order: any,
  opts: { dry_run?: boolean; allow_create?: boolean; correlation_id?: string } = {},
) {
  const sr = base44.asServiceRole.entities;
  const dry_run = opts.dry_run !== false && opts.dry_run !== undefined ? true : false;
  const key = spIdentityKey(order);

  if (order.client_id) {
    return { category: "ALREADY_LINKED", client_id: order.client_id, match_method: "existing_link", created: false, key };
  }

  const classification = await classifySpOrder(base44, order);

  // Categories that must never create or link
  if (classification.category === "AMBIGUOUS" || classification.category === "INVALID_IDENTITY" || classification.category === "NO_USABLE_IDENTITY") {
    if (!dry_run) {
      await sr.SuperPharmOrder.update(order.id, {
        identity_status: classification.category,
        identity_match_method: classification.match_method || "none",
        identity_source_key: key,
      }).catch(() => null);
    }
    return { ...classification, created: false, key };
  }

  if (classification.category === "MATCHED_EXISTING") {
    if (!dry_run) {
      await sr.SuperPharmOrder.update(order.id, {
        client_id: classification.client_id,
        identity_status: "MATCHED_EXISTING",
        identity_match_method: classification.match_method,
        identity_source_key: key,
      });
    }
    return { ...classification, created: false, linked: true, key };
  }

  // SAFE_NEW_CUSTOMER
  if (!opts.allow_create) {
    return { ...classification, created: false, blocked_reason: "CREATION_NOT_REQUESTED", key };
  }

  const { input, snapshot } = buildSpIdentityInput(order, opts.correlation_id, dry_run);
  const result = await resolveOrCreateCustomer(base44, { ...input, dry_run }, {
    full_name: snapshot.name,
    phone: snapshot.phone,
    email: snapshot.email || undefined,
    city: snapshot.city || undefined,
    full_address: snapshot.address_full || undefined,
    source: "Super-Pharm",
    source_identity_key: key,
    notes: `נוצר מהזמנת סופר-פארם ${order.mirakl_order_id}`,
  });

  if (result.status !== "MATCHED" || !result.client_id) {
    if (!dry_run) {
      await sr.SuperPharmOrder.update(order.id, {
        identity_status: result.blocked_reason || result.status,
        identity_match_method: result.match_method || "none",
        identity_source_key: key,
      }).catch(() => null);
    }
    return { ...classification, category: result.status === "AMBIGUOUS" ? "AMBIGUOUS" : "BLOCKED", created: false, blocked_reason: result.blocked_reason || result.status, key };
  }

  if (!dry_run) {
    await sr.SuperPharmOrder.update(order.id, {
      client_id: result.client_id,
      identity_status: result.created ? "CLIENT_CREATED" : "MATCHED_EXISTING",
      identity_match_method: result.match_method,
      identity_correlation_id: result.correlation_id,
      identity_source_key: key,
    });
  }

  return {
    ...classification,
    category: result.created ? "CLIENT_CREATED" : "MATCHED_EXISTING",
    client_id: result.client_id,
    match_method: result.match_method,
    created: Boolean(result.created),
    idempotency_prevented: !result.created && result.match_method === "source_identity_key",
    linked: true,
    key,
  };
}