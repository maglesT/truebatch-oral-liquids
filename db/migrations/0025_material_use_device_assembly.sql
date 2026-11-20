-- Round 46: material_use_v1 also lists the component a device assembly step used (block device-assembly: an
-- autoinjector, safety-device or inhaler component from an MMS lot), as it lists a weighing: its lot, its material
-- (the formula line the step names) and its "net" result, here the components used = issued − returned (T1), in
-- 'units', published in master data's count name (nos) as 0011 does. MMS reduces the lot's stock by reading it, with
-- no change there. Same name, columns and meaning (0012), replaced in place; only the blocks listed change.
-- Packing does not migrate this file (its material_use_v1 is its own, packing/migrations).
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view material_use_v1 with (security_barrier) as
select w.batch_number, w.lot_number, w.material_code, w.material_master_id,
  w.quantity - least(w.quantity, greatest(coalesce(w.returned, 0) - coalesce(sum(w.quantity) over (partition by w.batch_id, lower(w.lot_number), w.unit
    order by w.stage desc, w.sub desc, w.step_no desc, w.round desc rows between unbounded preceding and 1 preceding), 0), 0)) as quantity,
  w.unit, w.dispensed_at, w.step, w.event_id, w.status, w.read_at,
  case when w.returned > 0 then greatest(w.data_as_of, w.returned_at) else w.data_as_of end as data_as_of, w.step_name
from (
  select s.batch_id, s.stage, s.sub, s.step as step_no, s.round,
    b.batch_no as batch_number, cur.lot as lot_number, line.l->>'code' as material_code, line.l->>'materialItemId' as material_master_id,
    q.quantity, q.unit, ev.done_at as dispensed_at,
    (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
    case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, ev.last as data_as_of,
    coalesce(ev.place, (v.doc->'stages'->s.stage->>'name') || ' › ' || (st.step->>'key')) as step_name,
    ret.n as returned, ret.at as returned_at
  from (select distinct batch_id, stage, sub, step, round from step_events where kind = 'done') s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step) st
  cross join lateral (
    select min(x.at) filter (where x.kind = 'done') as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last,
      (array_agg(x.payload->>'where' order by x.id) filter (where x.kind = 'started'))[1] as place,
      (array_agg(x.payload->>'stockUnit' order by x.id desc) filter (where x.payload ? 'stockUnit'))[1] as stock_unit
    from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
  ) ev
  cross join lateral (
    select n.id as event_id, n.payload->'results'->'net' as net,
      (select x.payload->'values'->>'lot' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
         and x.round = s.round and x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot' order by x.id desc limit 1) as lot
    from step_events n where n.batch_id = s.batch_id and n.stage = s.stage and n.sub = s.sub and n.step = s.step and n.round = s.round
      and n.payload->'results' ? 'net' order by n.id desc limit 1
  ) cur
  cross join lateral (select (cur.net->>'value')::numeric as n, cur.net->>'unit' as u, ev.stock_unit as su) r
  cross join lateral (select
    case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
    case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
         when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
         else r.u end as unit) q
  left join lateral (
    select l from jsonb_array_elements(v.doc->'formula') l where l->>'key' = (
      select z.value->>'formula' from jsonb_each(st.step->'settings') z where jsonb_typeof(z.value) = 'object' and z.value ? 'formula' limit 1)
  ) line on true
  -- what QA said went back to stores of this lot when terminating the batch
  left join lateral (
    select (x->>'value')::numeric as n, t.at from batch_events t cross join jsonb_array_elements(t.payload->'returns') x
    where t.batch_id = s.batch_id and t.kind = 'rejected' and t.payload ? 'returns' and lower(x->>'lot') = lower(cur.lot) and x->>'unit' = q.unit
    limit 1
  ) ret on true
  where st.step->'block'->>'id' in ('weigh', 'lubricate', 'device-assembly') and (cur.net->>'ok')::boolean
) w;

reset search_path;
