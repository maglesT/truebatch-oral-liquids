-- equipment_use_v1 of TrueBatch Tablets Packing, as TrueBatch Tablets' (db/migrations/0016, whole-suite run, S17): a
-- line or room is in use from the time it was first recorded (pulled and accepted) on a step, not from the start of that
-- step, so a room refused until its changeover cleaning was done no longer overlaps that cleaning in the Logbook.
-- Every column as 0107, in the same order, names and types; everything else as 0107.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view equipment_use_v1 with (security_barrier) as
select b.batch_no as batch_number, u.value->>'code' as equipment_code, u.value->>'type' as equipment_type, u.value->>'room' as room_code,
  (v.doc->'stages'->u.stage->>'key') || '/' || (v.doc->'stages'->u.stage->'steps'->u.step->>'key') as step,
  u.started_at, case when c.closed then least(c.at, d.at) else d.at end as ended_at, now() as read_at, greatest(u.last, c.at, d.at) as data_as_of,
  case when u.clearance_only then v.doc->'stages'->u.stage->>'name'
       else coalesce(u.place, (v.doc->'stages'->u.stage->>'name') || ' › ' || (v.doc->'stages'->u.stage->'steps'->u.step->>'key')) end as step_name
from (
  select n.batch_id, (array_agg(n.stage order by n.started_at desc nulls last, n.stage desc, n.sub desc, n.step desc, n.round desc))[1] as stage,
    (array_agg(n.step order by n.started_at desc nulls last, n.stage desc, n.sub desc, n.step desc, n.round desc))[1] as step,
    (array_agg(n.value order by n.started_at nulls last, n.stage, n.sub, n.step, n.round))[1] as value,
    (array_agg(n.place order by n.started_at desc nulls last, n.stage desc, n.sub desc, n.step desc, n.round desc))[1] as place,
    min(n.recorded_at) as started_at, max(n.at) as last, array_agg(distinct n.stage) as stages, bool_and(n.clearance) as clearance_only
  from (
    select x.batch_id, x.stage, x.sub, x.step, x.round, x.value, x.at, x.recorded_at, t.started_at, t.place,
      coalesce(xv.doc->'stages'->x.stage->'steps'->x.step->'block'->>'id' in ('line-clearance', 'pack-clearance', 'pack-clearance-after'), false) as clearance
    from (
      -- recorded_at: when this item was first recorded in this field of the step (a correction to it keeps that time)
      select distinct on (e.batch_id, e.stage, e.sub, e.step, e.round, f.key) e.batch_id, e.stage, e.sub, e.step, e.round, f.value, e.at,
        min(e.at) over (partition by e.batch_id, e.stage, e.sub, e.step, e.round, f.key, f.value->>'code') as recorded_at
      from step_events e cross join lateral jsonb_each(e.payload->'values') f
      where e.kind in ('value', 'corrected') and jsonb_typeof(f.value) = 'object' and f.value ? 'itemId'
        -- a weighing instrument (a machine whose type names a balance, the rule of shared/engine/picks.ts) is no use
        and not (f.value->>'room' is distinct from f.value->>'code' and lower(coalesce(f.value->>'type', '')) like '%balance%')
      order by e.batch_id, e.stage, e.sub, e.step, e.round, f.key, e.id desc
    ) x
    join batches xb on xb.id = x.batch_id
    join master_versions xv on xv.id = xb.master_version_id
    cross join lateral (
      select min(y.at) as started_at, (array_agg(y.payload->>'where' order by y.id))[1] as place from step_events y
      where y.batch_id = x.batch_id and y.stage = x.stage and y.sub = x.sub and y.step = x.step and y.round = x.round and y.kind = 'started'
    ) t
    where xv.doc->'stages'->x.stage->'steps'->x.step->'block'->>'id' not in ('bulk-issue', 'pack-clearance-after')
  ) n
  group by n.batch_id, n.value->>'code'
) u
join batches b on b.id = u.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (
  select bool_and(z.at is not null) as closed, max(z.at) as at
  from jsonb_array_elements(v.doc->'stages') with ordinality m(st, i)
  left join batch_events z on z.batch_id = u.batch_id and z.kind = 'stage_closed' and z.payload->>'stage' = (m.i - 1)::text
  where (m.i - 1)::int = any(u.stages) or exists (
    select 1 from jsonb_array_elements_text(m.st->'roomTypes') r
    where lower(r) in (lower(u.value->>'room'), lower(coalesce(u.value->>'area', case when u.value->>'room' = u.value->>'code' then u.value->>'type' end))))
) c
left join lateral (
  select min(z.at) as at from batch_events z where z.batch_id = u.batch_id and z.kind in ('production_approved', 'rejected')
) d on true;

reset search_path;
