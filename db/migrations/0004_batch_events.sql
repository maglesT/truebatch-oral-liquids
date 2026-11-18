-- Batch-level events: production approval, QC approval, release or rejection, and QA closing a deviation note. The
-- batch status is computed from them and the step events (shared/engine/release.ts). Insert-only, like step_events;
-- each signed event is the object of its signature (object_type 'batch_event').
create table batch_events (
  id bigint generated always as identity primary key,
  batch_id bigint not null references batches(id),
  kind text not null check (kind in ('production_approved', 'qc_approved', 'released', 'rejected', 'deviation_closed')),
  payload jsonb not null default '{}',
  person_id bigint not null references users(id),
  at timestamptz not null default now()
);
create index batch_events_batch on batch_events (batch_id, id);
-- Each approval once per batch, and a batch is released or rejected, never both; each deviation note closed once.
create unique index batch_events_once on batch_events (batch_id, (case when kind = 'rejected' then 'released' else kind end))
  where kind <> 'deviation_closed';
create unique index batch_events_closed_once on batch_events (batch_id, (payload->>'note')) where kind = 'deviation_closed';
create trigger batch_events_insert_only before update or delete or truncate on batch_events
  for each statement execute function refuse_change();

revoke all on batch_events from truebatch_app;   -- the platform's default grants (0000)
revoke all on sequence batch_events_id_seq from truebatch_app;
grant select on batch_events to truebatch_app;
grant insert (batch_id, kind, payload, person_id) on batch_events to truebatch_app;

-- QA's rejection is an e-signature too (server/signatures.ts).
alter table signatures drop constraint signatures_meaning_check;
alter table signatures add constraint signatures_meaning_check check (meaning in ('prepared', 'checked', 'approved',
  'issued', 'performed', 'verified', 'production_approved', 'qc_approved', 'released', 'rejected'));
