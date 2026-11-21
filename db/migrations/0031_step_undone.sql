-- Fix round 21 Nov 2026 (A7): a weighing undone to weigh another lot is one insert-only step event 'undone' (with its
-- reason and the performer's signature, server/routes/batches.ts); the engine counts the step's values from after it
-- (shared/engine/values.ts currentValues), the values before stay in the record. TrueBatch Liquids Packing runs this too.
alter table step_events drop constraint step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in ('started', 'value', 'done', 'checked', 'sent_back', 'corrected',
  'not_applicable', 'late', 'qa_released_hold', 'note', 'demo_wait_skipped', 'undone'));
