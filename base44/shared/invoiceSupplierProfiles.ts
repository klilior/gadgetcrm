/**
 * P1-B — STRUCTURED SUPPLIER/DOCUMENT PROFILE REGISTRY (pure, data-driven).
 *
 * What this is: a small curated registry of VERIFIED identity facts per supplier (canonical id,
 * VAT, curated aliases, exact trusted sender emails, trusted non-public domains, proven Linet
 * supplier account, reference/title patterns and label hints), plus deterministic matchers.
 *
 * What this is NOT: a per-document parser, a coordinate/layout map, a place for expected
 * per-document numbers / totals / dates, or a fuzzy matcher.
 *
 * Hard rules:
 *  - A profile is selected ONLY from strong, exact, curated evidence: exact valid VAT, exact
 *    known Linet supplier account, exact trusted FULL sender email, exact trusted NON-PUBLIC
 *    sender domain, or an exact normalized curated alias/name.
 *  - An invoice-number or title pattern can NEVER identify a supplier — patterns only validate.
 *  - Public/shared mail domains (gmail.com …) are never trusted domains; an exact full address may be.
 *  - Strong signals pointing at different profiles → PROFILE_CONFLICT (no supplier, review).
 *    One alias shared by several profiles → PROFILE_AMBIGUOUS (no supplier).
 *  - The match resolves to an EXISTING Suppliers row (canonical redirects followed) and never
 *    creates, renames, updates or synthesizes a supplier.
 *  - Model confidence / telemetry is irrelevant here.
 *  - Nothing here approves anything: classification guard, monetary audit, P1-A disagreement
 *    policy, business duplicate, line checks and the validation gate all still decide.
 */

import { cleanEvidence } from './invoiceSentinelValues.ts';
import { isValidVatIdentifier, normalizeVatId, normalizeSupplierName, parseAliases, resolveCanonical, isOurBuyerVatId } from './supplierResolver.ts';

export const SUPPLIER_PROFILES_VERSION = 'supplier-profiles-1.0.0';

export const PROFILE_REASON_CODES = {
  NO_EVIDENCE: 'PROFILE_NO_STRONG_EVIDENCE',
  MATCHED: 'PROFILE_MATCHED',
  CONFLICT: 'PROFILE_CONFLICT',
  AMBIGUOUS: 'PROFILE_AMBIGUOUS',
  SUPPLIER_MISSING: 'PROFILE_SUPPLIER_ROW_MISSING',
  SUPPLIER_INACTIVE: 'PROFILE_SUPPLIER_ROW_INACTIVE',
  PATTERN_ONLY: 'PROFILE_PATTERN_IS_NOT_IDENTITY',
  DOC_NUMBER_IMPLAUSIBLE: 'PROFILE_DOC_NUMBER_IMPLAUSIBLE',
  DATE_VERIFICATION_REQUIRED: 'PROFILE_DATE_VERIFICATION_REQUIRED'
};

/** Shared/public mail domains — never identity evidence, whoever sends from them. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.il', 'outlook.com', 'outlook.co.il',
  'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.il', 'ymail.com', 'icloud.com', 'me.com',
  'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'walla.com', 'walla.co.il', '013.net',
  'bezeqint.net', 'nana.co.il', 'inter.net.il'
]);

/**
 * The registry. Every value below is a VERIFIED curated fact.
 * `linet_supplier_account_id: null` means "not proven" — it is never invented.
 */
export const SUPPLIER_PROFILES: any[] = [
  {
    profile_key: 'STS',
    display_name: 'אס.טי.אס מגה גרופ',
    canonical_supplier_id: '696f8b608af51a27cabb505e',
    vat_ids: ['516542024'],
    linet_supplier_account_id: '139',
    aliases: ['אס.טי.אס מגה גרופ', 'אס טי טס מגה גרופ', 'אס טי אס מגה גרופ', 'STS', 'STS MEGAGROUP', 'STS MEGA GROUP', 'Mega Group'],
    trusted_sender_emails: [],
    trusted_domains: [],
    title_patterns: ['חשבונית מס', 'חשבונית זיכוי'],
    document_number_patterns: [
      { kind: 'tax_invoice', prefix: 'IN', regex: /^IN\d{9}$/ },
      // Credit references use IK; observed lengths vary, so the length is intentionally loose.
      { kind: 'credit_note', prefix: 'IK', regex: /^IK\d{6,12}$/ }
    ],
    reference_prefixes: ['IN', 'IK'],
    // Linet stores the bare numeric core for this supplier, so a bare 9-digit reference is valid…
    bare_numeric_reference_regex: /^\d{9}$/,
    // …and IN + exactly 9 digits may be normalized to that core — ONLY inside a matched STS context.
    contextual_reference_normalization: { from: /^IN(\d{9})$/, to: '$1' },
    invoice_date_labels: ['תאריך חשבונית', 'תאריך מסמך', 'תאריך', 'invoice date', 'document date'],
    payable_total_labels: ['סה״כ לתשלום', 'סה״כ כולל מע״מ', 'total', 'amount due'],
    // P1 FINAL SAFETY HOTFIX 2 — verified evidence: on STS CREDIT notes (IK references) a first pass
    // read a plausible but WRONG printed date (15.07 instead of the audited 16.07) and the gate
    // passed nondeterministically. For this ONE curated case the printed date must be re-verified
    // even when it is generically plausible. Verification only: never an auto-correction.
    forced_date_verification_doc_kinds: ['credit_note']
  },
  {
    profile_key: 'INTECH',
    display_name: 'פ.ט אינטק סחר',
    canonical_supplier_id: '69c944172ddebc3eff81c9c3',
    vat_ids: ['516058989'],
    linet_supplier_account_id: '151',
    // "LITECH" is an OBSERVED OCR variant of the printed name, curated explicitly (not fuzzy).
    aliases: ['פ.ט אינטק סחר', 'פ.ט. אינטק סחר', 'פ ט אינטק סחר', 'אינטק סחר', 'INTECH', 'LITECH'],
    trusted_sender_emails: [],
    trusted_domains: [],
    title_patterns: ['חשבונית מס', 'חשבונית זיכוי'],
    document_number_patterns: [
      { kind: 'tax_invoice', prefix: 'IN', regex: /^IN\d{9}$/ }
    ],
    reference_prefixes: ['IN'],
    bare_numeric_reference_regex: null,
    contextual_reference_normalization: null,
    invoice_date_labels: ['תאריך חשבונית', 'תאריך מסמך', 'invoice date'],
    payable_total_labels: ['סה״כ לתשלום', 'סה״כ כולל מע״מ']
  },
  {
    profile_key: 'ALPHONE',
    display_name: 'אולפון יבוא סחר בעמ',
    canonical_supplier_id: '6a12f0860a0eb61e7a5c5e45',
    vat_ids: ['515893683'],
    // No verified Linet supplier account exists in current data — stays null on purpose.
    linet_supplier_account_id: null,
    aliases: ['אולפון יבוא סחר', 'אולפון', 'Alliphone', 'alliphone', 'Allphone', 'Alphone', 'All phone'],
    // An exact full address may be trusted even on a public domain; the DOMAIN never is.
    trusted_sender_emails: ['allphonedocs@gmail.com'],
    trusted_domains: [],
    title_patterns: ['חשבונית מס', 'חשבונית זיכוי'],
    document_number_patterns: [
      { kind: 'tax_invoice', prefix: 'IN', regex: /^IN\d{9}$/ },
      { kind: 'credit_note', prefix: 'CR', regex: /^CR\d{9}$/ }
    ],
    reference_prefixes: ['IN', 'CR'],
    bare_numeric_reference_regex: null,
    contextual_reference_normalization: null,
    invoice_date_labels: ['תאריך חשבונית', 'תאריך מסמך', 'invoice date'],
    payable_total_labels: ['סה״כ לתשלום', 'סה״כ כולל מע״מ']
  },
  {
    // P1 FINAL SAFETY HOTFIX — added because a plausible but WRONG nearby number auto-approved.
    // Identity here is EXACT VAT / canonical supplier only: aliases stay empty on purpose, so a
    // printed name can never select this profile. The verified format only VALIDATES.
    profile_key: 'DYNAMICA',
    display_name: 'דינמיקה',
    canonical_supplier_id: '696f8da9b305e95413c05ce1',
    vat_ids: ['514389246'],
    linet_supplier_account_id: null,
    aliases: [],
    trusted_sender_emails: [],
    trusted_domains: [],
    title_patterns: ['חשבונית מס', 'חשבונית זיכוי'],
    // Verified examples: 312368412, 312368384, 312257948.
    document_number_patterns: [
      { kind: 'tax_invoice', prefix: '312', regex: /^312\d{6}$/ },
      { kind: 'credit_note', prefix: '312', regex: /^312\d{6}$/ }
    ],
    reference_prefixes: ['312'],
    bare_numeric_reference_regex: null,
    contextual_reference_normalization: null,
    invoice_date_labels: ['תאריך חשבונית', 'תאריך מסמך', 'invoice date'],
    payable_total_labels: ['סה״כ לתשלום', 'סה״כ כולל מע״מ']
  },
  {
    // Same hotfix rationale; CSGIL = tax invoice, CRGIL = credit note.
    // Verified examples: CSGIL392029, CSGIL391554, CSGIL391218, CRGIL12688.
    profile_key: 'GETPACKAGE',
    display_name: 'GetPackage',
    canonical_supplier_id: '696e3d956caec03e0164a08f',
    vat_ids: ['515385755'],
    linet_supplier_account_id: null,
    aliases: [],
    trusted_sender_emails: [],
    trusted_domains: [],
    title_patterns: ['חשבונית מס', 'חשבונית זיכוי'],
    document_number_patterns: [
      { kind: 'tax_invoice', prefix: 'CSGIL', regex: /^CSGIL\d{5,8}$/ },
      { kind: 'credit_note', prefix: 'CRGIL', regex: /^CRGIL\d{5,8}$/ }
    ],
    reference_prefixes: ['CSGIL', 'CRGIL'],
    bare_numeric_reference_regex: null,
    contextual_reference_normalization: null,
    invoice_date_labels: ['תאריך חשבונית', 'תאריך מסמך', 'invoice date'],
    payable_total_labels: ['סה״כ לתשלום', 'סה״כ כולל מע״מ']
  }
];

// ── helpers ────────────────────────────────────────────────────────────────

export function getProfile(profileKey: string) {
  return SUPPLIER_PROFILES.find((p) => p.profile_key === profileKey) || null;
}

export function normalizeEmail(raw: unknown): string {
  const value = cleanEvidence(raw).toLowerCase();
  const match = value.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/);
  return match ? match[0] : '';
}

export function emailDomain(raw: unknown): string {
  const email = normalizeEmail(raw);
  if (email) return email.split('@')[1] || '';
  const value = cleanEvidence(raw).toLowerCase().replace(/^@/, '');
  return /^[a-z0-9.\-]+\.[a-z]{2,}$/.test(value) ? value : '';
}

export function isPublicEmailDomain(raw: unknown): boolean {
  const domain = emailDomain(raw);
  return !!domain && PUBLIC_EMAIL_DOMAINS.has(domain);
}

/** Uppercased reference with spaces/dashes/slashes stripped — comparison form only. */
export function normalizeReference(raw: unknown): string {
  return cleanEvidence(raw).replace(/[\s\-_/\\.]/g, '').toUpperCase();
}

// ── strong-signal collection ───────────────────────────────────────────────

function strongSignals(profile: any, evidence: any) {
  const hits: any[] = [];

  const vat = evidence.vat_id;
  if (isValidVatIdentifier(vat) && !isOurBuyerVatId(vat)) {
    const normalized = normalizeVatId(vat);
    if (profile.vat_ids.some((v: string) => normalizeVatId(v) === normalized)) {
      hits.push({ method: 'profile_vat_id', matched_value: normalized });
    }
  }

  const linetId = cleanEvidence(evidence.linet_supplier_id);
  if (linetId && profile.linet_supplier_account_id && String(profile.linet_supplier_account_id) === linetId) {
    hits.push({ method: 'profile_linet_account', matched_value: linetId });
  }

  const senderEmail = normalizeEmail(evidence.sender_email);
  if (senderEmail && (profile.trusted_sender_emails || []).some((e: string) => normalizeEmail(e) === senderEmail)) {
    hits.push({ method: 'profile_trusted_sender_email', matched_value: senderEmail });
  }

  // A domain signal is allowed ONLY for a curated non-public domain.
  const domain = emailDomain(evidence.sender_domain || evidence.sender_email);
  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain) && (profile.trusted_domains || []).some((d: string) => emailDomain(d) === domain)) {
    hits.push({ method: 'profile_trusted_domain', matched_value: domain });
  }

  const name = normalizeSupplierName(evidence.supplier_name_normalized || evidence.supplier_name);
  if (name && profile.aliases.some((a: string) => normalizeSupplierName(a) === name)) {
    hits.push({ method: 'profile_alias', matched_value: name });
  }

  return hits;
}

function fail(reasonCode: string, reason: string, extra: any = {}) {
  return {
    profiles_version: SUPPLIER_PROFILES_VERSION,
    matched: false,
    profile_key: null,
    canonical_supplier_id: null,
    supplier: null,
    supplier_id: null,
    linet_supplier_account_id: null,
    method: 'none',
    matched_values: [],
    reliable_for_auto_approval: false,
    reason_code: reasonCode,
    reason,
    conflict_candidates: [],
    ...extra
  };
}

/**
 * PURE deterministic profile match.
 * @param evidence { vat_id, linet_supplier_id, sender_email, sender_domain, supplier_name, supplier_name_normalized }
 * @param context  { suppliers } — existing Suppliers rows; the match may only point at one of them.
 */
export function matchSupplierProfile(evidence: any = {}, context: any = {}) {
  const suppliers: any[] = Array.isArray(context.suppliers) ? context.suppliers : [];

  const perProfile = SUPPLIER_PROFILES
    .map((profile) => ({ profile, hits: strongSignals(profile, evidence) }))
    .filter((row) => row.hits.length > 0);

  if (!perProfile.length) {
    return fail(PROFILE_REASON_CODES.NO_EVIDENCE, 'לא נמצאה עדות זהות חזקה ומדויקת לפרופיל ספק מוכר.');
  }

  if (perProfile.length > 1) {
    // Strong signals disagree across profiles → fail closed, keep the candidates for the reviewer.
    const aliasOnly = perProfile.every((row) => row.hits.every((h: any) => h.method === 'profile_alias'));
    const code = aliasOnly ? PROFILE_REASON_CODES.AMBIGUOUS : PROFILE_REASON_CODES.CONFLICT;
    return fail(
      code,
      aliasOnly
        ? 'אותו כינוי מצביע על יותר מפרופיל אחד ולכן לא נבחר ספק.'
        : 'עדויות זהות חזקות מצביעות על פרופילי ספק שונים ולכן לא נבחר ספק.',
      { conflict_candidates: perProfile.map((row) => ({ profile_key: row.profile.profile_key, methods: row.hits.map((h: any) => h.method) })) }
    );
  }

  const { profile, hits } = perProfile[0];
  const stored = suppliers.find((s: any) => s.id === profile.canonical_supplier_id) || null;
  if (!stored) {
    return fail(
      PROFILE_REASON_CODES.SUPPLIER_MISSING,
      `הפרופיל ${profile.profile_key} מצביע על רשומת ספק שאינה קיימת במערכת (${profile.canonical_supplier_id}).`,
      { profile_key: profile.profile_key, canonical_supplier_id: profile.canonical_supplier_id }
    );
  }

  const canonical = resolveCanonical(stored, suppliers);
  if (canonical.supplier.is_active === false) {
    return fail(
      PROFILE_REASON_CODES.SUPPLIER_INACTIVE,
      `רשומת הספק של הפרופיל ${profile.profile_key} אינה פעילה ואין הפניה קנונית תקפה.`,
      { profile_key: profile.profile_key, canonical_supplier_id: profile.canonical_supplier_id }
    );
  }

  return {
    profiles_version: SUPPLIER_PROFILES_VERSION,
    matched: true,
    profile_key: profile.profile_key,
    canonical_supplier_id: profile.canonical_supplier_id,
    supplier: canonical.supplier,
    supplier_id: canonical.supplier.id,
    linet_supplier_account_id: profile.linet_supplier_account_id ?? null,
    method: hits[0].method,
    matched_values: hits.map((h: any) => ({ method: h.method, value: h.matched_value })),
    reliable_for_auto_approval: true,
    reason_code: PROFILE_REASON_CODES.MATCHED,
    reason: `זוהה פרופיל ספק ${profile.profile_key} לפי ${hits.map((h: any) => h.method).join(', ')}.`,
    conflict_candidates: [],
    redirected_from: canonical.redirected ? stored.id : null,
    redirect_chain: canonical.chain
  };
}

/**
 * Profile-aware document-number validation. Patterns VALIDATE, they never identify.
 * Returns applicable:false when there is no reliable profile or no declared pattern.
 * A profile-implausible number is NEVER auto-corrected — it only requests targeted recovery.
 */
export function validateProfileDocNumber(profileMatch: any, docNumber: unknown) {
  const profile = profileMatch?.matched && profileMatch.reliable_for_auto_approval ? getProfile(profileMatch.profile_key) : null;
  const patterns = profile?.document_number_patterns || [];
  const value = normalizeReference(docNumber);
  if (!profile || !patterns.length || !value) {
    return { applicable: false, valid: true, profile_key: profile?.profile_key ?? null, reason_code: null, reason: null, expected: [] };
  }
  const expected = patterns.map((p: any) => `${p.kind}: ${String(p.regex)}`);
  const matchedPattern = patterns.find((p: any) => p.regex.test(value));
  const bareOk = profile.bare_numeric_reference_regex ? profile.bare_numeric_reference_regex.test(value) : false;
  if (matchedPattern || bareOk) {
    return { applicable: true, valid: true, profile_key: profile.profile_key, matched_kind: matchedPattern?.kind || 'bare_numeric', reason_code: null, reason: null, expected };
  }
  return {
    applicable: true,
    valid: false,
    profile_key: profile.profile_key,
    matched_kind: null,
    reason_code: PROFILE_REASON_CODES.DOC_NUMBER_IMPLAUSIBLE,
    reason: `מספר המסמך "${value}" אינו תואם את תבניות האסמכתא המאומתות של ${profile.profile_key}; נדרשת קריאה חוזרת של מספר המסמך מהמסמך (אין תיקון אוטומטי).`,
    expected
  };
}

/**
 * P1 HOTFIX 2 — data-driven, per-profile forced verification of the printed invoice date.
 *
 * Applicable ONLY when ALL of these hold:
 *  - the profile was RELIABLY matched (exact curated identity evidence), and
 *  - that profile declares the document kind in forced_date_verification_doc_kinds, and
 *  - the supported document really is that kind (credit note = CREDIT_NOTE / חשבונית זיכוי).
 *
 * It requests targeted verification of invoice_date ONLY. It never corrects a date, never
 * re-extracts anything else, and is inert for every other supplier and document kind.
 */
export function requiresProfileDateVerification(profileMatch: any, extraction: any = {}) {
  const profile = profileMatch?.matched && profileMatch.reliable_for_auto_approval ? getProfile(profileMatch.profile_key) : null;
  const kinds: string[] = profile?.forced_date_verification_doc_kinds || [];
  if (!profile || !kinds.length) {
    return { applicable: false, profile_key: profile?.profile_key ?? null, doc_kind: null, reason_code: null, reason: null };
  }
  const classification = String(extraction?.classification || '').trim().toUpperCase();
  const docTypeHe = cleanEvidence(extraction?.doc_type_he);
  const isCredit = classification === 'CREDIT_NOTE' || docTypeHe === 'חשבונית זיכוי';
  const docKind = isCredit ? 'credit_note' : (classification === 'TAX_INVOICE' || docTypeHe === 'חשבונית מס' ? 'tax_invoice' : null);
  if (!docKind || !kinds.includes(docKind)) {
    return { applicable: false, profile_key: profile.profile_key, doc_kind: docKind, reason_code: null, reason: null };
  }
  return {
    applicable: true,
    profile_key: profile.profile_key,
    doc_kind: docKind,
    reason_code: PROFILE_REASON_CODES.DATE_VERIFICATION_REQUIRED,
    reason: `נדרש אימות ממוקד של תאריך המסמך המודפס עבור מסמך זיכוי של ${profile.profile_key} (אימות בלבד, ללא תיקון אוטומטי).`
  };
}

/**
 * Contextual reference normalization — applied ONLY inside a reliably matched profile context
 * and only for the exact declared shape. The printed original is always preserved separately.
 */
export function normalizeProfileReference(profileMatch: any, docNumber: unknown) {
  const printed_original = cleanEvidence(docNumber) || null;
  const profile = profileMatch?.matched && profileMatch.reliable_for_auto_approval ? getProfile(profileMatch.profile_key) : null;
  const rule = profile?.contextual_reference_normalization || null;
  const value = normalizeReference(docNumber);
  if (!profile || !rule || !value || !rule.from.test(value)) {
    return { applied: false, printed_original, normalized: printed_original, profile_key: profile?.profile_key ?? null };
  }
  return {
    applied: true,
    printed_original,
    normalized: value.replace(rule.from, rule.to),
    profile_key: profile.profile_key,
    reason: `נורמליזציה קונטקסטואלית של אסמכתא בהקשר ${profile.profile_key} בלבד; המקור המודפס נשמר.`
  };
}

/**
 * Label/pattern HINTS for the P1-A narrow second pass. Hints may narrow which printed labels to
 * look for — they are never positive evidence and never turn a due date into an invoice date.
 */
export function profileRecoveryHints(profileMatch: any) {
  const profile = profileMatch?.matched && profileMatch.reliable_for_auto_approval ? getProfile(profileMatch.profile_key) : null;
  if (!profile) return null;
  return {
    profile_key: profile.profile_key,
    display_name: profile.display_name,
    doc_number_patterns: (profile.document_number_patterns || []).map((p: any) => `${p.kind} ${String(p.regex)}`),
    reference_prefixes: profile.reference_prefixes || [],
    title_patterns: profile.title_patterns || [],
    invoice_date_labels: profile.invoice_date_labels || [],
    payable_total_labels: profile.payable_total_labels || []
  };
}

/** Compact, auditable summary for provenance / dry-run output. No document text. */
export function summarizeProfileMatch(profileMatch: any) {
  if (!profileMatch) return null;
  return {
    profiles_version: profileMatch.profiles_version || SUPPLIER_PROFILES_VERSION,
    matched: profileMatch.matched === true,
    profile_key: profileMatch.profile_key ?? null,
    supplier_id: profileMatch.supplier_id ?? null,
    method: profileMatch.method ?? 'none',
    matched_values: profileMatch.matched_values ?? [],
    reliable_for_auto_approval: profileMatch.reliable_for_auto_approval === true,
    reason_code: profileMatch.reason_code ?? null,
    conflict_candidates: profileMatch.conflict_candidates ?? []
  };
}