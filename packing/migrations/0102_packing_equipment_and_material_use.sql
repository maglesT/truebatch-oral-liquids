-- TrueBatch Tablets Packing publishes what its batches used (owner, 15 Nov 2026, from the demo run), with the names
-- and columns of TrueBatch Tablets' views, so the Logbook and MMS read packing as they read tablets:
-- equipment_use_v1 (the Logbook: the packing line and rooms "used on") as db/migrations/0006_report_views.sql, and
-- material_use_v1 (MMS reduces the packing material lot's stock by reading it, nothing is sent): one row per signed
-- issue step (pack-material-issue) with its lot, the packing material of the master's pack list and the quantity
-- issued, in the material's unit (units, m, g). status 'corrected' when a value of the step was corrected after it was
-- recorded (quantity is then the corrected one, and event_id the event that gave it).

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

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

create view material_use_v1 with (security_barrier) as
select b.batch_no as batch_number, cur.lot as lot_number, m.m->>'code' as material_code, m.m->>'materialItemId' as material_master_id,
  (cur.issued->>'value')::numeric as quantity, cur.issued->>'unit' as unit, ev.done_at as dispensed_at,
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
  select n.id as event_id, n.payload->'values'->'issued' as issued,
    (select x.payload->'values'->>'lot' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
       and x.round = s.round and x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot' order by x.id desc limit 1) as lot
  from step_events n where n.batch_id = s.batch_id and n.stage = s.stage and n.sub = s.sub and n.step = s.step and n.round = s.round
    and n.kind in ('value', 'corrected') and n.payload->'values' ? 'issued' order by n.id desc limit 1
) cur
left join lateral (
  select l as m from jsonb_array_elements(v.doc->'pack'->'materials') l where l->>'key' = st.step->'settings'->'material'->>'formula'
) m on true
where st.step->'block'->>'id' = 'pack-material-issue';

revoke all on equipment_use_v1, material_use_v1 from public;

reset search_path;
