/**
 * P1-E — DETERMINISTIC CLASSIFICATION RECOVERY (pure, DB-free, fail-closed).
 *
 * The strict guard (classification-guard-1.0.0) trusts the model's CLAIMED classification first,
 * so an explicit printed "חשבונית מס" / "חשבונית זיכוי" is lost whenever Vision returns OTHER.
 * This layer runs AFTER the guard (whose result is retained for audit) and may only ever move a
 * document from OTHER to a supported type — never the other way, and never past the gate.
 *
 * Order of evidence:
 *  1. An explicit POSITIVE printed title beats a mistaken model claim.
 *  2. An explicit NEGATIVE title (standalone receipt, delivery note, PO, statement, bank
 *     transfer / remittance report, account summary, proforma, quote, report) ALWAYS blocks.
 *     Standalone RECEIPT stays unsupported: no policy approval was given.
 *  3. A bare generic "Invoice" / "חשבונית" ALWAYS blocks and is never upgraded.
 *  4. Only when NO title is printed may recovery happen, and only from a STRONG CONJUNCTION:
 *     reliable non-conflicting curated profile on an existing active canonical supplier +
 *     exact VAT/profile identity evidence (never name-only, never a public domain alone) +
 *     a profile-valid document number whose pattern itself identifies tax_invoice or credit_note +
 *     at least one trustworthy monetary anchor.
 *     The recovered TYPE always comes from that document-number pattern — never a guess.
 *
 * Model confidence, file name, stored invoice values and a profile alone can never recover.
 * Recovery only allows the document to reach P1-A / P1-B / P1-C / the gate; the deterministic
 * validation gate remains the ONLY approval authority.
 */

import { cleanEvidence } from './invoiceSentinelValues.ts';
import { isValidVatIdentifier, isOurBuyerVatId, normalizeVatId } from './supplierResolver.ts';
import { validateProfileDocNumber, getProfile } from './invoiceSupplierProfiles.ts';
import { evaluateTitleVerdict } from './invoiceDocumentClassification.ts';

export const CLASSIFICATION_RECOVERY_VERSION = 'classification-recovery-1.0.0';

export const RECOVERY_REASON_CODES = {
  NOT_NEEDED: 'CLASSIFICATION_RECOVERY_NOT_NEEDED',
  TITLE_POSITIVE: 'CLASSIFICATION_RECOVERED_FROM_PRINTED_TITLE',
  ANCHORS_SATISFIED: 'CLASSIFICATION_RECOVERED_FROM_STRONG_ANCHORS',
  NEGATIVE_TITLE: 'CLASSIFICATION_BLOCKED_NEGATIVE_TITLE',
  GENERIC_TITLE: 'CLASSIFICATION_BLOCKED_GENERIC_TITLE',
  TITLE_NOT_POSITIVE: 'CLASSIFICATION_BLOCKED_TITLE_NOT_POSITIVE',
  INSUFFICIENT_ANCHORS: 'CLASSIFICATION_BLOCKED_INSUFFICIENT_ANCHORS'
};

/** Monetary coherence tolerance — same rounding tolerance the header check already uses. */
const MONETARY_TOLERANCE = 0.02;

/**
 * Trusted sender / domain / Linet-account evidence is recorded as a SUPPORTING audit anchor only.
 * A title-absent recovery still requires an exact printed VAT equal to the profile's VAT.
 */
const SUPPORTING_IDENTITY_METHODS = new Set(['profile_linet_account', 'profile_trusted_sender_email', 'profile_trusted_domain']);

/** Document-number pattern kinds that themselves identify the document type. */
const TYPE_IDENTIFYING_KINDS: Record<string, string> = { tax_invoice: 'TAX_INVOICE', credit_note: 'CREDIT_NOTE' };

const DOC_TYPE_HE: Record<string, string> = { TAX_INVOICE: 'חשבונית מס', CREDIT_NOTE: 'חשבונית זיכוי' };

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function result(fields: any) {
  return {
    version: CLASSIFICATION_RECOVERY_VERSION,
    attempted: false,
    applied: false,
    from: null,
    to: null,
    doc_type_he: null,
    anchors: [],
    blockers: [],
    reason_code: null,
    reason: null,
    ...fields
  };
}

/**
 * Printed-title verdict for recovery = sentinel-cleaned evidence + THE shared verdict owned by
 * invoiceDocumentClassification.ts. No local title rules exist here, so the strict guard and
 * recovery can never disagree about a collision title.
 */
export function evaluatePrintedTitle(documentTitle: unknown) {
  return evaluateTitleVerdict(cleanEvidence(documentTitle));
}

/**
 * PURE recovery decision.
 * @param input { extraction, profile_match }
 */
export function evaluateClassificationRecovery(input: any = {}) {
  const extraction = input.extraction || {};
  const from = String(extraction.classification ?? '').trim().toUpperCase();

  // Only a document the guard sent to OTHER is a recovery candidate.
  if (from !== 'OTHER') {
    return result({ from: from || null, reason_code: RECOVERY_REASON_CODES.NOT_NEEDED, reason: 'המסמך אינו מסווג OTHER ולכן אין צורך בשחזור סיווג.' });
  }

  const title = evaluatePrintedTitle(extraction.document_title);

  if (title.verdict === 'negative') {
    return result({ attempted: true, from, blockers: ['explicit_negative_title'], reason_code: RECOVERY_REASON_CODES.NEGATIVE_TITLE, reason: 'כותרת מודפסת מפורשת שאינה חשבונית מס/זיכוי (קבלה, תעודת משלוח, הזמנה, דוח, ריכוז וכו\') — שחזור נחסם.' });
  }
  if (title.verdict === 'generic') {
    return result({ attempted: true, from, blockers: ['bare_generic_invoice_title'], reason_code: RECOVERY_REASON_CODES.GENERIC_TITLE, reason: 'כותרת "חשבונית"/"Invoice" כללית אינה מתויגת כחשבונית מס ואינה ניתנת לשחזור.' });
  }
  if (title.verdict === 'positive') {
    return result({
      attempted: true, applied: true, from, to: title.type, doc_type_he: DOC_TYPE_HE[title.type as string],
      anchors: ['explicit_positive_printed_title'],
      reason_code: RECOVERY_REASON_CODES.TITLE_POSITIVE,
      reason: `כותרת מודפסת מפורשת (${DOC_TYPE_HE[title.type as string]}) גוברת על סיווג שגוי של המודל.`
    });
  }
  if (title.present) {
    return result({ attempted: true, from, blockers: [`title_${title.verdict}`], reason_code: RECOVERY_REASON_CODES.TITLE_NOT_POSITIVE, reason: 'קיימת כותרת מודפסת שאינה תיוג חיובי מפורש ולכן לא בוצע שחזור.' });
  }

  // ── No printed title: strong conjunction only ─────────────────────────────
  const profileMatch = input.profile_match || null;
  const anchors: string[] = [];
  const blockers: string[] = [];

  const profileOk = !!(profileMatch?.matched && profileMatch.reliable_for_auto_approval && profileMatch.supplier_id && profileMatch.supplier);
  if (profileOk) anchors.push('reliable_curated_profile');
  else blockers.push(`profile:${profileMatch?.reason_code || 'PROFILE_NO_STRONG_EVIDENCE'}`);

  // Exact identity for a TITLE-ABSENT recovery means ONE thing only: a syntactically valid
  // supplier VAT id printed on the document that equals the matched profile's VAT exactly.
  // A trusted sender address / domain may be recorded as an EXTRA audit anchor, but it can never
  // substitute for a missing or mismatched VAT.
  const vat = extraction.supplier_vat_id;
  const vatUsable = isValidVatIdentifier(vat) && !isOurBuyerVatId(vat);
  const profile = profileOk ? getProfile(profileMatch.profile_key) : null;
  const vatMatchesProfile = !!(vatUsable && profile && (profile.vat_ids || []).some((v: string) => normalizeVatId(v) === normalizeVatId(vat)));
  if (profileOk && vatMatchesProfile) anchors.push('exact_vat_identity');
  else blockers.push(vatUsable ? 'vat_does_not_match_profile' : 'no_exact_vat_identity_evidence');
  // Supporting audit anchor only — never an identity substitute.
  if (SUPPORTING_IDENTITY_METHODS.has(String(profileMatch?.method || ''))) anchors.push(`supporting_identity:${profileMatch.method}`);

  // Type-identifying, profile-valid document number.
  const docCheck = validateProfileDocNumber(profileMatch, extraction.doc_number);
  const patternType = docCheck.applicable && docCheck.valid ? TYPE_IDENTIFYING_KINDS[String(docCheck.matched_kind)] : undefined;
  if (patternType) anchors.push(`type_identifying_doc_number:${docCheck.matched_kind}`);
  else blockers.push(docCheck.applicable && docCheck.valid ? 'doc_number_pattern_not_type_identifying' : 'doc_number_not_profile_valid');

  // Monetary trust: finite total plus coherent subtotal+VAT, or a non-ambiguous audited payable.
  const total = extraction.total_with_vat;
  const subtotal = extraction.subtotal_before_vat;
  const vatAmount = extraction.vat_amount;
  const monetaryAnchors: string[] = [];
  if (isFiniteNumber(total)) {
    if (isFiniteNumber(subtotal) && isFiniteNumber(vatAmount) && Math.abs((subtotal + vatAmount) - total) <= MONETARY_TOLERANCE) monetaryAnchors.push('coherent_subtotal_vat_total');
    // An audited payable anchor requires the EXACT audit result: not ambiguous, role
    // document_payable, and a non-empty printed evidence label. ambiguous===false alone is not proof.
    const prov = extraction.amount_provenance;
    const label = typeof prov?.total_evidence_label === 'string' ? prov.total_evidence_label.trim() : '';
    if (prov && prov.ambiguous === false && prov.total_evidence_role === 'document_payable' && label) monetaryAnchors.push('audited_document_payable');
  } else {
    blockers.push('total_not_finite');
  }
  if (monetaryAnchors.length) anchors.push(...monetaryAnchors);
  else if (isFiniteNumber(total)) blockers.push('no_trustworthy_monetary_anchor');

  if (blockers.length || !patternType) {
    return result({ attempted: true, from, anchors, blockers, reason_code: RECOVERY_REASON_CODES.INSUFFICIENT_ANCHORS, reason: `לא התקיימה מלוא חבילת העוגנים החזקה לשחזור סיווג ללא כותרת מודפסת: ${blockers.join(', ')}.` });
  }

  return result({
    attempted: true, applied: true, from, to: patternType, doc_type_he: DOC_TYPE_HE[patternType],
    anchors, blockers: [],
    reason_code: RECOVERY_REASON_CODES.ANCHORS_SATISFIED,
    reason: `שוחזר סיווג ${DOC_TYPE_HE[patternType]} מתבנית מספר המסמך של הפרופיל בצירוף זהות מדויקת ועוגן כספי אמין.`
  });
}

/** Applies the recovery onto an extraction in place (only OTHER → supported); returns the audit. */
export function applyClassificationRecovery(extraction: any, options: any = {}) {
  const decision = evaluateClassificationRecovery({ extraction, profile_match: options.profile_match || null });
  if (decision.applied) {
    extraction.classification = decision.to;
    extraction.doc_type_he = decision.doc_type_he;
    extraction.should_skip = false;
    extraction.skip_reason_he = null;
  }
  extraction.classification_recovery = decision;
  return decision;
}