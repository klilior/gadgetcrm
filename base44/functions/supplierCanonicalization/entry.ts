import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import {
  SUPPLIER_CANONICALIZATION_VERSION,
  aliasKey,
  buildDeduplicationReport,
  matchRepairVendorToSuppliers,
  normalizeName,
  parseLegacyAliases,
  relationshipKey,
  roleKey
} from '../../shared/supplierCanonicalization.ts';

const MIGRATION_TYPE = 'SUPPLIER_CANONICALIZATION_POC';

function newCorrelationId() {
  return `supplier_canonicalization_${crypto.randomUUID()}`;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized - login required' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden - admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || 'DRY_RUN').toUpperCase();
    if (!['DRY_RUN', 'EXECUTE', 'VERIFY'].includes(mode)) {
      return Response.json({ error: 'mode must be DRY_RUN, EXECUTE or VERIFY' }, { status: 400 });
    }
    // POC guard: a deliberately small cap. Mass migration requires an explicit larger limit AND owner approval.
    const pocLimit = Math.min(Number(body.poc_limit) || 5, 25);
    const sr = base44.asServiceRole.entities;

    const suppliers = await sr.Suppliers.list('-created_date', 1000);
    const vendors = await sr.RepairVendor.list('-created_date', 200);
    const repairs = await sr.Repair.list('-created_date', 1000);
    const prices = await sr.SupplierProductPrice.list('-created_date', 1000);
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    const dedupe = buildDeduplicationReport(suppliers);
    const vendorReports = vendors.map((vendor) => {
      const match = matchRepairVendorToSuppliers(vendor, suppliers);
      return {
        ...match,
        vendor_active: vendor.active !== false,
        already_linked_supplier_id: vendor.canonical_supplier_id || null,
        affected_repairs: repairs.filter((r) => r.vendor_id === vendor.id).length
      };
    });

    // ── VERIFY: read-only integrity checks over canonical + legacy references ──
    if (mode === 'VERIFY') {
      const roles = await sr.SupplierRole.list('-created_date', 1000).catch(() => []);
      const aliases = await sr.SupplierAlias.list('-created_date', 1000).catch(() => []);
      const relationships = await sr.ProductSupplierRelationship.list('-created_date', 1000).catch(() => []);
      const invoices = await sr.Invoices.list('-created_date', 1000);
      const lines = await sr.InvoiceLine.list('-created_date', 1000);

      const dangling = {
        supplier_roles: roles.filter((r) => !supplierById.has(r.supplier_id)).length,
        supplier_aliases: aliases.filter((a) => !supplierById.has(a.supplier_id)).length,
        product_relationships: relationships.filter((r) => !supplierById.has(r.supplier_id)).length,
        invoices: invoices.filter((i) => i.supplier && !supplierById.has(i.supplier)).length,
        invoice_lines: lines.filter((l) => l.supplier_id && !supplierById.has(l.supplier_id)).length,
        prices: prices.filter((p) => !supplierById.has(p.supplier_id)).length,
        repairs_canonical: repairs.filter((r) => r.repair_supplier_id && !supplierById.has(r.repair_supplier_id)).length,
        vendors_canonical: vendors.filter((v) => v.canonical_supplier_id && !supplierById.has(v.canonical_supplier_id)).length
      };
      const duplicateKeys = {
        supplier_roles: roles.length - new Set(roles.map((r) => r.role_key)).size,
        supplier_aliases: aliases.length - new Set(aliases.map((a) => a.alias_key)).size,
        product_relationships: relationships.length - new Set(relationships.map((r) => r.relationship_key)).size
      };
      return Response.json({
        success: true,
        mode,
        version: SUPPLIER_CANONICALIZATION_VERSION,
        canonical_counts: {
          suppliers: suppliers.length,
          supplier_roles: roles.length,
          supplier_aliases: aliases.length,
          product_relationships: relationships.length
        },
        legacy_counts: {
          repair_vendors: vendors.length,
          repairs_with_vendor_id: repairs.filter((r) => r.vendor_id).length,
          repairs_with_canonical_supplier: repairs.filter((r) => r.repair_supplier_id).length,
          prices_with_product_id: prices.filter((p) => p.product_id).length
        },
        dangling_references: dangling,
        duplicate_keys: duplicateKeys,
        healthy: Object.values(dangling).every((v) => v === 0) && Object.values(duplicateKeys).every((v) => v === 0)
      });
    }

    // ── Plan the POC work set (identical logic for DRY_RUN and EXECUTE) ──
    const plannedRoles = [];
    const plannedAliases = [];
    const plannedRelationships = [];
    const plannedVendorLinks = [];
    const skipped = [];

    const purchaseSupplierIds = new Set();
    for (const price of prices) {
      if (supplierById.has(price.supplier_id)) purchaseSupplierIds.add(price.supplier_id);
    }
    for (const supplierId of [...purchaseSupplierIds].slice(0, pocLimit)) {
      const supplier = supplierById.get(supplierId);
      if (supplier.canonical_supplier_id) {
        skipped.push({ type: 'role', supplier_id: supplierId, reason: 'SUPPLIER_IS_DUPLICATE_POINTER' });
        continue;
      }
      plannedRoles.push({
        supplier_id: supplierId,
        role: 'PURCHASE_SUPPLIER',
        role_key: roleKey(supplierId, 'PURCHASE_SUPPLIER'),
        evidence: 'supplier_product_price_history',
        confidence: 'strong'
      });
      for (const alias of parseLegacyAliases(supplier.aliases).slice(0, 10)) {
        const normalized = normalizeName(alias);
        if (!normalized) continue;
        plannedAliases.push({
          supplier_id: supplierId,
          alias_value: alias,
          alias_normalized: normalized,
          alias_key: aliasKey(supplierId, normalized),
          alias_type: 'NAME_VARIANT',
          source_system: 'LEGACY_ALIAS_FIELD'
        });
      }
    }

    // ProductSupplierRelationship POC — SKU only, product_id stays empty (no product guessing).
    for (const price of prices.filter((p) => supplierById.has(p.supplier_id) && p.sku).slice(0, pocLimit)) {
      plannedRelationships.push({
        supplier_id: price.supplier_id,
        product_id: null,
        product_sku: price.sku,
        product_name_snapshot: price.product_name || '',
        role: 'PURCHASE_SUPPLIER',
        relationship_key: relationshipKey(price.supplier_id, 'PURCHASE_SUPPLIER', null, price.sku),
        product_match_method: 'sku_only',
        priority: 100,
        is_primary: false
      });
    }

    for (const report of vendorReports) {
      if (report.already_linked_supplier_id) {
        skipped.push({ type: 'vendor_link', vendor_id: report.vendor_id, reason: 'ALREADY_LINKED' });
        continue;
      }
      if (report.auto_mergeable) {
        plannedVendorLinks.push({
          vendor_id: report.vendor_id,
          supplier_id: report.candidates[0].supplier_id,
          method: report.candidates[0].method,
          confidence: 'certain'
        });
      } else {
        skipped.push({ type: 'vendor_link', vendor_id: report.vendor_id, reason: report.blocking_reason });
      }
    }

    const plan = {
      roles: plannedRoles.length,
      aliases: plannedAliases.length,
      product_relationships: plannedRelationships.length,
      vendor_links: plannedVendorLinks.length,
      skipped: skipped.length
    };

    if (mode === 'DRY_RUN') {
      return Response.json({
        success: true,
        mode,
        version: SUPPLIER_CANONICALIZATION_VERSION,
        poc_limit: pocLimit,
        plan,
        planned: {
          roles: plannedRoles,
          aliases: plannedAliases.slice(0, 20),
          product_relationships: plannedRelationships,
          vendor_links: plannedVendorLinks
        },
        skipped,
        deduplication_report: dedupe,
        repair_vendor_reports: vendorReports
      });
    }

    // ── EXECUTE under a MigrationRun ──
    const correlationId = newCorrelationId();
    const startedAt = new Date().toISOString();
    const run = await sr.MigrationRun.create({
      migration_type: MIGRATION_TYPE,
      started_at: startedAt,
      status: 'RUNNING',
      executed_by_user_id: user.id,
      dry_run: false,
      correlation_id: correlationId,
      records_scanned: suppliers.length + vendors.length + prices.length,
      metadata: { version: SUPPLIER_CANONICALIZATION_VERSION, poc_limit: pocLimit, plan }
    });

    const created = { roles: 0, aliases: 0, product_relationships: 0, vendor_links: 0 };
    const idempotentSkips = { roles: 0, aliases: 0, product_relationships: 0 };
    const failures = [];

    const upsert = async (entityName, keyField, keyValue, payload, bucket) => {
      const existing = await sr[entityName].filter({ [keyField]: keyValue }, null, 1);
      if (existing.length > 0) {
        idempotentSkips[bucket] += 1;
        return;
      }
      await sr[entityName].create({ ...payload, correlation_id: correlationId, migration_run_id: run.id, source: 'MIGRATION' });
      created[bucket] += 1;
    };

    for (const role of plannedRoles) {
      try {
        await upsert('SupplierRole', 'role_key', role.role_key, { ...role, is_active: true, valid_from: startedAt }, 'roles');
      } catch (error) {
        failures.push({ type: 'role', key: role.role_key, error: error.message });
      }
    }
    for (const alias of plannedAliases) {
      try {
        await upsert('SupplierAlias', 'alias_key', alias.alias_key, { ...alias, is_active: true }, 'aliases');
      } catch (error) {
        failures.push({ type: 'alias', key: alias.alias_key, error: error.message });
      }
    }
    for (const rel of plannedRelationships) {
      try {
        await upsert('ProductSupplierRelationship', 'relationship_key', rel.relationship_key, { ...rel, valid_from: startedAt }, 'product_relationships');
      } catch (error) {
        failures.push({ type: 'product_relationship', key: rel.relationship_key, error: error.message });
      }
    }
    for (const link of plannedVendorLinks) {
      try {
        const vendor = vendors.find((v) => v.id === link.vendor_id);
        if (vendor?.canonical_supplier_id) continue;
        await sr.RepairVendor.update(link.vendor_id, {
          canonical_supplier_id: link.supplier_id,
          canonical_link_method: link.method,
          canonical_link_confidence: 'certain',
          canonical_linked_at: startedAt
        });
        created.vendor_links += 1;
        await sr.AuditLog.create({
          actor_user_id: user.id,
          entity_type: 'RepairVendor',
          entity_id: link.vendor_id,
          action: 'SUPPLIER_CANONICAL_LINK',
          before_data: { canonical_supplier_id: null },
          after_data: { canonical_supplier_id: link.supplier_id },
          field_changes: { canonical_supplier_id: { before: null, after: link.supplier_id } },
          source: 'MIGRATION',
          correlation_id: correlationId,
          request_context: { migration_run_id: run.id, match_method: link.method, confidence: 'certain' }
        });
      } catch (error) {
        failures.push({ type: 'vendor_link', key: link.vendor_id, error: error.message });
      }
    }

    const totalCreated = created.roles + created.aliases + created.product_relationships + created.vendor_links;
    const totalSkipped = idempotentSkips.roles + idempotentSkips.aliases + idempotentSkips.product_relationships + skipped.length;

    await sr.AuditLog.create({
      actor_user_id: user.id,
      entity_type: 'Suppliers',
      entity_id: 'supplier-canonicalization-poc',
      action: 'MIGRATION_EXECUTE',
      before_data: {},
      after_data: { created, idempotent_skips: idempotentSkips },
      field_changes: {},
      source: 'MIGRATION',
      correlation_id: correlationId,
      request_context: {
        migration_run_id: run.id,
        version: SUPPLIER_CANONICALIZATION_VERSION,
        poc_limit: pocLimit,
        ambiguous_supplier_groups: dedupe.manual_groups,
        blocked_vendor_links: skipped.filter((s) => s.type === 'vendor_link').length
      }
    });

    await sr.MigrationRun.update(run.id, {
      status: failures.length ? 'PARTIAL' : 'COMPLETED',
      completed_at: new Date().toISOString(),
      records_changed: totalCreated,
      records_skipped: totalSkipped,
      records_failed: failures.length,
      rollback_available: true,
      summary: `POC: ${created.roles} roles, ${created.aliases} aliases, ${created.product_relationships} product links, ${created.vendor_links} vendor links. Skipped ${totalSkipped}, failed ${failures.length}.`
    });

    return Response.json({
      success: true,
      mode,
      version: SUPPLIER_CANONICALIZATION_VERSION,
      migration_run_id: run.id,
      correlation_id: correlationId,
      created,
      idempotent_skips: idempotentSkips,
      skipped,
      failures,
      deduplication_report: { auto_mergeable_groups: dedupe.auto_mergeable_groups, manual_groups: dedupe.manual_groups },
      repair_vendor_reports: vendorReports
    });
  } catch (error) {
    console.error('supplierCanonicalization failed:', error?.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}