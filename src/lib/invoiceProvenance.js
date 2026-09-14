/** Browser copy of the human-edit + processing-event helpers from base44/shared/invoiceProvenance.ts. Pure. */
const PROVENANCE_VERSION = 'd2b2.1';
const CRITICAL_FIELDS = ['supplier', 'doc_number', 'doc_date', 'subtotal_before_vat', 'vat_amount', 'total_with_vat'];
const MAX_PROCESSING_EVENTS = 20;
const MAX_REASON_LENGTH = 200;

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
const trim = (text) => (text === null || text === undefined ? null : String(text).slice(0, MAX_REASON_LENGTH));

function parseProvenance(json) {
  const raw = safeParse(json, {});
  const obj = (v) => (v && typeof v === 'object' ? v : null);
  return { version: raw.version || PROVENANCE_VERSION, original: obj(raw.original), ai: obj(raw.ai), linet: obj(raw.linet), selected: obj(raw.selected) || {}, recovery: obj(raw.recovery) };
}
function serialize(state) {
  return JSON.stringify({ version: PROVENANCE_VERSION, original: state.original || null, ai: state.ai || null, linet: state.linet || null, recovery: state.recovery || null, selected: state.selected || {} });
}

export function applyHumanSelection({ existingJson, values, user = null, reason = null, at = new Date().toISOString() }) {
  const state = parseProvenance(existingJson);
  const selected = { ...(state.selected || {}) };
  const why = trim(reason || (user ? `נערך ידנית על ידי ${user}` : 'נערך ידנית'));
  for (const field of CRITICAL_FIELDS) {
    if (values?.[field] !== undefined) selected[field] = { value: values[field] === '' ? null : values[field], source: 'HUMAN', reason: why, at };
  }
  state.selected = selected;
  return { json: serialize(state), state, selection_changed: true };
}

export function appendProcessingEvent(existingJson, event) {
  const raw = safeParse(existingJson, []);
  const history = Array.isArray(raw) ? raw.filter((e) => e && typeof e === 'object') : [];
  if (event?.type) {
    history.push({ type: event.type, at: event.at || new Date().toISOString(), outcome: event.outcome || null, reason: trim(event.reason), meta: event.meta && typeof event.meta === 'object' ? event.meta : undefined });
  }
  const capped = history.slice(-MAX_PROCESSING_EVENTS);
  return { json: JSON.stringify(capped), events: capped, dropped: Math.max(0, history.length - capped.length) };
}