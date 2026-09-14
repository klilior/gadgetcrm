# Foundation Identity and Security Report

## Secrets audit

No secret values are recorded in this report.

| Severity | Entity / location | Field | Integration | Current protection | Exposure | Recommended action |
|---|---|---|---|---|---|---|
| CRITICAL | Employee | password_hash | Legacy employee login | No RLS | Populated legacy passwords are readable at data layer | Migrate login to Base44 auth, remove password storage after compatibility plan, then add HR RLS |
| CRITICAL | VeloSession | jwt | Velo | No RLS | Reusable session credential | Move to platform secret/server cache; admin/service-only data |
| CRITICAL | GetPackageSettings | api_token | GetPackage | No RLS | API credential may be readable/writable | Move token to platform secret; retain non-secret settings separately |
| CRITICAL | PaymentSettings | setting_value | Z-Credit/Linet | No RLS | Generic value may contain credentials | Inventory keys without values, move secrets to platform storage, then admin/service-only policy |
| CRITICAL | ShippingProvider | config | Shipping providers | No RLS | Free-form config explicitly permits API keys | Split secret and non-secret config; move credentials to platform secrets |
| CRITICAL | WhatsappProvider | config | WhatsApp providers | No RLS | Required free-form provider credentials | Move credentials to platform secrets; keep public metadata only |
| CRITICAL | Payment | zcredit_token, raw_request, raw_response | Z-Credit | No RLS | Payment token and payload exposure | Server-only reads/writes; minimize retained payloads; redact existing data through approved migration |
| HIGH | ShippingSettings | setting_value | Velo/shipping | No RLS | Generic integration configuration | Classify values, move credentials, then admin/service-only |
| HIGH | Settings | setting_value | Multiple | No RLS | Generic settings may contain operational secrets or payloads | Allowlist non-secret keys; move credentials and large diagnostics out |
| HIGH | TextMeConfig | username, admin_phones | TextMe | No RLS | Account metadata and phone PII | Admin/service-only after dependency check; API token already uses platform secret |
| MEDIUM | Source functions | environment secret names | Linet, Mirakl, shipping, Gmail, TextMe, Botit | Backend-only platform secrets | Names are visible in code; values remain server-side | Keep; never log values or copy them to entities |

## Sensitive entity classification without adequate RLS

### CRITICAL

Employee PII/authentication: Employee, AttendanceDevice. Customer PII: Client, Ticket, Order, Shipment, SuperPharmOrder, Repair, RepairDevice. Financial/payment: Payment, PaymentSettings, Invoices, InvoiceLine, InvoiceIntakeRaw, SalesTransaction, CommissionEntry, CommissionModel, CommissionRule, AgentCommissionModel, PayrollSettings, BonusEntry. Integration secrets/configuration: Settings, GetPackageSettings, TextMeConfig, VeloSession, ShippingProvider, ShippingSettings, WhatsappProvider. Operationally destructive: SerialInventory, OrderSerialLine, OrderItemSerial.

### HIGH

Activity, Conversation, NotificationLog, Lead, UndeliveredOrderTask, OrderFollowup, PickingState, LinetOrderStatus, LinetPurchaseDocument, InvoiceReconciliationGap, MissingInvoiceAlerts, RecurringExpenseCheck, SupplierPattern, SupplierProductPrice, LineContract, ContractNote, LineImportBatch, LineImportRow, RepairLog, SerialAuditLog, BackfillRunLog, GoalDefinition, GoalProgress, SalesGoal, TargetBonusDefinition, ShiftBonusDefinition, CommissionGroup, CommissionGroupMapping, SalesActivity, AttendanceEvent, AttendanceDay, AttendanceMonth, AttendanceEdit, LeaveRequest, Shift, ShiftAssignment, ShiftRequest and WeeklySchedule.

### MEDIUM

Product and mapping/reference entities, LinetProductMap, LineProductDefinition, LinetCategoryTranslation, CarrierPolicy, CarrierProductMapping, monitoring entities, PriceSnapshot, PriceRecommendation, PriceAlert, SyncMetadata, SyncLog, WebhookLog, PriceMonitorLog, GetPackageShipment and LinetUsersMap. Technical logs should be admin-only; catalogs generally need authenticated read and admin/service writes.

### LOW

Public/reference-only records may remain broadly readable only after confirming they contain no internal notes, payloads, supplier terms or credentials. No entity is treated as public merely because its current dataset is empty.

## RLS Pilot

Applied only to PredefinedResponse, NotificationTemplate and ClientErrorLog.

- PredefinedResponse: authenticated admin/user read; admin create/update/delete.
- NotificationTemplate: authenticated admin/user read; admin create/update/delete.
- ClientErrorLog: admin read/update/delete; authenticated admin/user create.

Admin reads were executed successfully. Regular-user and unmapped-user behavior was statically verified from exact `user_condition` rules because production impersonation credentials are unavailable. Service-role behavior remains available to backend functions. Rollback is the exact previous schema snapshot recorded in source history.

## Actor Resolver and AuditLog Pilot

Actor Resolver now returns `authenticated_user_id`, `employee_id`, `actor_type`, `source` and the resolution method while retaining the legacy `user_id` alias.

Pilot flows:

1. Attendance edit approval.
2. Attendance edit rejection.
3. Supplier invoice approval/rejection.

Each successful action records User, mapped Employee when available, entity/action, before/after, field change, source and correlation ID. Existing business behavior and external integrations were not changed. Safe nonexistent-record invocations validated imports and code paths without creating audit or business records.

## Rollback

- Actor Resolver: remove the additive return fields; legacy `user_id`, `employee_id` and `resolution_method` remain compatible.
- Audit Pilot: remove the three audit blocks/imports; business writes remain unchanged.
- Attendance admin fix: remove `admin` from the two existing allowlists if rollback is required.
- RLS Pilot: restore the previous RLS object for PredefinedResponse and remove RLS from NotificationTemplate/ClientErrorLog. Do not roll back by deleting data.

## Security backlog order

1. Design a no-downtime migration away from Employee.password_hash before applying Employee RLS.
2. Move Velo/GetPackage/payment/shipping/WhatsApp credentials from entities to platform secrets.
3. Harden configuration entities after all backend consumers read platform secrets.
4. Normalize Attendance `user_id` to Employee semantics and route access through an Employee-aware service.
5. Fix Shift, ShiftAssignment, ShiftRequest, Task, WeeklySchedule and BonusEntry malformed Employee/User RLS.
6. Protect payment/finance and HR entities in small dependency-tested batches.
7. Protect Customer PII and operational entities through domain services.
8. Restrict technical/raw logs and provider payloads.

No destructive migration, hard delete or external credential rotation was performed.