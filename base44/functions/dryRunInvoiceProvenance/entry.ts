import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import {
  EVENT_TYPES,
  LINET_SELECTION_LEVELS,
  MAX_PROCESSING_EVENTS,
  PROVENANCE_SOURCES,
  appendProcessingEvent,
  appendProcessingEvents,
  applyExtractionProvenance,
  applyHumanSelection,
  applyLinetProvenance,
  parseProcessingEvents,
  parseProvenance
} from '../../shared/invoiceProvenance.ts';

/**
 * D2b2 regression harness — admin only, DB-FREE and strictly read-only.
 * Verifies field provenance + processing history rules on synthetic fixtures. No entity is read
 * or written, no LLM is invoked, and no fixture may produce an approval flag.
 */

const FORBIDDEN_KEYS = ['auto_approved', 'validation_passed', 'extraction_status', 'approved'];

function hasForbiddenKey(value) {
  const json = JSON.stringify(value || {});
  return FORBIDDEN_KEYS.some((key) => json.includes(`"${key}"`));
}

const AI_1 = { supplier: 'sup_1', doc_number: 'A-100', doc_date: '2026-01-05', subtotal_before_vat: 100, vat_amount: 18, total_with_vat: 118 };
const AI_2 = { supplier: 'sup_1', doc_number: 'A-100', doc_date: '2026-01-06', subtotal_before_vat: 101, vat_amount: 18.18, total_with_vat: 119.18 };
const LINET_VALUES = { doc_date: '2026-01-05', subtotal_before_vat: 120, vat_amount: 21.6, total_with_vat: 141.6 };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const cases = [];
    const check = (name, expected, actual, extra = {}) => {
      cases.push({ case: name, passed: JSON.stringify(expected) === JSON.stringify(actual), expected, actual, ...extra });
    };

    // 1. First extraction captures the ORIGINAL_DOCUMENT snapshot exactly once.
    const first = applyExtractionProvenance({ existingJson: null, values: AI_1, supplierName: 'ספק א', reason: 'gate v1', at: '2026-01-10T10:00:00Z' });
    const firstState = parseProvenance(first.json);
    check('1_original_captured_on_first_extraction',
      { captured: true, original: AI_1, source: PROVENANCE_SOURCES.ORIGINAL_DOCUMENT },
      { captured: first.original_captured, original: firstState.original?.fields, source: firstState.original?.source });

    // 2. A retry never overwrites the original snapshot, but refreshes the AI candidate.
    const retry = applyExtractionProvenance({ existingJson: first.json, values: AI_2, supplierName: 'ספק א', reason: 'gate v1', at: '2026-01-11T10:00:00Z' });
    const retryState = parseProvenance(retry.json);
    check('2_retry_preserves_original_refreshes_ai',
      { captured_again: false, original: AI_1, original_at: '2026-01-10T10:00:00Z', ai: AI_2 },
      { captured_again: retry.original_captured, original: retryState.original?.fields, original_at: retryState.original?.captured_at, ai: retryState.ai?.fields });

    // 3. Extraction selects the deterministically validated values, with reason + timestamp.
    check('3_selection_is_validated_after_extraction',
      { source: PROVENANCE_SOURCES.VALIDATED, value: 119.18, at: '2026-01-11T10:00:00Z', has_reason: true },
      { source: retryState.selected.total_with_vat?.source, value: retryState.selected.total_with_vat?.value, at: retryState.selected.total_with_vat?.at, has_reason: !!retryState.selected.total_with_vat?.reason });

    // 4. Confirmed match that ACTUALLY applied LINET as source_of_truth may move the selection.
    const confirmedApplied = applyLinetProvenance({ existingJson: retry.json, level: LINET_SELECTION_LEVELS.CONFIRMED, values: LINET_VALUES, appliedAsSourceOfTruth: true, reason: 'אותה עסקה', at: '2026-01-12T10:00:00Z' });
    const confirmedAppliedState = parseProvenance(confirmedApplied.json);
    check('4_confirmed_applied_selects_linet',
      { changed: true, source: PROVENANCE_SOURCES.LINET, total: 141.6, original_intact: AI_1 },
      { changed: confirmedApplied.selection_changed, source: confirmedAppliedState.selected.total_with_vat?.source, total: confirmedAppliedState.selected.total_with_vat?.value, original_intact: confirmedAppliedState.original?.fields });

    // 5. Confirmed but NOT applied as source_of_truth: candidate recorded, selection preserved.
    const confirmedOnly = applyLinetProvenance({ existingJson: retry.json, level: LINET_SELECTION_LEVELS.CONFIRMED, values: LINET_VALUES, appliedAsSourceOfTruth: false, reason: 'אותה עסקה, לא סחורה', at: '2026-01-12T10:00:00Z' });
    const confirmedOnlyState = parseProvenance(confirmedOnly.json);
    check('5_confirmed_not_applied_preserves_selection',
      { changed: false, source: PROVENANCE_SOURCES.VALIDATED, total: 119.18, linet_candidate: 141.6 },
      { changed: confirmedOnly.selection_changed, source: confirmedOnlyState.selected.total_with_vat?.source, total: confirmedOnlyState.selected.total_with_vat?.value, linet_candidate: confirmedOnlyState.linet?.fields?.total_with_vat });

    // 6-8. Conflict / possible / missing are audit-only and never touch the selection.
    for (const [index, level] of [LINET_SELECTION_LEVELS.CONFLICT, LINET_SELECTION_LEVELS.POSSIBLE, LINET_SELECTION_LEVELS.MISSING].entries()) {
      const outcome = applyLinetProvenance({ existingJson: retry.json, level, values: LINET_VALUES, appliedAsSourceOfTruth: true, reason: level, at: '2026-01-12T10:00:00Z' });
      const state = parseProvenance(outcome.json);
      check(`${6 + index}_${level}_preserves_selection`,
        { changed: false, source: PROVENANCE_SOURCES.VALIDATED, total: 119.18, level },
        { changed: outcome.selection_changed, source: state.selected.total_with_vat?.source, total: state.selected.total_with_vat?.value, level: state.linet?.level });
    }

    // 9. A human edit selects HUMAN while both earlier candidates survive for audit.
    const human = applyHumanSelection({ existingJson: confirmedApplied.json, values: { total_with_vat: 130, doc_number: 'A-100-fix' }, user: 'דניאל', at: '2026-01-13T10:00:00Z' });
    const humanState = parseProvenance(human.json);
    check('9_human_edit_selects_human_and_keeps_candidates',
      { source: PROVENANCE_SOURCES.HUMAN, total: 130, original: AI_1, ai: AI_2, linet_total: 141.6, doc_date_source: PROVENANCE_SOURCES.LINET },
      { source: humanState.selected.total_with_vat?.source, total: humanState.selected.total_with_vat?.value, original: humanState.original?.fields, ai: humanState.ai?.fields, linet_total: humanState.linet?.fields?.total_with_vat, doc_date_source: humanState.selected.doc_date?.source });

    // 10. History stays chronological, capped, compact and approval-free.
    let historyJson = null;
    for (let i = 1; i <= 25; i++) {
      historyJson = appendProcessingEvent(historyJson, { type: i % 2 ? EVENT_TYPES.ATTEMPT_STARTED : EVENT_TYPES.ATTEMPT_SUCCEEDED, at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, outcome: `n${i}` }).json;
    }
    const events = parseProcessingEvents(historyJson);
    const failure = appendProcessingEvents(historyJson, [{ type: EVENT_TYPES.ATTEMPT_FAILED, at: '2026-01-01T00:01:00Z', outcome: 'error', reason: 'timeout' }]);
    check('10_events_chronological_capped_and_compact',
      { count: MAX_PROCESSING_EVENTS, first_outcome: 'n6', last_outcome: 'n25', after_failure_last: 'error', still_capped: MAX_PROCESSING_EVENTS, forbidden_keys: false },
      {
        count: events.length,
        first_outcome: events[0]?.outcome,
        last_outcome: events[events.length - 1]?.outcome,
        after_failure_last: failure.events[failure.events.length - 1]?.outcome,
        still_capped: failure.events.length,
        forbidden_keys: hasForbiddenKey(first) || hasForbiddenKey(confirmedApplied) || hasForbiddenKey(human) || hasForbiddenKey(failure)
      });

    // 11. Malformed / missing provenance JSON parses into a coherent empty state, never throws.
    const malformed = ['{not json', '[]', 'null', '', undefined, '{"selected":"oops","original":5}'];
    check('11_malformed_provenance_parses_safely',
      malformed.map(() => ({ original: null, ai: null, linet: null, selected: {} })),
      malformed.map((json) => {
        const state = parseProvenance(json);
        return { original: state.original, ai: state.ai, linet: state.linet, selected: state.selected };
      }));

    // 12. Malformed / missing events JSON parses to an empty list and drops non-object entries.
    check('12_malformed_events_parse_safely',
      [0, 0, 0, 0, 0, 1],
      ['{not json', '{"a":1}', 'null', '', undefined, '[{"type":"X"},"junk",null,7]'].map((json) => parseProcessingEvents(json).length));

    // 13. Appending onto malformed strings recovers to valid compact JSON with only the new data.
    const recoveredProvenance = applyExtractionProvenance({ existingJson: '{not json', values: AI_1, reason: 'recovery', at: '2026-02-01T10:00:00Z' });
    const recoveredEvents = appendProcessingEvent('{not json', { type: EVENT_TYPES.ATTEMPT_FAILED, at: '2026-02-01T10:00:00Z', outcome: 'error', reason: 'timeout' });
    check('13_append_recovers_to_valid_compact_json',
      { original_captured: true, total: 118, parses: true, event_count: 1, event_type: EVENT_TYPES.ATTEMPT_FAILED, events_parse: true },
      {
        original_captured: recoveredProvenance.original_captured,
        total: parseProvenance(recoveredProvenance.json).original?.fields?.total_with_vat,
        parses: (() => { try { return !!JSON.parse(recoveredProvenance.json); } catch (_) { return false; } })(),
        event_count: recoveredEvents.events.length,
        event_type: parseProcessingEvents(recoveredEvents.json)[0]?.type,
        events_parse: (() => { try { return Array.isArray(JSON.parse(recoveredEvents.json)); } catch (_) { return false; } })()
      });

    // 14. Missing values: a partial candidate stays partial and no field is invented.
    const partial = applyExtractionProvenance({ existingJson: null, values: { total_with_vat: 50 }, at: '2026-02-02T10:00:00Z' });
    const partialState = parseProvenance(partial.json);
    check('14_missing_values_stay_absent',
      { fields: { total_with_vat: 50 }, selected_keys: ['total_with_vat'] },
      { fields: partialState.original?.fields, selected_keys: Object.keys(partialState.selected) });

    const passed = cases.filter((row) => row.passed).length;
    return Response.json({ success: passed === cases.length, dry_run: true, total: cases.length, passed, failed: cases.length - passed, cases });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});