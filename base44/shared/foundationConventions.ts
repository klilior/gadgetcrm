export const IDENTITY_CONVENTION = Object.freeze({
  canonicalId: "Use the Base44 record id as the internal canonical identity.",
  externalIds: "Store external identities in IntegrationReference; legacy fields remain during dual storage.",
});

export const RELATIONSHIP_FIELDS = Object.freeze({
  Customer: "customer_id",
  Employee: "employee_id",
  Supplier: "supplier_id",
  Product: "product_id",
  Order: "order_id",
  User: "user_id",
});

export const AUDIT_SOURCES = Object.freeze([
  "USER", "AUTOMATION", "API", "INTEGRATION", "MIGRATION", "SYSTEM",
]);

export const LOG_BOUNDARIES = Object.freeze({
  businessEvent: "A customer-facing or domain event, intended for the business timeline.",
  auditEvent: "A meaningful or sensitive state change and its actor.",
  technicalLog: "Operational diagnostics such as timeouts, webhooks, sync failures and HTTP errors.",
});

export const SUPPLIER_ROLES = Object.freeze([
  "PURCHASE_SUPPLIER",
  "IMPORTER",
  "DISTRIBUTOR",
  "WARRANTY_PROVIDER",
  "REPAIR_LAB",
  "RMA_DESTINATION",
]);