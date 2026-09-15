/**
 * Customer Identity Policy — canonical normalization, validation and identity policy.
 * This module is the SINGLE source of truth for customer phone/email normalization.
 * Additive only: it never rewrites the original phone/email values.
 */

/** Canonical Israeli phone format: local leading-zero digits only, e.g. 0541234567 / 037654321 */
export const CANONICAL_PHONE_FORMAT = "0XXXXXXXXX (local, digits only)";

export type PhoneValidity = "VALID_MOBILE" | "VALID_LANDLINE" | "INVALID" | "EMPTY";
export type EmailIdentityClass =
  | "USABLE"
  | "TEST_EMAIL"
  | "SHARED_EMAIL"
  | "PLACEHOLDER_EMAIL"
  | "RELAY_EMAIL"
  | "INVALID_EMAIL"
  | "EMPTY";

/** Extensible registry of emails that must never drive customer identity. */
export const NON_IDENTITY_EMAILS: Record<string, EmailIdentityClass> = {
  "zeno.rocha@resend.com": "TEST_EMAIL",
  "test@test.com": "TEST_EMAIL",
  "test@example.com": "TEST_EMAIL",
  "noreply@example.com": "PLACEHOLDER_EMAIL",
  "example@example.com": "PLACEHOLDER_EMAIL",
};

/** Domains whose senders are systems/relays, never customers. */
export const NON_IDENTITY_EMAIL_DOMAINS: Record<string, EmailIdentityClass> = {
  "resend.com": "RELAY_EMAIL",
  "resend.dev": "RELAY_EMAIL",
  "email.amazonses.com": "RELAY_EMAIL",
  "amazonses.com": "RELAY_EMAIL",
  "sendgrid.net": "RELAY_EMAIL",
  "mailgun.org": "RELAY_EMAIL",
  "example.com": "PLACEHOLDER_EMAIL",
  "example.org": "PLACEHOLDER_EMAIL",
  "test.com": "TEST_EMAIL",
  "mailinator.com": "TEST_EMAIL",
  "gadget-team.co.il": "RELAY_EMAIL",
};

/** Local-parts that indicate an automated sender (marketing / system / no-reply). */
const SYSTEM_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
  "newsletter",
  "marketing",
  "updates",
  "billing-noreply",
  "support-noreply",
  "hello",
  "team",
];

const EMAIL_SYNTAX = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Canonical email normalization: trim, collapse whitespace, lowercase. No dot/plus rewriting. */
export function normalizeCustomerEmail(raw: unknown): string {
  if (raw == null) return "";
  let value = String(raw).replace(/\s+/g, " ").trim();
  const angle = value.match(/<([^>]+)>/);
  if (angle) value = angle[1].trim();
  return value.toLowerCase();
}

export function classifyCustomerEmail(raw: unknown): {
  normalized_email: string;
  email_identity_class: EmailIdentityClass;
  usable_for_identity: boolean;
  reason: string | null;
} {
  const normalized = normalizeCustomerEmail(raw);
  if (!normalized) {
    return { normalized_email: "", email_identity_class: "EMPTY", usable_for_identity: false, reason: "EMPTY" };
  }
  if (!EMAIL_SYNTAX.test(normalized)) {
    return { normalized_email: normalized, email_identity_class: "INVALID_EMAIL", usable_for_identity: false, reason: "SYNTAX" };
  }
  const explicit = NON_IDENTITY_EMAILS[normalized];
  if (explicit) {
    return { normalized_email: normalized, email_identity_class: explicit, usable_for_identity: false, reason: "EXPLICIT_LIST" };
  }
  const [localPart, domain] = normalized.split("@");
  const domainClass = NON_IDENTITY_EMAIL_DOMAINS[domain];
  if (domainClass) {
    return { normalized_email: normalized, email_identity_class: domainClass, usable_for_identity: false, reason: "DOMAIN_LIST" };
  }
  if (SYSTEM_LOCAL_PARTS.some((p) => localPart === p || localPart.startsWith(`${p}+`) || localPart.startsWith(`${p}.`))) {
    return { normalized_email: normalized, email_identity_class: "RELAY_EMAIL", usable_for_identity: false, reason: "SYSTEM_SENDER" };
  }
  return { normalized_email: normalized, email_identity_class: "USABLE", usable_for_identity: true, reason: null };
}

/** True when an email sender must never cause customer creation (marketing / relay / system). */
export function isSystemSenderEmail(raw: unknown): boolean {
  return !classifyCustomerEmail(raw).usable_for_identity;
}

/**
 * Canonical phone normalization — the only implementation allowed in the system.
 * Accepts 0541234567 / 054-123-4567 / 054 123 4567 / +972541234567 / 972541234567 / 00972541234567.
 * Returns canonical local form (0XXXXXXXXX) or "" when nothing usable can be derived.
 */
export function normalizeCustomerPhone(raw: unknown): string {
  if (raw == null) return "";
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00972")) digits = digits.slice(5);
  else if (digits.startsWith("9720")) digits = digits.slice(4);
  else if (digits.startsWith("972")) digits = digits.slice(3);
  else if (digits.startsWith("0972")) digits = digits.slice(4);
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";
  return `0${digits}`;
}

export function validateCustomerPhone(raw: unknown): { normalized_phone: string; validity: PhoneValidity } {
  const normalized = normalizeCustomerPhone(raw);
  if (!normalized) return { normalized_phone: "", validity: "EMPTY" };
  if (/^05\d{8}$/.test(normalized)) return { normalized_phone: normalized, validity: "VALID_MOBILE" };
  if (/^0(2|3|4|8|9|7[2-9])\d{7}$/.test(normalized)) return { normalized_phone: normalized, validity: "VALID_LANDLINE" };
  return { normalized_phone: normalized, validity: "INVALID" };
}

export function isPhoneUsableForIdentity(raw: unknown): boolean {
  const v = validateCustomerPhone(raw).validity;
  return v === "VALID_MOBILE" || v === "VALID_LANDLINE";
}

/** All raw storage variants a legacy record might hold for one canonical phone. */
export function phoneLookupVariants(canonical: string): string[] {
  if (!canonical) return [];
  const local = canonical.slice(1);
  return [canonical, local, `972${local}`, `+972${local}`, `9720${local}`, `+9720${local}`, `00972${local}`];
}

/** Idempotency / IntegrationReference key. External identifiers only — never name or email. */
export function buildCustomerIdempotencyKey(
  integration: string,
  externalEntityType: string,
  externalId: string | number,
): string | null {
  const parts = [integration, externalEntityType, externalId].map((p) => String(p ?? "").trim());
  if (parts.some((p) => !p)) return null;
  return `${parts[0].toUpperCase()}:${parts[1].toUpperCase()}:${parts[2]}`;
}