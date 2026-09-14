# Permission Architecture

## Identity layers

1. Base44 User: login, session, authentication and system role (`admin` or `user`).
2. Employee: business person, department, role and operational ownership.
3. Employee.user_id: optional bridge. Neither side requires a matching record.

## Initial permission model

- Base44 `admin`: platform administration and emergency access.
- Base44 `user`: authenticated application user; business access is not inferred from this value.
- Employee business roles remain business data. Future normalized permissions may support OWNER, ADMIN, MANAGER, SALES, SERVICE, WAREHOUSE and EMPLOYEE without adding them as Base44 auth roles.
- Backend domain services resolve User to Employee, then evaluate the minimum business permission required for state-changing actions.
- RLS uses only Base44 authentication facts or stable User-owned fields. Employee-aware authorization that cannot be represented safely in RLS belongs in a backend domain service.

## Simple extensible layer

Phase 1 uses existing `Employee.role` and `Employee.department` through one resolver/service boundary. A future permission table may map business roles to named capabilities, but no complex role engine is introduced now.

Suggested capability names for later use: `orders.manage`, `tickets.manage`, `repairs.manage`, `attendance.approve`, `commissions.manage`, `goals.manage`, `warehouse.pick`, `shipments.create`.

## RLS rollout order

1. Secrets and integration configuration.
2. Authentication-related data.
3. Employee, HR, payroll and attendance.
4. Finance and payments.
5. Customer PII.
6. Operational records.
7. Reference data.

Each batch requires dependency analysis, policy snapshot, apply, admin/user access checks, dependent-function validation, AuditLog entry and explicit rollback before the next batch.