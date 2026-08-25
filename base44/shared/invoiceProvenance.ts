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
  HUMAN_EDIT: 'HUMAN_EDIT',
  // P1-A: narrow second-pass recovery of critical header fields (audit only).
  RECOVERY_ATTEMPTED: 'RECOVERY_ATTEMPTED',
  RECOVERY_APPLIED: 'RECOVERY_APPLIED',
  RECOVERY_CONFLICT: 'RECOVERY_CONFLICT',
  RECOVERY_UNRESOLVED: 'RECOVERY_UNRESOLVED'
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
  const recovery = raw.recovery && typeof raw.recovery === 'object' ? raw.recovery : null;
  return { version: raw.version || PROVENANCE_VERSION, original, ai, linet, selected, recovery };
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
    recovery: state.recovery || null,
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

/**
 * P1-A — records the narrow critical-field recovery decision per field, WITHOUT touching the
 * immutable original snapshot, the AI candidate or the selected values written by
 * applyExtractionProvenance. Both candidates are kept on disagreement. Compact only:
 * value + printed label + short reason, never document text and never line arrays.
 */
export function applyRecoveryProvenance({ existingJson, merge, at = new Date().toISOString() }) {
  const state = parseProvenance(existingJson);
  if (!merge || !Array.isArray(merge.decisions) || !merge.decisions.length) {
    return { json: serialize(state), state, recorded: false };
  }
  const fields = {};
  for (const decision of merge.decisions) {
    if (!decision?.field) continue;
    fields[decision.field] = {
      first: decision.first_pass ? { value: decision.first_pass.value ?? null, valid: decision.first_pass.valid === true } : null,
      second: decision.second_pass ? { value: decision.second_pass.value ?? null, valid: decision.second_pass.valid === true, printed_label: trim(decision.second_pass.printed_label), confidence: decision.second_pass.confidence ?? null } : null,
      selected: { value: decision.selected_value ?? null, source: decision.selected_source || null },
      reason_code: decision.reason_code || null,
      reason: trim(decision.reason)
    };
  }
  state.recovery = {
    version: merge.version || null,
    updated_at: at,
    requested_fields: merge.requested_fields || [],
    applied_fields: merge.applied_fields || [],
    unresolved_fields: merge.unresolved_fields || [],
    conflict_fields: merge.conflict_fields || [],
    requires_manual_review: merge.requires_manual_review === true,
    outcome: merge.outcome || null,
    fields
  };
  return { json: serialize(state), state, recorded: true };
}

/** Compact events for a recovery attempt: attempted + applied/conflict/unresolved. */
export function buildRecoveryEvents(merge, at = new Date().toISOString()) {
  if (!merge) return [];
  const meta = { requested: merge.requested_fields || [], applied: merge.applied_fields || [] };
  const events = [{ type: EVENT_TYPES.RECOVERY_ATTEMPTED, at, outcome: 'attempted', reason: null, meta }];
  if ((merge.conflict_fields || []).length) {
    events.push({ type: EVENT_TYPES.RECOVERY_CONFLICT, at, outcome: 'manual_review', reason: (merge.review_reasons_he || [])[0] || null, meta: { fields: merge.conflict_fields } });
  }
  if ((merge.unresolved_fields || []).length) {
    events.push({ type: EVENT_TYPES.RECOVERY_UNRESOLVED, at, outcome: 'manual_review', reason: (merge.review_reasons_he || [])[0] || null, meta: { fields: merge.unresolved_fields } });
  }
  if ((merge.applied_fields || []).length) {
    events.push({ type: EVENT_TYPES.RECOVERY_APPLIED, at, outcome: 'applied', reason: null, meta: { fields: merge.applied_fields } });
  }
  return events;
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

/**
 * A real AI attempt failed. Writes the coherent ATTEMPT_STARTED → ATTEMPT_FAILED pair using the
 * SAME startedAt, so failures read like successes do. If the latest history already holds an
 * ATTEMPT_STARTED with that exact timestamp, only ATTEMPT_FAILED is appended.
 * Without a real startedAt (exception before the attempt began) NOTHING is written.
 */
export function appendFailedAttemptPair(existingJson, { startedAt, reason = null, meta = undefined, at = new Date().toISOString() }) {
  if (!startedAt) {
    return { json: existingJson ?? null, events: parseProcessingEvents(existingJson), changed: false, started_appended: false };
  }
  const history = parseProcessingEvents(existingJson);
  const alreadyStarted = history.some((event) => event.type === EVENT_TYPES.ATTEMPT_STARTED && event.at === startedAt);
  const events = [
    ...(alreadyStarted ? [] : [{ type: EVENT_TYPES.ATTEMPT_STARTED, at: startedAt, outcome: 'started', meta }]),
    { type: EVENT_TYPES.ATTEMPT_FAILED, at, outcome: 'error', reason }
  ];
  const appended = appendProcessingEvents(existingJson, events);
  return { ...appended, changed: true, started_appended: !alreadyStarted };
}