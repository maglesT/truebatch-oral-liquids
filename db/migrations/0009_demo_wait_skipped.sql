-- Demo installations only (TRUEBATCH_DEMO=1, which the platform sets only for the demo customer): a person with the
-- demo permission ends a running wait at once (a minimum time, a periodic check, a hold time). Each skip is one
-- insert-only step event 'demo_wait_skipped' with who, when and which timer (payload.timer); the engine counts the
-- wait as satisfied from then (shared/engine/batch.ts). Once per timer. TrueBatch Tablets Packing runs this too.
alter table step_events drop constraint step_events_kind_check;
alter table step_events add constraint step_events_kind_check check (kind in ('started', 'value', 'done', 'checked', 'sent_back', 'corrected',
  'not_applicable', 'late', 'qa_released_hold', 'note', 'demo_wait_skipped'));
create unique index step_events_skip_once on step_events (batch_id, (payload->>'timer')) where kind = 'demo_wait_skipped';
