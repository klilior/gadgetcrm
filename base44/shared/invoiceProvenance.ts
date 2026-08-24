/**
 * D2b2 — compact field provenance + processing history for invoices.
 *
 * Pure and DB-FREE: every function takes the current compact JSON strings and returns the new
 * strings the caller should write. Nothing here reads or writes entities.
 *
 * Hard rules:
 *  - the ORIGINAL_DOCUMENT snapshot of the critical fields is captured exactly once and is never
 *    overwritten by a retry;
 *  - the AI candidate is refreshed on every real extraction;
 *  - `selected` records value + source + reason + timestamp per critical field;
 *  - only a CONFIRMED Linet match that actually applies LINET as source_of_truth may move the
 *    selection to LINET; conflict / possible / missing / unchecked never change the selection;
 *  - provenance is AUDIT ONLY. Nothing here returns or implies approval — the deterministic
 *    validation gate stays the single authority.
 *
 * Payloads stay small: critical header fields only, no line arrays, no document text,
 * no raw extraction JSON.
 */

export const PROVENANCE_VERSION = 'd2b2.1';

export const PROVENANCE_SOURCES = {
  AI: 'AI',
  ORIGINAL_DOCUMENT: 'ORIGINAL_DOCUMENT',
  VALIDATED: 'VALIDATED',
  LINET: 'LINET',
  HUMAN: 'HUMAN'
};

export const CRITICAL_FIELDS = [
  'supplier',
  'doc_number',
  'doc_date',
  'subtotal_before_vat',
  'vat_amount',
  'total_with_vat'
];

export const EVENT_TYPES = {
  ATTEMPT_STARTED: 'ATTEMPT_STARTED',
  ATTEMPT_SUCCEEDED: 'ATTEMPT_SUCCEEDED',
  ATTEMPT_FAILED: 'ATTEMPT_FAILED',
  GATE_EVALUATED: 'GATE_EVALUATED',
  TECHNICAL_DUPLICATE: 'TECHNICAL_DUPLICATE',
  BUSINESS_DUPLICATE: 'BUSINESS_DUPLICATE',
  LINET_CONFIRMED: 'LINET_CONFIRMED',
  LINET_CONFLICT: 'LINET_CONFLICT',
  LINET_POSSIBLE: 'LINET_POSSIBLE',
  LINET_MISSING: 'LINET_MISSING',
  HUMAN_EDIT: 'HUMAN_EDIT'
};

export const MAX_PROCESSING_EVENTS = 20;
const MAX_REASON_LENGTH = 200;

/** Levels a Linet reconciliation outcome can report. Only 'confirmed' may select LINET. */
export const LINET_SELECTION_LEVELS = {
  CONFIRMED: 'confirmed',
  CONFLICT: 'conflict',
  POSSIBLE: 'possible',
  MISSING: 'missing',
  UNCHECKED: 'unchecked'
};

function safeParse(json, fallback) {
  if (json === null || json === undefined || json === '') return fallback;
  if (typeof json === 'object') return json;
  try {
    const parsed = JSON.parse(String(json));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function trim(text) {
  return text === null || text === undefined ? null : String(text).slice(0, MAX_REASON_LENGTH);
}

/** Keeps only the critical fields, with undefined dropped so a partial candidate stays partial. */
function pickCritical(values = {}) {
  const out = {};
  for (const field of CRITICAL_FIELDS) {
    if (values[field] !== undefined) out[field] = values[field] === '' ? null : values[field];
  }
  return out;
}

/** Missing or invalid JSON parses into a coherent empty state — never throws. */
export function parseProvenance(json) {
  const raw = safeParse(json, {});
  const original = raw.original && typeof raw.original === 'object' ? raw.original : null;
  const ai = raw.ai && typeof raw.ai === 'object' ? raw.ai : null;
  const linet = raw.linet && typeof raw.linet === 'object' ? raw.linet : null;
  const selected = raw.selected && typeof raw.selected === 'object' ? raw.selected : {};
  return { version: raw.version || PROVENANCE_VERSION, original, ai, linet, selected };
}

export function parseProcessingEvents(json) {
  const raw = safeParse(json, []);
  return Array.isArray(raw) ? raw.filter((event) => event && typeof event === 'object') : [];
}

function serialize(state) {
  return JSON.stringify({
    version: PROVENANCE_VERSION,
    original: state.original || null,
    ai: state.ai || null,
    linet: state.linet || null,
    selected: state.selected || {}
  });
}

function selectAll(state, { values, source, reason, at }) {
  const selected = { ...(state.selected || {}) };
  const picked = pickCritical(values);
  for (const [field, value] of Object.entries(picked)) {
    selected[field] = { value, source, reason: trim(reason), at };
  }
  return selected;
}

/**
 * A real AI extraction landed. Captures the immutable ORIGINAL_DOCUMENT snapshot once, refreshes
 * the latest AI candidate, and records the deterministically selected values (default VALIDATED).
 */
export function applyExtractionProvenance({
  existingJson,
  values,
  supplierName = null,
  selectedSource = PROVENANCE_SOURCES.VALIDATED,
  reason = null,
  at = new Date().toISOString()
}) {
  const state = parseProvenance(existingJson);
  const picked = pickCritical(values);
  const originalCaptured = !state.original;

  if (originalCaptured) {
    // Written exactly once — a retry can never overwrite what the document originally said.
    state.original = {
      source: PROVENANCE_SOURCES.ORIGINAL_DOCUMENT,
      captured_at: at,
      supplier_name: trim(supplierName),
      fields: picked
    };
  }
  state.ai = {
    source: PROVENANCE_SOURCES.AI,
    updated_at: at,
    supplier_name: trim(supplierName),
    fields: picked
  };
  state.selected = selectAll(state, { values, source: selectedSource, reason, at });

  return { json: serialize(state), state, original_captured: originalCaptured };
}

/**
 * Linet outcome. `appliedAsSourceOfTruth` must be true (a confirmed match that really wrote
 * LINET header values) before the selection may move; every other level is audit-only.
 */
export function applyLinetProvenance({
  existingJson,
  level,
  values = {},
  appliedAsSourceOfTruth = false,
  reason = null,
  at = new Date().toISOString()
}) {
  const state = parseProvenance(existingJson);
  const picked = pickCritical(values);
  const maySelect = level === LINET_SELECTION_LEVELS.CONFIRMED && appliedAsSourceOfTruth === true;

  state.linet = { source: PROVENANCE_SOURCES.LINET, level: level || LINET_SELECTION_LEVELS.UNCHECKED, updated_at: at, reason: trim(reason), fields: picked };
  if (maySelect) state.selected = selectAll(state, { values, source: PROVENANCE_SOURCES.LINET, reason, at });

  return { json: serialize(state), state, selection_changed: maySelect };
}

/** A human edited critical header values. Original + AI candidates are preserved. */
export function applyHumanSelection({ existingJson, values, user = null, reason = null, at = new Date().toISOString() }) {
  const state = parseProvenance(existingJson);
  state.selected = selectAll(state, { values, source: PROVENANCE_SOURCES.HUMAN, reason: reason || (user ? `נערך ידנית על ידי ${user}` : 'נערך ידנית'), at });
  return { json: serialize(state), state, selection_changed: true };
}

/** Appends compact events in chronological order, keeping only the newest MAX_PROCESSING_EVENTS. */
export function appendProcessingEvents(existingJson, events = []) {
  const history = parseProcessingEvents(existingJson);
  for (const event of events) {
    if (!event?.type) continue;
    history.push({
      type: event.type,
      at: event.at || new Date().toISOString(),
      outcome: event.outcome || null,
      reason: trim(event.reason),
      meta: event.meta && typeof event.meta === 'object' ? event.meta : undefined
    });
  }
  const capped = history.slice(-MAX_PROCESSING_EVENTS);
  return { json: JSON.stringify(capped), events: capped, dropped: Math.max(0, history.length - capped.length) };
}

export function appendProcessingEvent(existingJson, event) {
  return appendProcessingEvents(existingJson, [event]);
}