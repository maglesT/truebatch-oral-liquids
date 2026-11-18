-- TrueBatch Tablets Packing's material_use_v1 (owner, 16 Nov 2026, from the run of TP260002): what a packing batch
-- used of a lot is what was issued to it less what its reconciliation returned to stores uncoded. Same columns, same
-- rows (one per signed issue step, pack-material-issue); only the meaning of quantity changes:
--   quantity = the quantity issued − "Returned to stores uncoded" of the printed-reconciliation step of the same
--              material in the same batch, once that reconciliation is signed done (before it: the quantity issued);
-- destroyed and batch-coded material stays used. MMS takes quantity off the lot (MMS D-58), so the material returned
-- to stores is back in its available stock with no change in MMS. A material without a reconciliation (not printed)
-- is used as issued. The returned quantity is taken off only in the unit it was issued in (both are the material's
-- unit in the master). data_as_of is the later of the issue's and the reconciliation's last event.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view material_use_v1 with (security_barrier) as
select b.batch_no as batch_number, cur.lot as lot_number, m.m->>'code' as material_code, m.m->>'materialItemId' as material_master_id,
  q.quantity, q.unit, ev.done_at as dispensed_at,
  (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
  case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, greatest(ev.last, ret.last) as data_as_of,
  coalesce(ev.place, (v.doc->'stages'->s.stage->>'name') || ' › ' || (st.step->>'key')) as step_name
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
  select n.id as event_id, n.payload->'values'->'issued' as issued,
    (select x.payload->'values'->>'lot' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
       and x.round = s.round and x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot' order by x.id desc limit 1) as lot
  from step_events n where n.batch_id = s.batch_id and n.stage = s.stage and n.sub = s.sub and n.step = s.step and n.round = s.round
    and n.kind in ('value', 'corrected') and n.payload->'values' ? 'issued' order by n.id desc limit 1
) cur
-- The reconciliation of the same material, signed done: its current "returned to stores uncoded".
left join lateral (
  select (rv.returned->>'value')::numeric as n, rv.last
  from jsonb_array_elements(v.doc->'stages') with ordinality rs(stage, si)
  cross join lateral jsonb_array_elements(rs.stage->'steps') with ordinality rt(step, ti)
  cross join lateral (
    select (array_agg(y.payload->'values'->'returned' order by y.id desc) filter (where y.kind in ('value', 'corrected') and y.payload->'values' ? 'returned'))[1] as returned,
      bool_or(y.kind = 'done') as done, max(y.at) as last
    from step_events y where y.batch_id = s.batch_id and y.stage = rs.si - 1 and y.step = rt.ti - 1
  ) rv
  where rt.step->'block'->>'id' = 'printed-reconciliation'
    and rt.step->'settings'->'material'->>'formula' = st.step->'settings'->'material'->>'formula'
    and rv.done and rv.returned->>'unit' = cur.issued->>'unit'
  limit 1
) ret on true
cross join lateral (select (cur.issued->>'value')::numeric - coalesce(ret.n, 0) as n, cur.issued->>'unit' as u, ev.stock_unit as su) r
cross join lateral (select
  case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
  case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
       when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
       else r.u end as unit) q
left join lateral (
  select l as m from jsonb_array_elements(v.doc->'pack'->'materials') l where l->>'key' = st.step->'settings'->'material'->>'formula'
) m on true
where st.step->'block'->>'id' = 'pack-material-issue';

reset search_path;
