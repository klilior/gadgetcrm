# GADGET TEAM Foundation Architecture

## Identity

Every business record uses its Base44 record `id` as its internal canonical identity. IDs from WooCommerce, Linet, Mirakl, TextMe, shipping providers and future systems are external identities and must be stored through `IntegrationReference`. Existing external-ID fields remain supported during the dual-storage transition.

Base44 built-ins `id`, `created_date` and `updated_date` provide the requested identity and timestamps and are not redeclared in schemas.

## Relationship naming for new development

Use only `customer_id`, `employee_id`, `supplier_id`, `product_id`, `order_id` and `user_id` for these concepts. Do not introduce new agent/rep/client/camel-case variants. Legacy fields remain until separately approved migrations.

## Log boundaries

- Business Event: customer/domain timeline event such as CALL_RECEIVED or SHIPMENT_CREATED. Future home: CustomerEvent.
- Audit Event: meaningful or sensitive state change with actor, before/after and correlation ID. Home: AuditLog.
- Technical Log: API timeouts, webhook payloads, sync failures and HTTP errors. Existing technical logs remain separate.

## Correlation

One business flow carries one `correlation_id` through AuditLog and technical/integration logs. New backend entry points should accept `x-correlation-id` or a payload correlation ID and generate one when absent.

## Supplier relationship design (design only)

`Suppliers` remains the current canonical supplier storage. Future roles: PURCHASE_SUPPLIER, IMPORTER, DISTRIBUTOR, WARRANTY_PROVIDER, REPAIR_LAB and RMA_DESTINATION.

A future `ProductSupplierRelationship` should contain `product_id`, `supplier_id`, `role`, `valid_from`, `valid_to` and compact `metadata`. No RepairVendor or Supplier migration is included in this foundation phase.

## Diagrams

```text
User ── optional 1:1 ──> Employee

Business Entity ── 1:N ──> IntegrationReference ──> External System Identity

User + Employee ──> AuditLog ──> Business Entity

Business Flow ──> correlation_id ──> AuditLog
                              └──> Sync/Webhook/Integration technical logs
``