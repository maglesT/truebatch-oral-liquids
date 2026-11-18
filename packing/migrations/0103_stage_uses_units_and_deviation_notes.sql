-- TrueBatch Tablets Packing's published views, as TrueBatch Tablets' (db/migrations/0011, 0008), owner 15 Nov 2026 from
-- the run of TP260001. Columns are only added at the end (create or replace keeps the grants set_link gave).
--
-- equipment_use_v1: ONE use per packing batch and line or room, as TrueBatch Tablets' (db/migrations/0011): from the
-- first start of a step that names it until every stage of the batch that names it, or whose rooms allow its room, has
-- closed (batch event 'stage_closed'), or the production approval or rejection if earlier: the packing line is in use
-- by the batch through its packing and its reconciliation and line clearance, and dirty after the batch. The line named
-- when the batch is issued (bulk-issue: the line the order is for) and in the line clearance after packing (it clears
-- the line the batch has just used) do not start a use, nor does a balance (as TrueBatch Tablets'). step_name added.
-- material_use_v1: the quantity issued in the material's unit in master data, as read when the step was signed done
-- (a count in e.g. nos; grams exactly in kg when master data counts the material in kg); step_name added.
-- deviation_note_v1 (new): every deviation note (a late periodic check, a result out of limits), with the columns of
-- TrueBatch Tablets' view, so the Deviations system files them as it files tablets' notes.
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
  coalesce(u.place, (v.doc->'stages'->u.stage->>'name') || ' › ' || (v.doc->'stages'->u.stage->'steps'->u.step->>'key')) as step_name
from (
  select n.batch_id, (array_agg(n.stage order by n.started_at nulls last, n.stage, n.sub, n.step, n.round))[1] as stage,
    (array_agg(n.step order by n.started_at nulls last, n.stage, n.sub, n.step, n.round))[1] as step,
    (array_agg(n.value order by n.started_at nulls last, n.stage, n.sub, n.step, n.round))[1] as value,
    (array_agg(n.place order by n.started_at nulls last, n.stage, n.sub, n.step, n.round))[1] as place,
    min(n.started_at) as started_at, max(n.at) as last, array_agg(distinct n.stage) as stages
  from (
    select x.batch_id, x.stage, x.sub, x.step, x.round, x.value, x.at, t.started_at, t.place
    from (
      select distinct on (e.batch_id, e.stage, e.sub, e.step, e.round, f.key) e.batch_id, e.stage, e.sub, e.step, e.round, f.value, e.at
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

create or replace view material_use_v1 with (security_barrier) as
select b.batch_no as batch_number, cur.lot as lot_number, m.m->>'code' as material_code, m.m->>'materialItemId' as material_master_id,
  q.quantity, q.unit, ev.done_at as dispensed_at,
  (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
  case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, ev.last as data_as_of,
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
cross join lateral (select (cur.issued->>'value')::numeric as n, cur.issued->>'unit' as u, ev.stock_unit as su) r
cross join lateral (select
  case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
  case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
       when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
       else r.u end as unit) q
left join lateral (
  select l as m from jsonb_array_elements(v.doc->'pack'->'materials') l where l->>'key' = st.step->'settings'->'material'->>'formula'
) m on true
where st.step->'block'->>'id' = 'pack-material-issue';

create view deviation_note_v1 with (security_barrier) as
select n.id as note_id, 'truebatch_packing:note:' || n.id as source_ref, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
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

revoke all on deviation_note_v1 from public;

reset search_path;
