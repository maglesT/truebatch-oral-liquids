-- A machine or room is in use by the stage that names it, until the stage is closed (owner, 15 Nov 2026: the Logbook
-- marks it dirty after the stage, not after each step). The engine works out when a stage closes (every step done,
-- checked or not applicable, shared/engine/batch.ts); the action that closes it records that once, as the batch event
-- 'stage_closed' (payload.stage: its position in the master), for the views other products read (equipment_use_v1).
-- TrueBatch Tablets Packing runs this too.
alter table batch_events drop constraint batch_events_kind_check;
alter table batch_events add constraint batch_events_kind_check check (kind in ('production_approved', 'qc_approved', 'released', 'rejected',
  'deviation_closed', 'stage_closed'));
drop index batch_events_once;
create unique index batch_events_once on batch_events (batch_id, (case when kind = 'rejected' then 'released' else kind end))
  where kind not in ('deviation_closed', 'stage_closed');
create unique index batch_events_stage_once on batch_events (batch_id, (payload->>'stage')) where kind = 'stage_closed';

-- Batches recorded before this migration: a stage is taken as closed at its last done, checked or not-applicable event
-- once a later stage has started (stages open in order; a preparation is closed before the stage that uses it).
insert into batch_events (batch_id, kind, payload, person_id, at)
select d.batch_id, 'stage_closed', jsonb_build_object('stage', d.stage), d.person_id, d.at
from (
  select distinct on (e.batch_id, e.stage) e.batch_id, e.stage, e.person_id, e.at
  from step_events e
  where e.kind in ('done', 'checked', 'not_applicable') and e.person_id is not null
    and exists (select 1 from step_events w where w.batch_id = e.batch_id and w.stage > e.stage and w.kind = 'started')
  order by e.batch_id, e.stage, e.id desc
) d;
