/**
 * D3b — GENERAL sentinel/placeholder normalization at the shared evidence boundary.
 *
 * Extraction models sometimes emit the STRING "null" (or "N/A", "-", "/", "לא ידוע") instead of a
 * real missing value. Those strings must be treated as MISSING everywhere identity evidence is
 * read, so they can never be compared against stored supplier data — not even when a legacy
 * Supplier record happens to contain the same bad string.
 *
 * Pure module: no DB, no LLM, no side effects.
 */

export const SENTINEL_VERSION = 'sentinel-1.0.0';

/** Case / space / punctuation tolerant placeholder vocabulary. */
const SENTINEL_TOKENS = new Set([
  'null', 'nulls', 'undefined', 'undef', 'none', 'nil', 'nan',
  'na', 'n/a', 'n.a', 'nota', 'notavailable', 'notapplicable', 'unknown',
  'empty', 'blank', 'missing', 'false', 'nodata', 'no',
  'לאידוע', 'לאניתןלקרוא', 'לאנקרא', 'איןנתונים', 'לארלוונטי', 'לאזמין', 'חסר'
]);

/** Strings that are ONLY punctuation / separators ("-", "/", "--", "...", "—"). */
const PUNCTUATION_ONLY = /^[\s\-–—_./\\|:;,*?"'`()[\]{}=+#]+$/;

/**
 * True when the raw value carries no information and must be treated as missing.
 * Tolerant to case, surrounding/inner spaces and separator punctuation.
 */
export function isSentinelValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'number') return !Number.isFinite(raw);
  const value = String(raw).trim();
  if (!value) return true;
  if (PUNCTUATION_ONLY.test(value)) return true;
  // Compare on a key with all spaces and separator punctuation removed, e.g. "N / A" → "na".
  const key = value.toLowerCase().replace(/[\s._\-–—'"`]/g, '');
  if (!key) return true;
  if (SENTINEL_TOKENS.has(key)) return true;
  // "n/a" style keeps its slash after the strip above.
  return SENTINEL_TOKENS.has(key.replace(/\//g, ''));
}

/** Returns the trimmed value, or '' when it is blank / a sentinel placeholder. */
export function cleanEvidence(raw: unknown): string {
  return isSentinelValue(raw) ? '' : String(raw).trim();
}