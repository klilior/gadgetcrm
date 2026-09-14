# Permission Matrix - read-only assessment

No existing RLS rule was changed in the foundation phase. In Base44, an omitted operation is open. Business roles belong to Employee; `user_condition.role` supports the authentication roles `admin` and `user`, not Employee role labels.

## Explicit RLS found

| Entity | Current read | Current create | Current update | Current delete | Admin behavior | Employee behavior | Exposure / defect | Severity | Future policy |
|---|---|---|---|---|---|---|---|---|---|
| WhatsAppCloudMessage | admin | admin | admin | admin | Allowed | Denied | Correctly restricted; webhook writes use service role | LOW | Keep admin/service-only |
| Shift | malformed ` $or`; missing `data.`; Employee/User mismatch | omitted/open | inherits legacy write | inherits legacy write | write intended admin-only | Intended employee read is unreliable | HR records can be created without intended gate; read may lock users out | CRITICAL | Explicit create/update/delete; bridge User to Employee in backend |
| ShiftAssignment | malformed ` $or`; missing `data.`; Employee/User mismatch | omitted/open | inherits legacy write | inherits legacy write | Intended business-role checks are not auth roles | Employee membership compares Employee IDs to User ID | Open create and unreliable read | CRITICAL | Explicit operations after identity migration |
| ShiftRequest | missing `data.`; Employee/User mismatch; unsupported business-role list | omitted/open | inherits legacy write | inherits legacy write | Only true auth admin is dependable | Employee self-access unreliable | Open create and possible lockout | HIGH | Employee-aware service + explicit operations |
| Task | missing `data.`; Employee/User mismatch; unsupported business-role list | omitted/open | inherits legacy write | inherits legacy write | Only true auth admin is dependable | Assignee self-access unreliable | Open create and possible lockout | HIGH | Explicit task ownership after mapping |
| WeeklySchedule | unsupported business-role list in user_condition | omitted/open | inherits legacy write | inherits legacy write | True admin may pass only if exact rule is supported | Managers represented only as Employee roles may fail | Open create; manager access unreliable | HIGH | Admin/service writes; Employee role checked server-side |
| PredefinedResponse | authenticated admin/user | admin | admin | admin | Full | Read only | Pilot fixed unsupported business-role checks and open writes | LOW | Keep; business management changes go through service later |
| BonusEntry | `data.agent_id` compared to User ID; unsupported role list | unsupported business-role list | unsupported business-role list | unsupported business-role list | Admin intent exists but rule shape is unreliable | Employee self-read unreliable | Payroll/commission information may be locked or exposed through incorrect assumptions | CRITICAL | Admin/service writes; Employee read via mapped employee ID |

## New foundation entities

| Entity | Read | Create | Update | Delete | Admin | Employee | Severity | Future policy |
|---|---|---|---|---|---|---|---|---|
| IntegrationReference | admin | admin | admin | admin | Full | None | LOW | Keep service/admin writes; domain-specific read later if needed |
| AuditLog | admin | admin | admin | admin | Full | None | LOW | Append-only service writes; remove update/delete in a separately approved security phase |
| MigrationRun | admin | admin | admin | admin | Full | None | LOW | Admin/service-only |

## Existing entities with no RLS

For all entities below, read/create/update/delete are currently omitted and therefore open at the data layer. Admin and Employee behavior are identical at RLS level. UI visibility is not a security boundary.

### CRITICAL - credentials, identity, finance, personal or operationally destructive data

Employee; Client; Settings; PaymentSettings; GetPackageSettings; TextMeConfig; VeloSession; ShippingProvider; ShippingSettings; WhatsappProvider; AttendanceDevice; Payment; Invoices; InvoiceLine; InvoiceIntakeRaw; Suppliers; RepairDevice; Repair; Ticket; Shipment; Order; OrderProduct; SuperPharmOrder; SalesTransaction; SerialInventory; OrderSerialLine; OrderItemSerial; CommissionEntry; CommissionModel; CommissionRule; AgentCommissionModel; PayrollSettings; AttendanceEvent; AttendanceDay; AttendanceMonth; AttendanceEdit; LeaveRequest; Weekly employee-related records not already listed.

Recommended future policy: authenticated minimum, admin/service for sensitive writes, Employee-scoped reads only after User-Employee mapping is complete. Configuration secrets must move to platform secrets in a separately approved integration/security phase.

### HIGH - business operations, customer communication, imports and reconciliation

Activity; Conversation; NotificationLog; Lead; UndeliveredOrderTask; OrderFollowup; PickingState; LinetOrderStatus; LinetPurchaseDocument; InvoiceReconciliationGap; MissingInvoiceAlerts; RecurringExpenseCheck; SupplierPattern; ClassificationMemory; SupplierProductPrice; LineContract; ContractNote; LineImportBatch; LineImportRow; RepairLog; SerialAuditLog; BackfillRunLog; Target; SalesGoal; GoalDefinition; GoalProgress; TargetBonusDefinition; ShiftBonusDefinition; BonusEntry-related definitions; CommissionGroup; CommissionGroupMapping; SalesActivity.

Recommended future policy: authenticated reads by business need; all state-changing actions through domain services; explicit create/update/delete rules; no hard delete for business history.

### MEDIUM - catalogs, mappings and integration diagnostics

Product; LinetProductMap; LineProductDefinition; LinetCategoryTranslation; CarrierPolicy; CarrierProductMapping; Product monitoring records; PriceSnapshot; PriceRecommendation; PriceAlert; ProductsMonitor; SyncMetadata; SyncLog; WebhookLog; PriceMonitorLog; GetPackageShipment; LinetUsersMap.

Recommended future policy: authenticated read; admin/service-managed catalogs and mappings; technical logs admin-only; provider payloads and tokens never exposed to normal users.

### LOW / currently empty but still requires policy before use

LinetCustomer; ClassificationMemory; AgentCommissionModel; ShippingSettings; AttendanceMonth; AttendanceDay; AttendanceEdit; LeaveRequest; ShiftAssignment; BonusEntry; SalesGoal; TargetBonusDefinition; PayrollSettings; OvertimeRule; WhatsappProvider.

Recommended future policy: define RLS before activation rather than relying on the current empty dataset.

## RLS Pilot applied

- PredefinedResponse: authenticated read; admin create/update/delete.
- NotificationTemplate: authenticated read; admin create/update/delete.
- ClientErrorLog: authenticated create; admin read/update/delete.
- Admin reads passed. Regular mapped/unmapped User matrices were inspected statically; production impersonation was not available.

## Priority findings

1. CRITICAL: Employee password/authentication data and several integration configuration entities have no RLS.
2. CRITICAL: Shift, ShiftAssignment and BonusEntry rules mix Employee IDs with User IDs or contain malformed/unsupported conditions.
3. HIGH: Task, ShiftRequest and WeeklySchedule use business roles as if they were Base44 auth roles; PredefinedResponse was corrected in the Pilot.
4. HIGH: Most business entities have no explicit RLS for any operation.
5. MEDIUM: Technical logs and raw integration payloads are not consistently admin-only.

This matrix is advisory only. No broad RLS correction is authorized or performed.