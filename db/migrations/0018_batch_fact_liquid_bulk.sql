-- batch_fact_v1 for liquids (plan data change 2, TL-17, TL-18). Every column as 0017, with:
--   good_quantity, good_unit: the bulk from the master's last yield step (bulk-yield, bulk-yield-weight, or stage-yield
--     of a dry syrup powder): its output as recorded or worked out, in L or kg (3 decimals); null before that step is done;
--   yield_percent: that step's yield;
--   bulk_ready_at (new, at the end): when the master's last stage closed (the end of manufacturing; the bulk hold runs
--     from here to the end of filling, CHECK-L3);
--   bulk_hold_hours (new, at the end): the hold of the master's last intermediate (the bulk), from the master version.
-- Liquids Packing reads both (TL-P2: issue refused after the hold; filling that ends after it needs a deviation note).

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view batch_fact_v1 with (security_barrier) as
select md5('truebatch_liquids:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch_liquids:master_version:' || v.id)::uuid as mbr_version_id, v.version_no::text as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  (s.started at time zone 'Asia/Kolkata')::date as manufactured_on,
  v.doc->'header'->>'productName' as product_name, v.version_no as master_version,
  round(nullif(y.output->>'value', '')::numeric, 3) as good_quantity, y.output->>'unit' as good_unit,
  round(nullif(y.r->'yield'->>'value', '')::numeric, 2) as yield_percent,
  rl.at as released_at, rl.by as released_by,
  rd.at as bulk_ready_at,
  (select (st.x->'produces'->>'holdHours')::numeric from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i)
     where st.x ? 'produces' order by st.i desc limit 1) as bulk_hold_hours
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (
  select max(x.at) as last, min(x.at) filter (where x.kind = 'started') as started from step_events x where x.batch_id = b.id
) s on true
left join lateral (
  select x.at, (select g.printed_name from signatures g where g.object_type = 'batch_event' and g.object_id = x.id and g.meaning = 'released') as by
  from batch_events x where x.batch_id = b.id and x.kind = 'released' order by x.id limit 1
) rl on true
-- The end of manufacturing: the master's last stage closed.
left join lateral (
  select x.at from batch_events x where x.batch_id = b.id and x.kind = 'stage_closed'
    and (x.payload->>'stage')::int = jsonb_array_length(v.doc->'stages') - 1 order by x.id limit 1
) rd on true
-- The batch's bulk yield (the master's last yield step): its values and results as last recorded, once the step is
-- done (signed, and not sent back since); null before.
left join lateral (
  select (st.i - 1)::int as stage, (sp.j - 1)::int as step
  from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i), jsonb_array_elements(st.x->'steps') with ordinality sp(y, j)
  where sp.y->'block'->>'id' in ('bulk-yield', 'bulk-yield-weight', 'stage-yield') order by st.i desc, sp.j desc limit 1
) tr on true
left join lateral (
  select r.r, coalesce(vl.v->'output', r.r->'output') as output
  from (select (select z.kind from step_events z where z.batch_id = b.id and z.stage = tr.stage and z.step = tr.step
                 and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done' as ok) dn,
  lateral (select jsonb_object_agg(k, val) filter (where (val->>'ok')::boolean) as r from (
      select distinct on (x.key) x.key as k, x.value as val
      from step_events y cross join lateral jsonb_each(y.payload->'results') x
      where dn.ok and y.batch_id = b.id and y.stage = tr.stage and y.step = tr.step and y.payload ? 'results'
      order by x.key, y.id desc) q) r,
  lateral (select jsonb_object_agg(k, val) as v from (
      select distinct on (x.key) x.key as k, x.value as val
      from step_events y cross join lateral jsonb_each(y.payload->'values') x
      where dn.ok and y.batch_id = b.id and y.stage = tr.stage and y.step = tr.step and y.payload ? 'values'
      order by x.key, y.id desc) q) vl
) y on true;

reset search_path;
