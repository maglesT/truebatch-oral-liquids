-- Published views (platform PL-08, PL-13): other products read TrueBatch through platform links, read-only, in the
-- schema `report`. The platform's set_link grants SELECT on a view to a linked reader; nobody else gets anything. The
-- views run with the rights of their owner (the migration login), so a reader needs no table grants. A view is never
-- changed in place: columns are only added at the end; different columns mean a new _v2 view next to the _v1 one.
-- Every row carries read_at (now()) and data_as_of (the newest event the row reflects). The views are security
-- barriers: a reader's own function in a WHERE clause sees only the rows the view returns.
--
-- batch_fact_v1 and equipment_use_v1 have the names and columns of Batchwright's views of the same names, so the
-- Logbook (batch pick list, "used on") and Deviations (batch findings) read TrueBatch as they read Batchwright.
--
-- Schema name: `report` for an installation in the schema `public`. Tests and browser tests migrate into their own
-- schema <s>; their views go to <s>_report so parallel runs never collide.
do $$
declare
  base text := current_schema();
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  execute format('create schema if not exists %I', rep);
  execute format('revoke all on schema %I from public', rep);
  -- For the rest of this migration, new objects go to the report schema (transaction-local; reset at the end).
  perform set_config('search_path', format('%I, %I', rep, base), true);
end $$;

-- One row per batch. Ids are uuids made from TrueBatch's ids (Batchwright's columns are uuids). status: IN_PRODUCTION
-- until production approves the complete record (TB-20), then PRODUCTION_APPROVED, QC_APPROVED, RELEASED or REJECTED;
-- completed_at is that production approval. strength is not in the master document (null). family_code: the master.
create view batch_fact_v1 with (security_barrier) as
select md5('truebatch:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch:master_version:' || v.id)::uuid as mbr_version_id, 'master-' || v.master_id as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (select max(x.at) as last from step_events x where x.batch_id = b.id) s on true;

-- One row per machine or room a step instance records (its current value: a correction replaces it). step: "stage/step"
-- (the keys of the master). A room's row has the room as equipment_code and room_code. started_at: the step started; ended_at: signed done (null while open).
create view equipment_use_v1 with (security_barrier) as
select b.batch_no as batch_number, u.value->>'code' as equipment_code, u.value->>'type' as equipment_type, u.value->>'room' as room_code,
  (v.doc->'stages'->u.stage->>'key') || '/' || (v.doc->'stages'->u.stage->'steps'->u.step->>'key') as step, t.started_at, t.ended_at, now() as read_at, greatest(u.at, t.ended_at) as data_as_of
from (
  select distinct on (e.batch_id, e.stage, e.sub, e.step, e.round, f.key) e.batch_id, e.stage, e.sub, e.step, e.round, f.value, e.at
  from step_events e cross join lateral jsonb_each(e.payload->'values') f
  where e.kind in ('value', 'corrected') and jsonb_typeof(f.value) = 'object' and f.value ? 'itemId'
  order by e.batch_id, e.stage, e.sub, e.step, e.round, f.key, e.id desc
) u
join batches b on b.id = u.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (
  select min(x.at) filter (where x.kind = 'started') as started_at, min(x.at) filter (where x.kind in ('done', 'not_applicable')) as ended_at
  from step_events x where x.batch_id = u.batch_id and x.stage = u.stage and x.sub = u.sub and x.step = u.step and x.round = u.round
) t;

-- Every deviation note, for Deviations to file later (source_ref, as the Logbook's overdue_v1). status is TrueBatch's
-- own: open until QA closes it by hand in TrueBatch, closed after; null for a note without a deviation number.
create view deviation_note_v1 with (security_barrier) as
select n.id as note_id, 'truebatch:note:' || n.id as source_ref, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  (v.doc->'stages'->n.stage->>'key') || '/' || (v.doc->'stages'->n.stage->'steps'->n.step->>'key') as step, n.payload->>'text' as note, n.payload->>'reference' as reference,
  case when n.payload->>'reference' is null then null when c.at is not null then 'closed' else 'open' end as status,
  n.at as noted_at, now() as read_at, greatest(n.at, c.at) as data_as_of
from step_events n
join batches b on b.id = n.batch_id
join master_versions v on v.id = b.master_version_id
left join lateral (
  select min(x.at) as at from batch_events x where x.batch_id = n.batch_id and x.kind = 'deviation_closed' and x.payload->>'note' = n.id::text
) c on true
where n.kind = 'note';

revoke all on batch_fact_v1, equipment_use_v1, deviation_note_v1 from public;

reset search_path;
