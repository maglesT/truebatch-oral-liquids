-- Published views, as people and the other products read them (owner, 15 Nov 2026, from the run of batch TB260003).
--
-- batch_fact_v1: family_code is the master version as its number ("1", not "master-2"); product_name (the master's
-- product name, copied from master data when the master was written, PL-07) and master_version are added at the END
-- only, so readers of Batchwright's named columns read it unchanged.
-- deviation_note_v1: step is where the note was written in words ("Granulation › Granulate to an end point"), as the
-- note recorded it; older notes keep the keys "stage/step". Same columns.
-- material_use_v1 (new): what TrueBatch dispensed, for MMS to reduce the lot's stock by reading it (owner decision):
-- one row per signed weighing step (weigh, lubricate) with its lot, material and current net quantity; status
-- 'corrected' when a value of the step was corrected after it was recorded (quantity is then the corrected one, and
-- event_id the event that gave it, so a reader sees a change).
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view batch_fact_v1 with (security_barrier) as
select md5('truebatch:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch:master_version:' || v.id)::uuid as mbr_version_id, v.version_no::text as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  (s.started at time zone 'Asia/Kolkata')::date as manufactured_on,
  v.doc->'header'->>'productName' as product_name, v.version_no as master_version
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (
  select max(x.at) as last, min(x.at) filter (where x.kind = 'started') as started from step_events x where x.batch_id = b.id
) s on true;

create or replace view deviation_note_v1 with (security_barrier) as
select n.id as note_id, 'truebatch:note:' || n.id as source_ref, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  coalesce(n.payload->>'where', (v.doc->'stages'->n.stage->>'key') || '/' || (v.doc->'stages'->n.stage->'steps'->n.step->>'key')) as step,
  n.payload->>'text' as note, n.payload->>'reference' as reference,
  case when n.payload->>'reference' is null then null when c.at is not null then 'closed' else 'open' end as status,
  n.at as noted_at, now() as read_at, greatest(n.at, c.at) as data_as_of
from step_events n
join batches b on b.id = n.batch_id
join master_versions v on v.id = b.master_version_id
left join lateral (
  select min(x.at) as at from batch_events x where x.batch_id = n.batch_id and x.kind = 'deviation_closed' and x.payload->>'note' = n.id::text
) c on true
where n.kind = 'note';

create view material_use_v1 with (security_barrier) as
select b.batch_no as batch_number, cur.lot as lot_number, line.l->>'code' as material_code, line.l->>'materialItemId' as material_master_id,
  (cur.net->>'value')::numeric as quantity, cur.net->>'unit' as unit, ev.done_at as dispensed_at,
  (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
  case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, ev.last as data_as_of
from (select distinct batch_id, stage, sub, step, round from step_events where kind = 'done') s
join batches b on b.id = s.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step) st
cross join lateral (
  select min(x.at) filter (where x.kind = 'done') as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last
  from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
) ev
cross join lateral (
  select n.id as event_id, n.payload->'results'->'net' as net,
    (select x.payload->'values'->>'lot' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
       and x.round = s.round and x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot' order by x.id desc limit 1) as lot
  from step_events n where n.batch_id = s.batch_id and n.stage = s.stage and n.sub = s.sub and n.step = s.step and n.round = s.round
    and n.payload->'results' ? 'net' order by n.id desc limit 1
) cur
left join lateral (
  select l from jsonb_array_elements(v.doc->'formula') l where l->>'key' = (
    select z.value->>'formula' from jsonb_each(st.step->'settings') z where jsonb_typeof(z.value) = 'object' and z.value ? 'formula' limit 1)
) line on true
where st.step->'block'->>'id' in ('weigh', 'lubricate') and (cur.net->>'ok')::boolean;

revoke all on material_use_v1 from public;

reset search_path;
