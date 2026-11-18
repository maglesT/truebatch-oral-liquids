-- TrueBatch Liquids Packing (plan section 4): the bulk is issued by liquid-bulk-issue or powder-bulk-issue and
-- reconciled by liquid-finished-goods or powder-finished-goods. Every column of equipment_use_v1 (as 0110) and of
-- packing_batch_v1 (as 0111) is kept, with its name, type and order; units_per_pack is 1 (one pack is one filled
-- container in its carton). Only the block ids the views look for change.
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
    where xv.doc->'stages'->x.stage->'steps'->x.step->'block'->>'id' not in ('liquid-bulk-issue', 'powder-bulk-issue', 'pack-clearance-after')
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

create or replace view packing_batch_v1 with (security_barrier) as
select md5('truebatch_liquids_packing:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, f.v->>'bulk' as coded_batch_number,
  v.doc->'header'->>'productCode' as product_code, v.doc->'pack'->>'bulkCode' as bulk_product_code, v.doc->'pack'->>'type' as pack_type,
  1 as units_per_pack, f.v->>'mfgDate' as mfg_date, fr.r->'expiry'->>'expiry' as expiry_month,
  (g.v->'packs'->>'value')::numeric as packs, (g.v->'cartons'->>'value')::numeric as cartons,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released, now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  nullif(g.v->'shippers'->>'value', '')::numeric as shippers,
  case when gd.done then round(nullif(g.v->'packs'->>'value', '')::numeric, 0) end as good_quantity, 'packs'::text as good_unit,
  case when gd.done and (gr.r->'yield'->>'ok')::boolean then round(nullif(gr.r->'yield'->>'value', '')::numeric, 2) end as yield_percent,
  rl.at as released_at, rl.by as released_by
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (select max(x.at) as last from step_events x where x.batch_id = b.id) s on true
-- QA's release: the time of the 'released' batch event and the name its e-signature printed (null until released).
left join lateral (
  select x.at, (select g.printed_name from signatures g where g.object_type = 'batch_event' and g.object_id = x.id and g.meaning = 'released') as by
  from batch_events x where x.batch_id = b.id and x.kind = 'released' order by x.id limit 1
) rl on true
left join lateral (
  select (st.i - 1)::int as stage, (sp.j - 1)::int as step
  from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i), jsonb_array_elements(st.x->'steps') with ordinality sp(y, j)
  where sp.y->'block'->>'id' in ('liquid-finished-goods', 'powder-finished-goods') order by st.i, sp.j limit 1
) fg on true
-- The current values of a step instance (round 1, sub 1): the latest value or correction of each field.
left join lateral (
  select jsonb_object_agg(k, val) as v from (
    select distinct on (x.key) x.key as k, x.value as val
    from step_events y cross join lateral jsonb_each(y.payload->'values') x
    where y.batch_id = b.id and y.stage = 0 and y.sub = 1 and y.step = 0 and y.round = 1 and y.kind in ('value', 'corrected')
    order by x.key, y.id desc) q
) f on true
left join lateral (
  select y.payload->'results' as r from step_events y
  where y.batch_id = b.id and y.stage = 0 and y.sub = 1 and y.step = 0 and y.round = 1 and y.payload ? 'results' order by y.id desc limit 1
) fr on true
left join lateral (
  select jsonb_object_agg(k, val) as v from (
    select distinct on (x.key) x.key as k, x.value as val
    from step_events y cross join lateral jsonb_each(y.payload->'values') x
    where y.batch_id = b.id and y.stage = fg.stage and y.sub = 1 and y.step = fg.step and y.round = 1 and y.kind in ('value', 'corrected')
    order by x.key, y.id desc) q
) g on true
-- Whether the finished goods step is done (signed, and not sent back since), and its results as last recorded.
left join lateral (
  select (select z.kind from step_events z where z.batch_id = b.id and z.stage = fg.stage and z.sub = 1 and z.step = fg.step and z.round = 1
    and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done' as done
) gd on true
left join lateral (
  select y.payload->'results' as r from step_events y
  where y.batch_id = b.id and y.stage = fg.stage and y.sub = 1 and y.step = fg.step and y.round = 1 and y.payload ? 'results' order by y.id desc limit 1
) gr on true
where v.doc ? 'pack';

reset search_path;
