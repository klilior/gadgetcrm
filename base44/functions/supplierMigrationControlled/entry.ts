import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import {
  aliasKey,
  normalizeName,
  parseLegacyAliases
} from '../../shared/supplierCanonicalization.ts';

/**
 * Controlled Supplier Migration — batch executor.
 *
 * Approved scope ONLY. Each batch runs under its own MigrationRun, is idempotent,
 * and self-verifies. Explicitly out of scope: product canonicalization, supplier merges,
 * hard deletes, VAT edits, Suppliers.linet_supplier_account_id writes, auth/secrets.
 */

const MIGRATION_VERSION = 'controlled-supplier-migration-1.0.0';

// ── Human-approved decisions (owner approval on record) ─────────────────────
const STS_SUPPLIER_ID = '696f8b608af51a27cabb505e';
const STS_VENDOR_ID = '68b6f37a7e3f71320039ee67';
const OFER_SUPPLIER_ID = '69569fd8dbd7c141beb284f9';
const OFER_VENDOR_ID = '68e229b0002ccb4cabdd27f5';

const VENDOR_LINKS = [
  {
    vendor_id: STS_VENDOR_ID,
    supplier_id: STS_SUPPLIER_ID,
    evidence_summary:
      'VAT 516542024 on canonical supplier; 294 LinetPurchaseDocument rows under account 139; supplier aliases STS megagroup/MEGA GROUP; SupplierPattern sts.megagroup (100); 31 repairs of type importer lab. Owner-approved 2026-09-15.'
  },
  {
    vendor_id: OFER_VENDOR_ID,
    supplier_id: OFER_SUPPLIER_ID,
    evidence_summary:
      'Supplier VAT 056773443 with 149 invoices and 257 invoice lines; Linet account 153 same VAT and same name; 10 repairs of type importer lab. Owner-approved 2026-09-15.'
  }
];

const REPAIR_ROLE_BY_SUPPLIER = {
  [STS_SUPPLIER_ID]: 'IMPORTER',
  [OFER_SUPPLIER_ID]: 'REPAIR_LAB'
};

const STS_PRICE_REPOINTS = [
  '696f8a2b6ff90d1a4499f4d2',
  '6970f9b641fbade5af89d8e0',
  '6970f9b7a8e80d93d8626875',
  '6970f9b84d9fa9278fa34228'
];

const SHIPPING_PRICE_ROWS = [
  { id: '6981a20daa94783701d8c95e', reason: 'Local delivery freight line from O.P.S.I. invoice 7123898 — shipping cost, not a product price' },
  { id: '6981a20e4b63d8f30062e03c', reason: 'Fuel surcharge line from O.P.S.I. invoice 7123898 — shipping cost, not a product price' },
  { id: '6981a20fb3b3295a1ed3f13b', reason: 'Address delivery line from O.P.S.I. invoice 7123898 — shipping cost, not a product price' }
];

const APPROVED_ROLES = [
  { supplier_id: STS_SUPPLIER_ID, role: 'IMPORTER', evidence: 'repair_vendor_importer_lab_31_repairs + linet_purchase_account_139_294_docs', confidence: 'certain' },
  { supplier_id: STS_SUPPLIER_ID, role: 'REPAIR_LAB', evidence: 'repair_type_importer_lab_on_all_31_linked_repairs', confidence: 'certain' },
  { supplier_id: OFER_SUPPLIER_ID, role: 'REPAIR_LAB', evidence: 'repair_type_importer_lab_on_all_10_linked_repairs', confidence: 'certain' }
];

const DATA_QUALITY_BACKLOG = [
  { entity_id: '6a29dfed3fa11ccaa839e15c', title: 'חברת החשמל לישראל — suspected VAT extraction error 558418570 (real IEC VAT is 520000472). Verify the single source invoice document. No merge, no automatic VAT change.' },
  { entity_id: '69cb727d20d62a8603be2d82', title: 'זאפ גרופ — suspected VAT extraction error 557793965 (established record uses 510503675). Verify the single source invoice document. No merge, no automatic VAT change.' }
];

const UNKNOWN_SUPPLIER_NAME = 'לא ידוע';

function nvat(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 9 ? d.padStart(9, '0') : '';
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized - login required' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden - admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const batch = String(body.batch || '').toUpperCase();
    const valid = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'DQ', 'VERIFY'];
    if (!valid.includes(batch)) {
      return Response.json({ error: `batch must be one of ${valid.join(', ')}` }, { status: 400 });
    }

    const sr = base44.asServiceRole.entities;
    const now = new Date().toISOString();
    const correlationId = `supplier_migration_${batch}_${crypto.randomUUID()}`;

    const suppliers = await sr.Suppliers.list('-created_date', 1000);
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    // ── VERIFY: invariants only, zero writes ──
    if (batch === 'VERIFY') {
      const [vendors, repairs, prices, refs, roles, aliases, rels, invoices, lines] = await Promise.all([
        sr.RepairVendor.list('-created_date', 200),
        sr.Repair.list('-created_date', 2000),
        sr.SupplierProductPrice.list('-created_date', 2000),
        sr.IntegrationReference.filter({ integration: 'LINET', external_entity_type: 'SUPPLIER' }, '-created_date', 500),
        sr.SupplierRole.list('-created_date', 500),
        sr.SupplierAlias.list('-created_date', 500),
        sr.ProductSupplierRelationship.list('-created_date', 500),
        sr.Invoices.list('-created_date', 2000),
        sr.InvoiceLine.list('-created_date', 2000)
      ]);
      const productPrices = prices.filter((p) => (p.pricing_record_type || 'PRODUCT') === 'PRODUCT');
      const linkedVendorIds = VENDOR_LINKS.map((v) => v.vendor_id);
      const expectedRepairs = repairs.filter((r) => linkedVendorIds.includes(r.vendor_id));
      const unknowns = suppliers.filter((s) => String(s.name || '').trim() === UNKNOWN_SUPPLIER_NAME);

      const invariants = {
        dangling_product_prices: productPrices.filter((p) => !supplierById.has(p.supplier_id)).length,
        repairs_expected: expectedRepairs.length,
        repairs_with_canonical: expectedRepairs.filter((r) => r.repair_supplier_id).length,
        repair_vendors_linked: vendors.filter((v) => v.canonical_supplier_id).length,
        repair_vendors_total: vendors.length,
        linet_integration_references: refs.length,
        duplicate_integration_keys: refs.length - new Set(refs.map((r) => r.external_key)).size,
        duplicate_alias_keys: aliases.length - new Set(aliases.map((a) => a.alias_key)).size,
        duplicate_role_keys: roles.length - new Set(roles.map((r) => r.role_key)).size,
        unknown_suppliers_archived: unknowns.filter((s) => s.is_active === false).length,
        supplier_merge_pointers: suppliers.filter((s) => s.canonical_supplier_id).length,
        product_relationships: rels.length,
        relationships_with_product_id: rels.filter((r) => r.product_id).length,
        invoices_with_supplier: invoices.filter((i) => i.supplier).length,
        invoice_lines_with_supplier: lines.filter((l) => l.supplier_id).length,
        dangling_invoice_refs: invoices.filter((i) => i.supplier && !supplierById.has(i.supplier)).length,
        dangling_invoice_line_refs: lines.filter((l) => l.supplier_id && !supplierById.has(l.supplier_id)).length,
        shipping_classified_rows: prices.filter((p) => p.pricing_record_type === 'SHIPPING').length,
        dangling_supplier_roles: roles.filter((r) => !supplierById.has(r.supplier_id)).length,
        dangling_supplier_aliases: aliases.filter((a) => !supplierById.has(a.supplier_id)).length,
        aliases_without_confidence: aliases.filter((a) => !a.confidence).length
      };
      invariants.healthy =
        invariants.dangling_product_prices === 0 &&
        invariants.repairs_with_canonical === invariants.repairs_expected &&
        invariants.repair_vendors_linked === invariants.repair_vendors_total &&
        invariants.duplicate_integration_keys === 0 &&
        invariants.duplicate_alias_keys === 0 &&
        invariants.duplicate_role_keys === 0 &&
        invariants.dangling_invoice_refs === 0 &&
        invariants.dangling_invoice_line_refs === 0 &&
        invariants.relationships_with_product_id === 0;
      return Response.json({ success: true, batch, version: MIGRATION_VERSION, invariants });
    }

    // ── Batched execution ──
    const run = await sr.MigrationRun.create({
      migration_type: `SUPPLIER_MIGRATION_BATCH_${batch}`,
      started_at: now,
      status: 'RUNNING',
      executed_by_user_id: user.id,
      dry_run: false,
      correlation_id: correlationId,
      metadata: { version: MIGRATION_VERSION, batch }
    });

    let scanned = 0;
    const changed = [];
    const skipped = [];
    const failures = [];

    const audit = (entityType, entityId, action, before, after, extra = {}) =>
      sr.AuditLog.create({
        actor_user_id: user.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        before_data: before,
        after_data: after,
        field_changes: Object.fromEntries(Object.keys(after || {}).map((k) => [k, { before: before?.[k] ?? null, after: after[k] }])),
        source: 'MIGRATION',
        correlation_id: correlationId,
        request_context: { migration_run_id: run.id, batch, version: MIGRATION_VERSION, ...extra }
      });

    try {
      if (batch === 'A') {
        for (const link of VENDOR_LINKS) {
          const vendor = await sr.RepairVendor.get(link.vendor_id).catch(() => null);
          scanned += 1;
          if (!vendor) { failures.push({ id: link.vendor_id, error: 'VENDOR_NOT_FOUND' }); continue; }
          if (vendor.canonical_supplier_id) { skipped.push({ id: vendor.id, reason: 'ALREADY_LINKED' }); continue; }
          if (!supplierById.has(link.supplier_id)) { failures.push({ id: vendor.id, error: 'TARGET_SUPPLIER_MISSING' }); continue; }
          const after = {
            canonical_supplier_id: link.supplier_id,
            canonical_link_method: 'MANUAL_VERIFIED',
            canonical_link_confidence: 'HIGH',
            canonical_link_evidence_summary: link.evidence_summary,
            canonical_link_approved_at: now,
            canonical_link_migration_run_id: run.id,
            canonical_link_correlation_id: correlationId,
            canonical_linked_at: now
          };
          await sr.RepairVendor.update(vendor.id, after);
          await audit('RepairVendor', vendor.id, 'SUPPLIER_CANONICAL_LINK', { canonical_supplier_id: vendor.canonical_supplier_id ?? null }, after);
          changed.push({ id: vendor.id, name: vendor.name, supplier_id: link.supplier_id });
        }
      }

      if (batch === 'B') {
        const repairs = await sr.Repair.list('-created_date', 2000);
        for (const link of VENDOR_LINKS) {
          const vendor = await sr.RepairVendor.get(link.vendor_id).catch(() => null);
          if (!vendor?.canonical_supplier_id) { skipped.push({ vendor_id: link.vendor_id, reason: 'BATCH_A_NOT_APPLIED' }); continue; }
          for (const repair of repairs.filter((r) => r.vendor_id === link.vendor_id)) {
            scanned += 1;
            if (repair.repair_supplier_id) { skipped.push({ id: repair.id, reason: 'ALREADY_CANONICAL' }); continue; }
            const after = {
              repair_supplier_id: vendor.canonical_supplier_id,
              repair_supplier_role: REPAIR_ROLE_BY_SUPPLIER[vendor.canonical_supplier_id] || 'REPAIR_LAB',
              repair_supplier_link_method: 'MANUAL_VERIFIED',
              repair_supplier_migration_run_id: run.id,
              repair_supplier_correlation_id: correlationId
            };
            try {
              await sr.Repair.update(repair.id, after);
              changed.push({ id: repair.id, vendor_id: repair.vendor_id, supplier_id: after.repair_supplier_id });
            } catch (error) {
              failures.push({ id: repair.id, error: error.message });
            }
          }
        }
        if (changed.length) {
          await audit('Repair', 'batch-b-repairs', 'CANONICAL_SUPPLIER_BACKFILL', { repair_supplier_id: null, count: changed.length }, { repair_supplier_id: 'canonical', count: changed.length }, { repair_ids_sample: changed.slice(0, 10).map((c) => c.id), vendor_id_preserved: true });
        }
      }

      if (batch === 'C') {
        for (const priceId of STS_PRICE_REPOINTS) {
          scanned += 1;
          const price = await sr.SupplierProductPrice.get(priceId).catch(() => null);
          if (!price) { failures.push({ id: priceId, error: 'PRICE_ROW_NOT_FOUND' }); continue; }
          if (price.supplier_id === STS_SUPPLIER_ID) { skipped.push({ id: priceId, reason: 'ALREADY_REPOINTED' }); continue; }
          const before = { supplier_id: price.supplier_id };
          await sr.SupplierProductPrice.update(priceId, { supplier_id: STS_SUPPLIER_ID });
          await audit('SupplierProductPrice', priceId, 'SUPPLIER_REPOINT', before, { supplier_id: STS_SUPPLIER_ID }, {
            sku: price.sku,
            source_invoice_id: price.last_invoice_id,
            resolution: 'source_invoice_supplier_exact',
            sku_price_and_source_unchanged: true
          });
          changed.push({ id: priceId, sku: price.sku, old_supplier_id: before.supplier_id });
        }
      }

      if (batch === 'D') {
        for (const row of SHIPPING_PRICE_ROWS) {
          scanned += 1;
          const price = await sr.SupplierProductPrice.get(row.id).catch(() => null);
          if (!price) { failures.push({ id: row.id, error: 'PRICE_ROW_NOT_FOUND' }); continue; }
          if (price.pricing_record_type === 'SHIPPING') { skipped.push({ id: row.id, reason: 'ALREADY_CLASSIFIED' }); continue; }
          const before = { pricing_record_type: price.pricing_record_type ?? null };
          const after = { pricing_record_type: 'SHIPPING', pricing_classification_reason: row.reason };
          await sr.SupplierProductPrice.update(row.id, after);
          await audit('SupplierProductPrice', row.id, 'PRICING_RECORD_TYPE_CLASSIFIED', before, after, { sku: price.sku, supplier_unchanged: true, history_preserved: true });
          changed.push({ id: row.id, sku: price.sku, pricing_record_type: 'SHIPPING' });
        }
      }

      if (batch === 'E') {
        const docs = await sr.LinetPurchaseDocument.list('-created_date', 2000);
        const canonicalOf = (s) => (s.canonical_supplier_id && supplierById.has(s.canonical_supplier_id) ? s.canonical_supplier_id : s.id);
        const byVat = new Map();
        for (const s of suppliers) {
          const v = nvat(s.vat_id);
          if (v) byVat.set(v, [...(byVat.get(v) || []), s]);
        }
        const accounts = new Map();
        for (const d of docs) {
          const acc = String(d.supplier_account_id || '').trim();
          if (!acc) continue;
          const cur = accounts.get(acc) || { vats: new Set(), names: new Set(), docs: 0 };
          const v = nvat(d.supplier_vat_id);
          if (v) cur.vats.add(v);
          if (d.supplier_name) cur.names.add(d.supplier_name);
          cur.docs += 1;
          accounts.set(acc, cur);
        }
        for (const [acc, info] of accounts) {
          scanned += 1;
          const vats = [...info.vats];
          if (vats.length !== 1) { skipped.push({ account_id: acc, reason: vats.length ? 'MULTIPLE_VATS' : 'NO_VAT' }); continue; }
          const hits = byVat.get(vats[0]) || [];
          const canonicalIds = [...new Set(hits.map(canonicalOf))];
          if (canonicalIds.length !== 1) { skipped.push({ account_id: acc, reason: hits.length ? 'VAT_NOT_UNIQUE' : 'NO_SUPPLIER_FOR_VAT' }); continue; }
          const externalKey = `LINET:SUPPLIER:${acc}`;
          const existing = await sr.IntegrationReference.filter({ external_key: externalKey }, null, 1);
          if (existing.length) { skipped.push({ account_id: acc, reason: 'REFERENCE_EXISTS' }); continue; }
          try {
            await sr.IntegrationReference.create({
              entity_type: 'SUPPLIER',
              entity_id: canonicalIds[0],
              integration: 'LINET',
              external_entity_type: 'SUPPLIER',
              external_id: acc,
              external_secondary_id: vats[0],
              external_key: externalKey,
              first_seen_at: now,
              last_seen_at: now,
              metadata: { vat_match: 'exact_unique', linet_names: [...info.names].slice(0, 2), doc_count: info.docs, migration_run_id: run.id, correlation_id: correlationId }
            });
            changed.push({ account_id: acc, supplier_id: canonicalIds[0], supplier_name: supplierById.get(canonicalIds[0])?.name, vat: vats[0] });
          } catch (error) {
            failures.push({ account_id: acc, error: error.message });
          }
        }
      }

      if (batch === 'F') {
        for (const supplier of suppliers) {
          for (const alias of parseLegacyAliases(supplier.aliases)) {
            const normalized = normalizeName(alias);
            if (!normalized) { skipped.push({ supplier_id: supplier.id, alias, reason: 'EMPTY_AFTER_NORMALIZATION' }); continue; }
            scanned += 1;
            const key = aliasKey(supplier.id, normalized);
            const existing = await sr.SupplierAlias.filter({ alias_key: key }, null, 1);
            if (existing.length) { skipped.push({ alias_key: key, reason: 'ALIAS_EXISTS' }); continue; }
            const isIdentifier = /^[A-Z]{2}[0-9]/i.test(alias) || /^IL[0-9]/i.test(alias);
            try {
              await sr.SupplierAlias.create({
                supplier_id: supplier.id,
                alias_value: alias,
                alias_normalized: normalized,
                alias_key: key,
                alias_type: isIdentifier ? 'EXTERNAL_IDENTIFIER' : 'NAME_VARIANT',
                confidence: 'certain',
                source_system: 'LEGACY_ALIAS_FIELD',
                is_active: true,
                source: 'MIGRATION',
                correlation_id: correlationId,
                migration_run_id: run.id
              });
              changed.push({ alias_key: key, supplier: supplier.name, alias });
            } catch (error) {
              failures.push({ alias_key: key, error: error.message });
            }
          }
        }
      }

      if (batch === 'G') {
        const [invoices, lines, prices, patterns, repairs, refs] = await Promise.all([
          sr.Invoices.list('-created_date', 2000),
          sr.InvoiceLine.list('-created_date', 2000),
          sr.SupplierProductPrice.list('-created_date', 2000),
          sr.SupplierPattern.list('-created_date', 1000),
          sr.Repair.list('-created_date', 2000),
          sr.IntegrationReference.filter({ entity_type: 'SUPPLIER' }, '-created_date', 500)
        ]);
        for (const supplier of suppliers.filter((s) => String(s.name || '').trim() === UNKNOWN_SUPPLIER_NAME)) {
          scanned += 1;
          const refCount = {
            invoices: invoices.filter((i) => i.supplier === supplier.id || i.detected_supplier_id === supplier.id).length,
            lines: lines.filter((l) => l.supplier_id === supplier.id).length,
            prices: prices.filter((p) => p.supplier_id === supplier.id).length,
            patterns: patterns.filter((p) => p.supplier_id === supplier.id).length,
            repairs: repairs.filter((r) => r.repair_supplier_id === supplier.id).length,
            external: refs.filter((r) => r.entity_id === supplier.id).length
          };
          const total = Object.values(refCount).reduce((a, b) => a + b, 0);
          if (total > 0) { skipped.push({ id: supplier.id, reason: 'HAS_REFERENCES', refs: refCount }); continue; }
          if (supplier.is_active === false) { skipped.push({ id: supplier.id, reason: 'ALREADY_ARCHIVED' }); continue; }
          await sr.Suppliers.update(supplier.id, { is_active: false });
          await audit('Suppliers', supplier.id, 'ARCHIVE_UNUSED', { is_active: supplier.is_active ?? true }, { is_active: false }, { reason: 'ARCHIVE_UNUSED', reference_counts: refCount, no_delete: true, no_merge: true });
          changed.push({ id: supplier.id, name: supplier.name });
        }
      }

      if (batch === 'H') {
        const prices = await sr.SupplierProductPrice.list('-created_date', 2000);
        const planned = [...APPROVED_ROLES];
        const purchaseEvidence = new Map();
        for (const p of prices) {
          if (!supplierById.has(p.supplier_id)) continue;
          if ((p.pricing_record_type || 'PRODUCT') !== 'PRODUCT') continue;
          if (!p.last_invoice_id) continue;
          const cur = purchaseEvidence.get(p.supplier_id) || { rows: 0, invoice: p.last_invoice_id };
          cur.rows += 1;
          purchaseEvidence.set(p.supplier_id, cur);
        }
        for (const [supplierId, ev] of purchaseEvidence) {
          const supplier = supplierById.get(supplierId);
          if (supplier.canonical_supplier_id) { skipped.push({ supplier_id: supplierId, reason: 'DUPLICATE_POINTER' }); continue; }
          planned.push({
            supplier_id: supplierId,
            role: 'PURCHASE_SUPPLIER',
            evidence: `supplier_product_price_history:${ev.rows}_rows:last_invoice_${ev.invoice}`,
            confidence: 'strong'
          });
        }
        for (const role of planned) {
          scanned += 1;
          if (!supplierById.has(role.supplier_id)) { failures.push({ supplier_id: role.supplier_id, error: 'SUPPLIER_MISSING' }); continue; }
          const key = `${role.supplier_id}:${role.role}`;
          const existing = await sr.SupplierRole.filter({ role_key: key }, null, 1);
          if (existing.length) { skipped.push({ role_key: key, reason: 'ROLE_EXISTS' }); continue; }
          try {
            await sr.SupplierRole.create({
              supplier_id: role.supplier_id,
              role: role.role,
              role_key: key,
              is_active: true,
              evidence: role.evidence,
              confidence: role.confidence,
              source: 'MIGRATION',
              valid_from: now,
              correlation_id: correlationId,
              migration_run_id: run.id
            });
            changed.push({ role_key: key, supplier: supplierById.get(role.supplier_id)?.name, role: role.role });
          } catch (error) {
            failures.push({ role_key: key, error: error.message });
          }
        }
      }

      // Batch I — repair dangling InvoiceLine.supplier_id using the parent invoice's own supplier.
      // Document evidence only: the line is repointed to the supplier already recorded on its invoice.
      if (batch === 'I') {
        const lines = await sr.InvoiceLine.list('-created_date', 3000);
        for (const line of lines.filter((l) => l.supplier_id && !supplierById.has(l.supplier_id))) {
          scanned += 1;
          if (!line.invoice_id) { skipped.push({ id: line.id, reason: 'NO_PARENT_INVOICE' }); continue; }
          const invoice = await sr.Invoices.get(line.invoice_id).catch(() => null);
          const target = invoice?.supplier;
          if (!target || !supplierById.has(target)) { skipped.push({ id: line.id, reason: 'PARENT_SUPPLIER_UNRESOLVED' }); continue; }
          const before = { supplier_id: line.supplier_id };
          try {
            await sr.InvoiceLine.update(line.id, { supplier_id: target });
            await audit('InvoiceLine', line.id, 'SUPPLIER_REPOINT', before, { supplier_id: target }, {
              invoice_id: line.invoice_id,
              resolution: 'parent_invoice_supplier_exact',
              amounts_and_sku_unchanged: true
            });
            changed.push({ id: line.id, invoice_id: line.invoice_id, old_supplier_id: before.supplier_id, supplier_id: target, supplier: supplierById.get(target)?.name });
          } catch (error) {
            failures.push({ id: line.id, error: error.message });
          }
        }
      }

      if (batch === 'DQ') {
        for (const item of DATA_QUALITY_BACKLOG) {
          scanned += 1;
          const existing = await sr.AuditLog.filter({ entity_id: item.entity_id, action: 'DATA_QUALITY_BACKLOG' }, null, 1);
          if (existing.length) { skipped.push({ entity_id: item.entity_id, reason: 'BACKLOG_ITEM_EXISTS' }); continue; }
          await audit('Suppliers', item.entity_id, 'DATA_QUALITY_BACKLOG', {}, { status: 'OPEN', title: item.title }, {
            required_action: 'verify source invoice document for the suspected VAT',
            no_merge: true,
            no_vat_change: true
          });
          changed.push({ entity_id: item.entity_id, title: item.title.slice(0, 60) });
        }
      }
    } catch (error) {
      failures.push({ id: 'batch', error: error.message });
    }

    const status = failures.length ? (changed.length ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
    await sr.MigrationRun.update(run.id, {
      status,
      completed_at: new Date().toISOString(),
      records_scanned: scanned,
      records_changed: changed.length,
      records_skipped: skipped.length,
      records_failed: failures.length,
      rollback_available: true,
      summary: `Batch ${batch}: changed ${changed.length}, skipped ${skipped.length}, failed ${failures.length}`
    });

    return Response.json({
      success: failures.length === 0,
      batch,
      version: MIGRATION_VERSION,
      migration_run_id: run.id,
      correlation_id: correlationId,
      status,
      affected_count: changed.length,
      scanned,
      changed,
      skipped,
      failures,
      stop_before_next_batch: failures.length > 0
    });
  } catch (error) {
    console.error('supplierMigrationControlled failed:', error?.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}