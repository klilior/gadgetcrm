# Security Remediation Phase 1 — 2026-09-14

## Scope and safety boundary
Focused security remediation only. No Customer, Supplier, Product, or Order canonicalization/migration was started. No charge, SMS, WhatsApp message, shipment, or invoice was created. Secret values are intentionally absent from this report.

## 1. Legacy login dependency map

### Flow
`LoginScreen`
→ `UserAuth.login(identifier, password)`
→ backend `issue-whatsapp-session`
→ exact Employee lookup by email or username
→ active check + legacy `Employee.password_hash` comparison
→ HMAC-signed employee session (90 minutes)
→ sanitized Employee response (password_hash removed)
→ session token in sessionStorage; current/shift Employee metadata in localStorage
→ UI permissions from Employee.role/app_role
→ logout/endShift/90-minute inactivity clears local and session storage.

### Restore and fallback paths
- Manager restore now sends the existing signed token to `issue-whatsapp-session` action `restore_session`; the browser no longer reloads the full Employee record for this path.
- Active shift users are restored from sanitized localStorage metadata and their tokens remain in sessionStorage.
- When no legacy shift exists, Base44 Auth is checked. Its Employee mapping now uses the sanitized `employeeDirectory` backend response rather than a direct Employee query.
- WhatsApp send accepts either the signed Employee session or Base44 Auth.
- Base44 Auth and legacy Employee auth remain separate identities during transition.

### Live dependency facts (values not included)
- Employee records: 11.
- Records with password_hash present: 11.
- Records with user_id: 3.
- Active Employees without user_id: 2.
- Active Employees with password_hash and no user_id: 2. These accounts must be treated as legacy-login-dependent until individually verified.
- Login UI is responsive and supports shared-shift usage (up to five Employees), so kiosk/shared-terminal behavior depends on the legacy flow.
- Attendance UI is reachable through currentUser, but clockIn/clockOut authorize through Base44 Auth. This is an identity mismatch to resolve in a separate Attendance migration; do not remove legacy login on its account.

## 2. password_hash client exposure
- The login and restore function responses explicitly remove password_hash.
- `employeeDirectory` uses an allowlist and never returns password_hash.
- The manager restore and Base44-auth Employee lookup paths were moved to sanitized responses.
- Field-level read hiding is not supported by the current entity RLS mechanism.
- Employee remains directly queried by shared employee-provider/administrative consumers. Therefore password_hash is still potentially present in client entity responses today.
- Employee-wide RLS was not changed because custom Employee-auth users and manager screens could be locked out. Immediate mitigation: do not log/serialize/display the field; migrate remaining direct readers to a safe backend allowlist only after testing every legacy consumer.

## 3. Zero-downtime migration plan to Base44 Auth
1. Inventory all active Employees; make user_id required operationally before schema enforcement.
2. Invite/create Base44 User access outside the Employee entity; never copy legacy passwords.
3. Deterministically link User.id → Employee.user_id, with exact unique email only as a temporary matching aid.
4. Pilot the two active password-only accounts one at a time, including shared-shift/kiosk and Attendance tests.
5. During overlap, Base44 Auth is primary; legacy login remains available only for unmapped active Employees.
6. Change permission resolution to authenticated User → server-side Employee mapping → business role.
7. Verify login, shift switching, WhatsApp session, Attendance, expiry, and logout for every active account.
8. Disable legacy login per Employee only after successful verification and rollback window.
9. Remove password_hash only after zero active dependencies and a final response/query scan.

## 4. Secret classification
### A — real secret/credential
- GetPackageSettings.api_token (present).
- ShippingProvider.config.api_token for Cargo (present).
- PaymentSettings keys zcredit_password and zcredit_terminal (present; terminal treated as credential metadata).
- PaymentSettings linet_user/linet_api_key/linet_login_company are credential keys, but current entity values are empty; Linet secrets already exist in the secret store.
- Settings keys: PBX_TOKEN_ID, RESEND_API_KEY, GMAIL_APP_PASSWORD, WOOCOMMERCE_WEBHOOK_SECRET, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET, GMAIL_INBOUND_WEBHOOK_TOKEN, LINET_LOGIN_HASH, LINET_LOGIN_ID, LINET_LOGIN_COMPANY.
- TextMe API token is already in the secret store; TextMeConfig.username is account configuration, not the bearer token.

### B — non-secret configuration
- GetPackage environment, URLs, pickup defaults, feature flags.
- PaymentSettings mode, return/fail URLs, default flow, installments, max payments, Linet base URL/doc type.
- Cargo customer code, sender address/phone (sensitive business contact data but not authentication secrets).
- TextMe username, sender name, hours, limits, admin phones.
- Settings feature flags, templates, URLs, days, progress/debug metadata and public sender identifiers.

### C — mixed JSON
- ShippingProvider.config: Cargo token plus customer/sender configuration.
- WhatsappProvider.config: provider API token/key plus sender/base URL configuration. No current WhatsappProvider records were found.

### D — historical transaction token
- Payment.zcredit_token is transaction-specific by schema/context, not a global integration credential. In the sampled 8 payment records it was absent in all records. It must not be moved to a global secret.
- Payment raw_request/raw_response require masking and restricted reads; current sampled raw requests are sanitized metadata.

### Velo
- VeloSession.jwt is a session credential. The entity schema remains with read denied and admin-only writes; the obsolete integration should be removed only in a separately verified cleanup. No secret migration was performed.

## 5. Secrets moved
None in this phase. The secure secret-entry request was rejected by the builder. No legacy value was read, copied, cleared, disabled, or logged. Existing secret-store entries (including TextMe, Linet, Bot.it, Mirakl, UPS and WhatsApp gateway secrets) were not modified.

## 6. Consumers updated
- `issue-whatsapp-session`: added signed-session restore returning a sanitized Employee object.
- `UserAuth`: manager restore and Base44-auth Employee mapping no longer perform direct Employee reads.
- `updateInvoiceStatus`: authorization continues to use authenticated User + server-resolved Employee only; authenticated forbidden attempts are now audited.
- `clockIn` and `clockOut`: auth exceptions are mapped to 401 in the edited version rather than the generic 500 path.

No secret consumer was changed because required secrets were not approved/provided. Existing consumers still reading entity credentials include GetPackage, Cargo, Z-Credit, WooCommerce, Resend and PBX flows.

## 7. Legacy fields retained
- Employee.password_hash: required by two active, unmapped legacy accounts and shared-shift login.
- GetPackageSettings.api_token, Cargo config.api_token, PaymentSettings credential rows and sensitive Settings rows: retained because no replacement secrets were supplied.
- Payment.zcredit_token: retained in schema for historical transaction compatibility; no sampled values exist.
- Attendance user_id fields: retained because they mix identity semantics and need a separate migration to employee_id.
- RepairLog.actor_user_id: retained for compatibility; actor_employee_id exists and status updates dual-write canonical identities.

## 8. updateInvoiceStatus authorization verification
- Admin/current authenticated builder: reached invoice lookup and returned 404 for a deliberately nonexistent invoice, proving authorization passed without performing an update.
- Unauthenticated request with forged role/isAdmin/employeeRole: 401.
- Client-supplied role/isAdmin/employeeRole/permissions are not read by the authorization decision.
- Regular user: static branch verification shows 403 unless server-resolved Employee.role is manager. A dynamic regular-user test identity was not available; no identity was impersonated or created.
- Authenticated 403 attempts are written to AuditLog with no sensitive values.

## 9. functions/then
Three historical POST 404 records were found on `/UnifiedOrders`, all on 2026-09-11. The URL proves a function proxy/thenable was previously treated as a Promise or otherwise asked to invoke a function literally named `then`; it is not an external provider URL. Current Unified Orders and its inspected child components contain explicit function wrapper calls and no `then` function invocation or unsafe URL construction. No newer records were found. No business-flow change was made because the current source does not contain a deterministic call site; monitor for recurrence.

## 10. Identity dual-write
RepairLog already has actor_user_id and actor_employee_id. Repair status updates write authenticated User ID (when present) and Employee ID separately. No breaking rename was made. Attendance canonical replacement remains planned as employee_id.

## 11. RLS changes
None. Snapshot findings:
- VeloSession already denies reads and allows writes only to Base44 admins.
- Employee-wide RLS was intentionally not changed because field-level hiding is unavailable and legacy/client dependencies remain.
- Credential/payment entities were not tightened before their client consumers are migrated.

## 12. Rollback
- Legacy session restore: revert `issue-whatsapp-session` to credential-only behavior and restore manager lookup to direct Employee filter. Existing login remains otherwise unchanged.
- Sanitized Base44 mapping: restore UserAuth Employee.filter lookup. This is not recommended because it re-exposes the full record.
- Invoice denied audit: remove only the AUTHORIZATION_DENIED audit block; server-side authorization remains unchanged.
- Attendance status mapping: restore direct auth.me call inside the outer catch, which returns 500 on auth failure.
- No data rollback is needed: no business records, credentials, hashes, payments, messages, shipments, invoices, or canonical entities were migrated.

## 13. Unresolved safety blockers
- Secret migration cannot proceed without secure secret entry approval.
- Employee.password_hash cannot be hidden at field level using entity RLS; direct client Employee consumers remain.
- Two active Employees have no User mapping and may depend exclusively on legacy login.
- Dynamic regular-user authorization testing requires an existing non-admin test identity; none was impersonated.
- Attendance identity semantics are inconsistent and need their own planned migration.
- The public published function endpoint may continue showing the previous release until publishing; backend validation tests exercised the edited function version.
- functions/then has no current deterministic call site; changing order flow would be unsafe.

## Recommendation
Do not begin Supplier canonicalization yet. First supply/approve replacement secrets, migrate and verify one consumer at a time, map and test the two active legacy-only Employees, remove remaining direct Employee reads, and complete negative authorization verification with a real regular-user test account.