# Customer Identity Conventions

## Canonical phone format
`0XXXXXXXXX` — Israeli local form, digits only, leading zero, no separators.
Produced ONLY by `normalizeCustomerPhone()` in `base44/shared/customerIdentityPolicy.ts`.
Accepted inputs: `0541234567`, `054-123-4567`, `054 123 4567`, `+972541234567`, `972541234567`, `00972541234567`.
Stored additively in `Client.normalized_phone`. `Client.phone` is never overwritten.

Validity classes (`validateCustomerPhone`): `VALID_MOBILE`, `VALID_LANDLINE`, `INVALID`, `EMPTY`.
Only VALID_* may be used for identity matching.

## Canonical email format
trim → collapse whitespace → strip display name → lowercase. Stored in `Client.normalized_email`.
NO Gmail dot normalization and NO plus-stripping (no proven business rule).

## Non-identity emails
`classifyCustomerEmail()` returns `TEST_EMAIL | SHARED_EMAIL | PLACEHOLDER_EMAIL | RELAY_EMAIL | INVALID_EMAIL | EMPTY | USABLE`.
Anything other than `USABLE` may never be used for match, merge evidence, canonical identity, duplicate
confidence or a creation decision. Values are still preserved in history.

## Resolution priority (`resolveCustomerIdentity`)
1. `IntegrationReference` exact unique match (`LINET:CUSTOMER:<id>`, `WOOCOMMERCE:CUSTOMER:<id>`, …)
2. Legacy external id fields (`Client.linet_account_id`, `Client.woo_customer_id`)
3. Canonical phone (valid, single reliable candidate)
4. Corroboration: usable email + name, phone + name
Never: name only, placeholder email, invalid phone.
More than one candidate → `AMBIGUOUS` (never "first match").

## Idempotency
Creation is idempotent through `IntegrationReference.external_key` (unique).
Keys are built from external identifiers only — never from name or email.

## Quality flags (additive)
`customer_quality_status`, `excluded_from_identity_matching`, `quality_reason`,
`canonical_client_id` (reserved, not used for merge yet), `normalized_phone`, `normalized_email`.