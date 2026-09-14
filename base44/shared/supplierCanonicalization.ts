/**
 * Supplier canonicalization helpers — additive only.
 *
 * Hard rules:
 *  - Suppliers is the canonical storage. Nothing here renames, deletes or hard-merges a supplier.
 *  - Canonical identity is the internal Base44 Suppliers.id. External ids belong in IntegrationReference.
 *  - A RepairVendor → Supplier link is auto-writable ONLY at confidence "certain"
 *    (exact valid VAT identity). Name-only evidence is reported, never applied.
 *  - Every derived record carries a deterministic *_key so re-running creates 0 duplicates.
 */

export const SUPPLIER_CANONICALIZATION_VERSION = 'supplier-canonicalization-1.0.0';

export const SUPPLIER_ROLES = [
  'PURCHASE_SUPPLIER',
  'IMPORTER',
  'DISTRIBUTOR',
  'WARRANTY_PROVIDER',
  'REPAIR_LAB',
  'RMA_DESTINATION'
];

/** Deterministic name normalization for EXACT comparison only (mirrors supplierResolver). */
export function normalizeName(raw) {
  return String(raw ?? '')
    .replace(/["'״׳`]/g, '')
    .replace(/[.,\-_()]/g, ' ')
    .replace(/\bבע\s*מ\b/g, '')
    .replace(/\b(ltd|limited|llc|inc|co)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeVat(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 9) return digits.padStart(9, '0');
  return digits.length > 9 ? digits : '';
}

export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

export function parseLegacyAliases(aliases) {
  return String(aliases ?? '')
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter((part) => part && !['null', 'n/a', '-', 'לא ידוע'].includes(part.toLowerCase()));
}

export function roleKey(supplierId, role) {
  return `${supplierId}:${role}`;
}

export function aliasKey(supplierId, aliasNormalized) {
  return `${supplierId}:${aliasNormalized}`;
}

export function relationshipKey(supplierId, role, productId, productSku) {
  const productPart = productId ? `pid:${productId}` : `sku:${normalizeName(productSku)}`;
  return `${supplierId}:${role}:${productPart}`;
}

/**
 * Scores one RepairVendor against the supplier list. Returns ranked candidates with explicit
 * evidence. "certain" requires a valid shared VAT identifier; a name/phone agreement is at
 * most "strong" and must stop for human approval.
 */
export function matchRepairVendorToSuppliers(vendor, suppliers) {
  const vendorName = normalizeName(vendor?.name);
  const vendorPhones = [vendor?.mobile, ...(Array.isArray(vendor?.additional_phones) ? vendor.additional_phones : [])]
    .map(normalizePhone)
    .filter(Boolean);
  const vendorVat = normalizeVat(vendor?.vat_id);

  const candidates = [];
  for (const supplier of suppliers) {
    const evidence = [];
    const supplierVat = normalizeVat(supplier.vat_id);
    if (vendorVat && supplierVat && vendorVat === supplierVat) evidence.push('exact_vat_id');

    if (vendorName && normalizeName(supplier.name) === vendorName) evidence.push('exact_normalized_name');

    const aliasHit = parseLegacyAliases(supplier.aliases).some((alias) => normalizeName(alias) === vendorName);
    if (vendorName && aliasHit) evidence.push('verified_alias');

    const contactBlob = normalizePhone(supplier.phone) || '';
    if (contactBlob && vendorPhones.includes(contactBlob)) evidence.push('exact_phone');

    if (!evidence.length) continue;

    const certain = evidence.includes('exact_vat_id');
    const strong = evidence.includes('exact_normalized_name') || evidence.includes('verified_alias') || evidence.includes('exact_phone');
    candidates.push({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      supplier_is_active: supplier.is_active !== false,
      canonical_supplier_id: supplier.canonical_supplier_id || null,
      evidence,
      confidence: certain ? 'certain' : strong ? 'strong' : 'weak',
      method: certain ? 'vat_id' : evidence.includes('verified_alias') ? 'verified_alias' : evidence.includes('exact_normalized_name') ? 'exact_normalized_name' : 'unresolved'
    });
  }

  const order = { certain: 0, strong: 1, weak: 2 };
  candidates.sort((a, b) => order[a.confidence] - order[b.confidence]);

  const certainHits = candidates.filter((c) => c.confidence === 'certain');
  const autoMergeable = certainHits.length === 1;
  return {
    vendor_id: vendor?.id ?? null,
    vendor_name: vendor?.name ?? null,
    candidates,
    auto_mergeable: autoMergeable,
    recommended_action: autoMergeable
      ? 'AUTO_LINK_CERTAIN'
      : candidates.length
        ? 'MANUAL_REVIEW_REQUIRED'
        : 'NO_CANDIDATE_CREATE_OR_MAP_MANUALLY',
    blocking_reason: autoMergeable
      ? null
      : certainHits.length > 1
        ? 'MULTIPLE_CERTAIN_CANDIDATES'
        : candidates.length
          ? 'NAME_OR_CONTACT_EVIDENCE_ONLY'
          : 'NO_EVIDENCE'
  };
}

/**
 * Deduplication report over the supplier list. Priority: exact VAT > exact Linet account id >
 * exact normalized contact > normalized name (never mergeable on its own).
 */
export function buildDeduplicationReport(suppliers) {
  const groups = [];
  const push = (matchType, mergeable, key, rows) => {
    if (rows.length < 2) return;
    const canonicalTargets = [...new Set(rows.map((s) => s.canonical_supplier_id || s.id))];
    groups.push({
      match_type: matchType,
      match_key_shape: key,
      auto_mergeable: mergeable && canonicalTargets.length === 1,
      already_canonicalized: canonicalTargets.length === 1 && rows.some((s) => s.canonical_supplier_id),
      members: rows.map((s) => ({
        id: s.id,
        name: s.name,
        vat_id: s.vat_id || null,
        is_active: s.is_active !== false,
        canonical_supplier_id: s.canonical_supplier_id || null
      }))
    });
  };

  const byVat = new Map();
  const byLinet = new Map();
  const byName = new Map();
  for (const s of suppliers) {
    const vat = normalizeVat(s.vat_id);
    if (vat) byVat.set(vat, [...(byVat.get(vat) || []), s]);
    const linet = String(s.linet_supplier_account_id || '').trim();
    if (linet) byLinet.set(linet, [...(byLinet.get(linet) || []), s]);
    const name = normalizeName(s.name);
    if (name) byName.set(name, [...(byName.get(name) || []), s]);
  }

  for (const [vat, rows] of byVat) push('exact_vat_id', true, `vat:${vat.length}digits`, rows);
  for (const [linet, rows] of byLinet) push('exact_linet_account_id', true, `linet:${linet.length}chars`, rows);
  for (const [name, rows] of byName) {
    const vats = new Set(rows.map((s) => normalizeVat(s.vat_id)).filter(Boolean));
    if (vats.size > 1) {
      push('same_name_conflicting_vat', false, `name:${name}`, rows);
    } else {
      push('normalized_name_only', false, `name:${name}`, rows);
    }
  }

  return {
    supplier_count: suppliers.length,
    group_count: groups.length,
    auto_mergeable_groups: groups.filter((g) => g.auto_mergeable && !g.already_canonicalized).length,
    manual_groups: groups.filter((g) => !g.auto_mergeable).length,
    groups
  };
}