/**
 * Deterministic supplier resolver — the SINGLE place that turns invoice evidence into a
 * supplier identity. Used by runInvoiceExtraction, runInvoiceExtractionByInvoice and
 * (read-only) dryRunInvoiceExtraction.
 *
 * Hard rules:
 *  - It NEVER creates, renames or updates a Supplier. Resolution only.
 *  - Evidence order: exact normalized VAT/company id > Linet supplier id > trusted sender
 *    mapping > exact canonical alias > exact UNIQUE normalized name > AI-read name (weak).
 *  - Fuzzy "contains" matching is never a strong identity match.
 *  - Our own buyer VAT id can never be a supplier identity.
 *  - Every result follows canonical_supplier_id redirects (also for matches that came from
 *    an old SupplierPattern or from an inactive duplicate record).
 *  - Anything weak / ambiguous / unmatched is NOT eligible for auto-approval.
 */

export const SUPPLIER_RESOLVER_VERSION = 'supplier-resolver-1.0.0';

/** Our own company id — appears on invoices as the BUYER, never as the supplier. */
export const OUR_BUYER_VAT_ID = '040638660';

export const REASON_UNRESOLVED = 'SUPPLIER_UNRESOLVED';
export const REASON_AMBIGUOUS = 'SUPPLIER_AMBIGUOUS';
export const REASON_WEAK = 'SUPPLIER_WEAK_EVIDENCE';

const MAX_REDIRECT_HOPS = 5;

/** Deterministic VAT/company id normalization. Returns '' when unusable. */
export function normalizeVatId(raw: unknown): string {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 9) return digits.padStart(9, '0');
  if (digits.length > 9) return digits;
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** True when the id is our own buyer id and must be rejected as supplier identity. */
export function isOurBuyerVatId(raw: unknown): boolean {
  const normalized = normalizeVatId(raw);
  return !!normalized && normalized === normalizeVatId(OUR_BUYER_VAT_ID);
}

/** Deterministic supplier-name normalization for EXACT comparison only. */
export function normalizeSupplierName(raw: unknown): string {
  const value = raw === null || raw === undefined ? '' : String(raw);
  return value
    .replace(/["'״׳`]/g, '')
    .replace(/[.,\-_()]/g, ' ')
    .replace(/\bבע\s*מ\b/g, '')
    .replace(/\b(ltd|limited|llc|inc|co)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Legacy alias fields use both "|" and "," separators. Parse both. */
export function parseAliases(aliases: unknown): string[] {
  const value = aliases === null || aliases === undefined ? '' : String(aliases);
  return value
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Follows canonical_supplier_id, so duplicates always resolve to the canonical record. */
export function resolveCanonical(supplier: any, suppliers: any[]): { supplier: any; redirected: boolean; chain: string[] } {
  const chain: string[] = [];
  let current = supplier;
  let hops = 0;
  while (current?.canonical_supplier_id && hops < MAX_REDIRECT_HOPS) {
    const targetId = String(current.canonical_supplier_id);
    if (targetId === current.id) break;
    const target = suppliers.find((s: any) => s.id === targetId);
    if (!target) break;
    chain.push(`${current.id} → ${target.id}`);
    current = target;
    hops += 1;
  }
  return { supplier: current, redirected: chain.length > 0, chain };
}

function result(partial: any) {
  return {
    resolver_version: SUPPLIER_RESOLVER_VERSION,
    supplier: null,
    supplier_id: null,
    method: 'none',
    evidence_strength: 'none',
    reliable_for_auto_approval: false,
    reason_code: null,
    reason: '',
    candidate_ids: [],
    redirected_from: null,
    redirect_chain: [],
    ...partial
  };
}

function finish(matched: any, suppliers: any[], method: string, strength: 'strong' | 'weak', extra: any = {}) {
  const canonical = resolveCanonical(matched, suppliers);
  const strong = strength === 'strong';
  return result({
    supplier: canonical.supplier,
    supplier_id: canonical.supplier.id,
    method,
    evidence_strength: strength,
    reliable_for_auto_approval: strong,
    reason_code: strong ? null : REASON_WEAK,
    reason: strong
      ? `זוהה ספק לפי ${method}${canonical.redirected ? ' (הופנה לרשומה הקנונית)' : ''}.`
      : `זיהוי הספק מבוסס על שם בלבד (${method}) ולכן אינו מספיק לאישור אוטומטי.`,
    redirected_from: canonical.redirected ? matched.id : null,
    redirect_chain: canonical.chain,
    ...extra
  });
}

/**
 * @param evidence  { vat_id, linet_supplier_id, sender_domain, supplier_name, supplier_name_normalized }
 *                  Pass ONLY evidence the calling route actually has.
 * @param context   { suppliers, patterns, trusted_sender_map }
 */
export function resolveSupplier(evidence: any = {}, context: any = {}) {
  const suppliers: any[] = Array.isArray(context.suppliers) ? context.suppliers : [];
  const patterns: any[] = Array.isArray(context.patterns) ? context.patterns : [];
  const trustedSenderMap = context.trusted_sender_map || null;

  // ── a. exact normalized company / VAT id ────────────────────────────────
  const rawVat = evidence.vat_id;
  if (rawVat && isOurBuyerVatId(rawVat)) {
    // Our own buyer id was read off the document — it is not supplier identity.
    // Fall through to the remaining evidence instead of matching on it.
  } else if (rawVat) {
    const normalizedVat = normalizeVatId(rawVat);
    if (normalizedVat) {
      const byVat = suppliers.filter((s: any) => normalizeVatId(s.vat_id) === normalizedVat);
      const byAliasVat = suppliers.filter(
        (s: any) => !byVat.includes(s) && parseAliases(s.aliases).some((alias) => normalizeVatId(alias) === normalizedVat)
      );
      const hits = byVat.length ? byVat : byAliasVat;
      if (hits.length === 1) {
        return finish(hits[0], suppliers, byVat.length ? 'vat_id' : 'canonical_alias_vat', 'strong');
      }
      if (hits.length > 1) {
        // Duplicate VAT records: an explicit canonical target decides — never result order.
        const canonicalTargets = new Set(
          hits.map((s: any) => resolveCanonical(s, suppliers).supplier.id)
        );
        if (canonicalTargets.size === 1) {
          const target = resolveCanonical(hits[0], suppliers);
          return finish(target.supplier, suppliers, byVat.length ? 'vat_id' : 'canonical_alias_vat', 'strong', {
            candidate_ids: hits.map((s: any) => s.id),
            redirected_from: target.redirected ? hits[0].id : null,
            redirect_chain: target.chain
          });
        }
        return result({
          method: 'vat_id',
          evidence_strength: 'ambiguous',
          reason_code: REASON_AMBIGUOUS,
          reason: `נמצאו ${hits.length} רשומות ספק לאותו ח.פ/מזהה ללא רשומה קנונית מוגדרת.`,
          candidate_ids: hits.map((s: any) => s.id)
        });
      }
    }
  }

  // ── b. Linet supplier identifier ────────────────────────────────────────
  const linetId = evidence.linet_supplier_id ? String(evidence.linet_supplier_id).trim() : '';
  if (linetId) {
    const hits = suppliers.filter((s: any) => String(s.linet_supplier_account_id || '').trim() === linetId);
    if (hits.length === 1) return finish(hits[0], suppliers, 'linet_supplier_id', 'strong');
    if (hits.length > 1) {
      return result({
        method: 'linet_supplier_id',
        evidence_strength: 'ambiguous',
        reason_code: REASON_AMBIGUOUS,
        reason: `נמצאו ${hits.length} ספקים לאותו מזהה ספק בלינט.`,
        candidate_ids: hits.map((s: any) => s.id)
      });
    }
  }

  // ── c. trusted sender / domain mapping ──────────────────────────────────
  const senderDomain = evidence.sender_domain ? String(evidence.sender_domain).trim().toLowerCase() : '';
  if (senderDomain && trustedSenderMap) {
    const mappedId = trustedSenderMap[senderDomain];
    const mapped = mappedId ? suppliers.find((s: any) => s.id === mappedId) : null;
    if (mapped) return finish(mapped, suppliers, 'trusted_sender', 'strong');
  }
  if (senderDomain) {
    const hits = suppliers.filter((s: any) =>
      patterns.some(
        (p: any) =>
          p.supplier_id === s.id &&
          p.pattern_type === 'email_domain' &&
          p.is_active !== false &&
          String(p.pattern_value || '').trim().toLowerCase() === senderDomain
      )
    );
    if (hits.length === 1) return finish(hits[0], suppliers, 'trusted_sender', 'strong');
  }

  // ── d. exact canonical alias (name alias, exact after normalization) ─────
  const rawName = evidence.supplier_name ? String(evidence.supplier_name) : '';
  const normalizedName = normalizeSupplierName(evidence.supplier_name_normalized || rawName);
  if (normalizedName) {
    const aliasHits = suppliers.filter((s: any) =>
      parseAliases(s.aliases).some((alias) => normalizeSupplierName(alias) === normalizedName)
    );
    if (aliasHits.length === 1) return finish(aliasHits[0], suppliers, 'canonical_alias', 'strong');
    if (aliasHits.length > 1) {
      const canonicalTargets = new Set(aliasHits.map((s: any) => resolveCanonical(s, suppliers).supplier.id));
      if (canonicalTargets.size === 1) {
        const target = resolveCanonical(aliasHits[0], suppliers);
        return finish(target.supplier, suppliers, 'canonical_alias', 'strong', {
          candidate_ids: aliasHits.map((s: any) => s.id)
        });
      }
      return result({
        method: 'canonical_alias',
        evidence_strength: 'ambiguous',
        reason_code: REASON_AMBIGUOUS,
        reason: `הכינוי מופיע אצל ${aliasHits.length} ספקים שונים.`,
        candidate_ids: aliasHits.map((s: any) => s.id)
      });
    }

    // Learned exact name pattern (may point at an old/duplicate record → redirect applies).
    const patternHits = patterns.filter(
      (p: any) =>
        p.pattern_type === 'name_pattern' &&
        p.is_active !== false &&
        normalizeSupplierName(p.pattern_value) === normalizedName
    );
    const patternSuppliers = patternHits
      .map((p: any) => suppliers.find((s: any) => s.id === p.supplier_id))
      .filter(Boolean);
    const patternCanonical = new Set(patternSuppliers.map((s: any) => resolveCanonical(s, suppliers).supplier.id));
    if (patternSuppliers.length && patternCanonical.size === 1) {
      const target = resolveCanonical(patternSuppliers[0], suppliers);
      return finish(target.supplier, suppliers, 'learned_name_pattern', 'weak', {
        candidate_ids: patternSuppliers.map((s: any) => s.id)
      });
    }
    if (patternCanonical.size > 1) {
      return result({
        method: 'learned_name_pattern',
        evidence_strength: 'ambiguous',
        reason_code: REASON_AMBIGUOUS,
        reason: `תבניות השם מצביעות על ${patternCanonical.size} ספקים שונים.`,
        candidate_ids: patternSuppliers.map((s: any) => s.id)
      });
    }

    // ── e. exact UNIQUE normalized supplier name (no fuzzy contains) ────────
    const nameHits = suppliers.filter((s: any) => normalizeSupplierName(s.name) === normalizedName);
    const nameCanonical = new Set(nameHits.map((s: any) => resolveCanonical(s, suppliers).supplier.id));
    if (nameHits.length && nameCanonical.size === 1) {
      const target = resolveCanonical(nameHits[0], suppliers);
      return finish(target.supplier, suppliers, 'exact_name', 'weak', {
        candidate_ids: nameHits.map((s: any) => s.id)
      });
    }
    if (nameCanonical.size > 1) {
      return result({
        method: 'exact_name',
        evidence_strength: 'ambiguous',
        reason_code: REASON_AMBIGUOUS,
        reason: `שם הספק תואם ${nameCanonical.size} רשומות ספק שונות.`,
        candidate_ids: nameHits.map((s: any) => s.id)
      });
    }
  }

  // ── f. AI-read name only, nothing matched → unresolved. Never create. ────
  return result({
    reason_code: REASON_UNRESOLVED,
    reason: rawName
      ? `לא נמצאה רשומת ספק תואמת ל"${rawName.trim()}" לפי ח.פ/כינוי/שם מדויק. נדרשת התאמה ידנית.`
      : 'לא נמצאה זהות ספק במסמך. נדרשת התאמה ידנית.'
  });
}