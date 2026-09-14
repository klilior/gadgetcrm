# Identity Field Map

## Canonical rule

- `User.id` = authentication identity only.
- `Employee.id` = business person identity.
- `Employee.user_id` = optional explicit User-to-Employee relationship.
- Never compare or substitute `User.id` and `Employee.id`.
- New business ownership fields use `employee_id`; authenticated actor fields use `user_id`.

## Confirmed field meanings

| Entity / field | Actual meaning | Classification | Canonical target | Compatibility plan |
|---|---|---|---|---|
| Employee.user_id | Base44 authenticated user | USER | keep | unique optional relationship |
| AuditLog.actor_user_id | authenticated actor | USER | keep | populated by Actor Resolver |
| AuditLog.actor_employee_id | mapped business actor | EMPLOYEE | keep | nullable for system/service users |
| MigrationRun.executed_by_user_id | authenticated initiator | USER | keep | add employee only if later needed |
| IntegrationReference.entity_id | canonical Base44 business record | LEGACY_ID | keep | meaning is entity-dependent, not person identity |
| AttendanceEvent.user_id | Employee record ID in current UI/functions | EMPLOYEE | employee_id | dual-read/dual-write before rename |
| AttendanceDay.user_id | Employee record ID | EMPLOYEE | employee_id | dual-read/dual-write before rename |
| AttendanceMonth.user_id | Employee record ID | EMPLOYEE | employee_id | dual-read/dual-write before rename |
| AttendanceEdit.user_id | Employee record ID | EMPLOYEE | employee_id | dual-read/dual-write before rename |
| AttendanceEdit.approver_id | Base44 authenticated approver in current backend | USER | approver_user_id + approver_employee_id | add both through Actor Resolver; retain legacy |
| Shift.shift_employees | Employee record IDs | EMPLOYEE | employee_ids | retain legacy array during transition |
| ShiftAssignment.assigned_employee_ids | Employee record IDs | EMPLOYEE | keep | RLS cannot compare these directly with User.id |
| ShiftRequest.employee_id | Employee record ID | EMPLOYEE | keep | access through User-to-Employee service mapping |
| Ticket.assigned_to | Employee record ID | EMPLOYEE | assigned_employee_id | dual-write after audited service exists |
| Task.assigned_to_id | Employee record ID | EMPLOYEE | assigned_employee_id | current RLS incorrectly compares it to User.id |
| Activity.agent_id | Employee record ID from custom employee session | EMPLOYEE | employee_id | retain legacy during dual-write |
| Repair.technician_id | Employee record ID | EMPLOYEE | employee_id or technician_employee_id | retain legacy; no blind rename |
| Repair.created_by (built-in) | creator email | EMAIL | created_by_id for User, explicit employee_id for business creator | current UI resolves Employee by email |
| RepairLog.actor_user_id | current UI writes custom Employee ID despite field name | EMPLOYEE | actor_user_id + actor_employee_id | high-priority dual-write correction |
| SalesTransaction.employee_id | canonical Employee record ID | EMPLOYEE | keep | derived from Linet mapping |
| SalesTransaction.sales_rep | Linet/display owner name | TEXT_NAME | employee_id | retain as snapshot/display value |
| LinetUsersMap.user_id | Linet external user identifier | LINET_USER | IntegrationReference or explicit linet_user_id | never use for authorization |
| LinetUsersMap.user_name | Linet display name | TEXT_NAME | display only | never use as relationship key |
| AgentCommissionModel.agent_id | current UI stores Linet user name, despite schema saying User ID | TEXT_NAME | employee_id | requires deterministic Linet-to-Employee mapping before backfill |
| AgentCommissionModel.agent_name | display snapshot | TEXT_NAME | keep as snapshot | not an identity key |
| CommissionEntry.agent_id | producer-dependent legacy agent identity | UNKNOWN | employee_id | inspect calculator outputs before migration |
| CommissionEntry.agent_name | display snapshot | TEXT_NAME | keep as snapshot | not authorization input |
| BonusEntry.agent_id | legacy agent identity; RLS assumes User but business model indicates Employee | UNKNOWN | employee_id | deterministic audit/backfill required |
| BonusEntry.agent_name | display snapshot | TEXT_NAME | keep as snapshot | not authorization input |
| GoalDefinition.agent_id | legacy business agent identity | UNKNOWN | employee_id | validate producing UI/function before backfill |
| GoalDefinition.agent_name | display snapshot | TEXT_NAME | keep as snapshot | not authorization input |
| Invoices.reviewed_by | authenticated email or frontend-provided employee label | EMAIL / TEXT_NAME | reviewed_by_user_id + reviewed_by_employee_id | Actor Resolver pilot now logs canonical actor in AuditLog |
| LabCredit.taken_by | person name | TEXT_NAME | employee_id when employee; retain text for external person | no fuzzy matching |
| LabCredit.recorded_by | employee name | TEXT_NAME | recorded_by_employee_id | dual-write only |
| SerialAuditLog.user | name or identifier | UNKNOWN | actor fields through AuditLog | preserve operational log |
| PickingState.picked_by_user_id | field name says User; flow context must be verified | UNKNOWN | picked_by_employee_id and authenticated_user_id | do not migrate until producer audit |
| PickingState.picked_by_name | display snapshot | TEXT_NAME | keep as snapshot | not authorization input |

## Built-in identity fields

Every entity also has `created_by_id` (USER) and `created_by` (EMAIL). They are reliable for authenticated record ownership, but do not represent business responsibility.

## Hardcoded identity findings

- Ticket escalation locates a manager by exact employee name. Replace later with a business permission/assignment lookup.
- Multiple UI checks use Hebrew Employee role labels. Keep as business-role checks only; never place these labels in Base44 `user_condition.role`.
- Commission assignment selects a Linet display name as `agent_id`; this must not be interpreted as User or Employee ID.
- Attendance fields named `user_id` hold Employee IDs and must not be used in direct User-ID RLS rules.

## Migration rules

No legacy identity field is removed. Add canonical fields, dual-read/dual-write, backfill only deterministic matches, migrate consumers, then archive legacy fields in a separately approved phase.