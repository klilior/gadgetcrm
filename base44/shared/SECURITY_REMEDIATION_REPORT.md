# Foundation Security Remediation Report

Date: 2026-09-14
Status: Focused remediation completed in draft; production publish and legacy-auth migration remain open.

## Scope and safety constraints

- No supplier, customer, product, order, shipment, invoice, payment, attendance, or repair business records were deleted or rewritten.
- No secret value is included in this report, AuditLog, or application responses introduced by this remediation.
- The builder rejected creation/migration of additional platform Secrets. Existing entity-backed credentials remain in place unless already stored as platform Secrets.
- Every implemented change is additive, reversible, or reduces future sensitive logging without mutating historical records.

## Executive summary

Resolved in the draft:

1. `updateInvoiceStatus` no longer trusts `employee_role` or `employee_email` from the browser. Authorization is derived from authenticated Base44 User identity and its server-resolved Employee relationship.
2. Core Employee directory reads now pass through a sanitized backend response that never returns `password_hash`.
3. RepairLog now dual-writes canonical `actor_employee_id` while preserving the existing actor field.
4. Missing AttendanceEdit records now return HTTP 404 rather than falling into HTTP 500.
5. VeloSession is backend-read-only through RLS; JWT values are no longer returned by `veloAuth` responses.
6. Velo debug logging no longer prints configuration objects, credential prefixes, or successful login response bodies.
7. New Payment raw-request/raw-response records are sanitized so credentials, full card values, CVV, and full provider payloads are not persisted.
8. Existing `/functions/then` failures were historical; no newer ClientErrorLog entry was found after 2026-09-11. The active order code uses standard function imports rather than the prior lazy proxy pattern.

## Legacy Employee authentication map

### Entry points and sequence

1. The Base44 AuthProvider initializes the app-level authenticated User session.
2. The application layout starts a separate legacy Employee session provider.
3. The legacy login screen collects Employee username/email and password.
4. The browser invokes `issue-whatsapp-session`.
5. The backend finds one active Employee by normalized email or username, compares the submitted password with `Employee.password_hash`, and issues a 90-minute HMAC session token.
6. The response returns a sanitized Employee profile plus the legacy session token.
7. The browser stores:
   - current and active Employee IDs in local storage;
   - manager Employee ID in local storage for manager sessions;
   - activity time in local storage;
   - one legacy session token per Employee ID in session storage.
8. `UserAuth` derives application role from Employee.role. Layout visibility and several client flows use that business role.
9. When no legacy shift session exists, `UserAuth` attempts Base44 User-to-Employee resolution through `Employee.user_id` or exact email.
10. Logout clears legacy local/session state but is distinct from Base44 authentication logout.

### Consumers

- Application layout and menu authorization.
- Multi-user shift switching and adding representatives.
- Payment and WhatsApp actions that use the current legacy Employee context.
- Attendance UI and repair logging.
- Employee administration and employee directory consumers.

### Identity conflicts found

- `currentUser.id` is generally an Employee ID, not a Base44 User ID.
- Attendance backend functions derive actor identity from Base44 `auth.me()`, while some UI records historically passed or displayed Employee identity.
- Legacy role values and Base44 User roles are separate namespaces.
- `Employee.password_hash` is currently compared as a legacy password value; the field name does not imply a modern password-hashing scheme.

### Anonymous dependency counts

- Employees: 11 total.
- Active Employees: 4.
- Active with Base44 `user_id` mapping: 2.
- Active without Base44 `user_id` mapping: 2.
- Active with legacy password material: 4.
- Active without mapping and with legacy password material: 2.

Conclusion: the legacy path cannot yet be removed safely. At least two active Employees are not mapped to Base44 Users, and all active Employees still retain legacy password material.

## Safe migration plan from legacy Employee login

1. Invite/create Base44 app users through the platform user-invite flow; do not create User entity records directly.
2. Verify each Employee-to-User match using explicit `user_id` or exact confirmed email only.
3. Backfill missing `Employee.user_id` values in a dry run, then execute an idempotent mapped-only migration with AuditLog entries.
4. Keep the legacy login available during a dual-session period, but prefer the mapped Base44 User path when mapping exists.
5. Carry both `actor_user_id` and `actor_employee_id` explicitly through sensitive backend functions.
6. Migrate Attendance references that mix the two ID domains to canonical Employee IDs, with Base44 User retained only as authenticated actor.
7. Stop accepting new legacy passwords for mapped Employees after successful sign-in monitoring.
8. Remove legacy login only after every active Employee is mapped and a defined observation period shows no legacy-only successful sessions.
9. Remove or null legacy password material only in a separately approved, reversible cleanup run.

## Secret classification matrix

### A. Move to platform Secrets

Still entity-backed because additional Secret migration was rejected:

- GetPackage bearer token.
- Z-Credit terminal and credential values.
- Velo API key, API secret, account email, and password.
- Cargo API credential and account identifiers when they authenticate requests.
- WooCommerce consumer key and consumer secret.
- Resend API key.
- Gmail app password.
- PBX bearer token.
- Generic webhook shared secrets stored in Settings.

Already platform-backed and lookup-presence verified without reading values:

- Linet login company, ID, and hash.
- TextMe API token.
- Botit API key and bridge token.
- Gmail inbound webhook token.
- WhatsApp gateway shared secret.

### B. Public/non-secret configuration

- Provider base URLs.
- Public callback and return URLs.
- Provider display names and enabled flags.
- TextMe username/source number and scheduling preferences.
- Payment mode, installment limits, and public UI behavior.

### C. Sensitive operational configuration

- Generic `ShippingProvider.config` objects because sensitivity varies by provider.
- Generic `WhatsappProvider.config` objects.
- Generic Settings values whose key is not explicitly classified.
- Provider account IDs and operational routing details that are not authentication secrets but should remain admin-restricted.

### D. Temporary tokens and migration-only fields

- VeloSession JWT: temporary backend session token; now blocked from app-user reads and removed from `veloAuth` responses.
- Legacy Employee password material: migration-only after Base44 User adoption.
- Payment.zcredit_token: historical/unused field in inspected data; must not become a client-readable secret store.
- Historical Payment raw request/response payloads: potentially sensitive legacy telemetry; no bulk cleanup was performed.

## Authorization hardening

### updateInvoiceStatus

Before:

- Browser-supplied `employee_role` could authorize manager actions when Base44 auth was unavailable.

After:

- A Base44 authenticated User is required.
- Employee identity is resolved on the server.
- Authorization allows Base44 admins or a server-resolved Employee whose role is manager.
- Browser-supplied role/email fields are ignored.

Validation:

- Authenticated admin reached entity lookup and received the expected 404 for a safe nonexistent invoice.
- The currently published version still behaved like the older implementation during a direct unauthenticated probe. The draft must be published before this fix protects production.
- A regular-user runtime test requires an actual regular test account; the denial branch was verified statically but was not impersonated.

## Employee exposure reduction

A sanitized Employee directory backend now returns an explicit allow-list of fields and never returns `password_hash`.

Migrated consumers:

- User/Employee session restoration and Base44 User mapping.
- Shared EmployeeProvider directory loading.
- Employee management listing, with manager/admin detail mode for birth date and ID number.
- Attendance management employee listing.
- Repair creator lookup.

Remaining risk:

- The Employee entity itself does not support field-level RLS. Any remaining direct Employee query elsewhere can still return the full record to an authorized caller. A complete code-wide migration of every direct Employee read remains required before claiming total elimination.

## Velo security

- `VeloSession.read` is denied to app users; service-role backend functions retain access.
- Create/update/delete remain admin-restricted for direct app calls.
- `veloAuth` stores and uses JWT server-side but returns only presence, expiry, and source metadata.
- Debug functions no longer log full provider config, secret prefixes, or successful login response bodies.
- With no active Velo provider, non-external smoke tests returned controlled responses and confirmed function compilation.

## Payment data minimization

Future records:

- Never persist provider credential/password in raw request telemetry.
- Never persist full card number or CVV.
- Store only card last four digits, amount, installment count, transaction ID, and boolean-presence metadata.
- Store only provider status/presence metadata instead of full provider response payloads.

Historical records were not altered. The direct-charge function could not be runtime-tested because required `APP_BASE_URL` is not configured and adding Secrets was rejected. The hosted-session validation path returned the expected 400 for a safe invalid amount.

## Attendance 404 remediation

`approveEdit` and `rejectEdit` now translate missing-record SDK exceptions to HTTP 404. Safe nonexistent-ID tests returned 404 with the expected user-facing message.

## `/functions/then` root cause and status

Historical ClientErrorLog entries show POST requests to `/functions/then` from Unified Orders on 2026-09-11. This pattern is consistent with Promise assimilation of a generated backend-function proxy during lazy/dynamic import. The affected GetPackage call path was moved to a standard import. No later `/functions/then` record was found in the current log sample. No business record was changed for this investigation.

## RLS rollout status

Implemented:

- Existing pilot remains on PredefinedResponse, NotificationTemplate, and ClientErrorLog.
- VeloSession read is now backend-only; direct writes are admin-restricted.

Deferred pending consumer migration and explicit approval:

- Employee.
- Settings.
- Payment and PaymentSettings.
- ShippingProvider and GetPackageSettings.
- Attendance, Repair, and order-domain sensitive entities.

Reason: broad RLS activation before every frontend consumer is routed through safe backend services can silently break production flows.

## Audit trail

Security changes were recorded in AuditLog under correlation ID prefix `security_remediation_`, with no secret values. Events cover authorization hardening, Employee response reduction, RepairLog dual-write, VeloSession RLS, Payment logging reduction, Attendance 404 correction, and Velo response/log redaction.

## Rollback plan

1. Restore the prior backend authorization block only if production managers are locked out, then immediately investigate missing User-to-Employee mappings. Do not restore browser-trusted roles as a long-term state.
2. Point migrated Employee consumers back to direct entity reads only as an emergency rollback; this reopens password-field exposure.
3. Remove `actor_employee_id` writes while leaving the additive schema field intact.
4. Restore VeloSession admin read only if an admin-only operational tool requires it; do not restore JWT response exposure.
5. Restore full Payment telemetry only in a non-production diagnostic environment with synthetic card data; never in production.
6. Revert Attendance exception translation if SDK behavior changes, while retaining explicit 404 handling.

## Production readiness gates

- Publish the draft so server authorization and redaction changes reach the published app.
- Test updateInvoiceStatus with one real regular test user and confirm HTTP 403.
- Test manager invoice approval/rejection with a mapped Employee account.
- Test legacy manager login, representative shift add/switch, mapped-user initialization, and logout.
- Test Velo setup/order flow when an active provider is intentionally enabled.
- Configure or explicitly retire the missing `APP_BASE_URL` dependency before testing direct card charge.
- Complete migration of remaining direct Employee reads before removing legacy password material.