-- TrueBatch Tablets Packing's published view (platform PL-08, PL-13), for MMS to take the packed batch into finished
-- goods later: read-only, in the schema `report` (tests: <schema>_report), granted to a linked reader by the platform's
-- set_link only. Never changed in place: columns are only added at the end. Every row carries read_at and data_as_of.

do $$
declare
  base text := current_schema();
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  execute format('create schema if not exists %I', rep);
  execute format('revoke all on schema %I from public', rep);
  perform set_config('search_path', format('%I, %I', rep, base), true);
end $$;

-- One row per packing batch. coded_batch_number: the bulk batch number printed on the packs; mfg_date and
-- expiry_month (worked out from the approved shelf life, T27) as recorded at issue (the first step, its current
-- values); packs and cartons from the finished goods step. status: IN_PRODUCTION until production approves the record,
-- then PRODUCTION_APPROVED, RELEASED or REJECTED (no QC approval for packing).
create view packing_batch_v1 with (security_barrier) as
select md5('truebatch_packing:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, f.v->>'bulk' as coded_batch_number,
  v.doc->'header'->>'productCode' as product_code, v.doc->'pack'->>'bulkCode' as bulk_product_code, v.doc->'pack'->>'type' as pack_type,
  (v.doc->'pack'->>'unitsPerPack')::int as units_per_pack, f.v->>'mfgDate' as mfg_date, fr.r->'expiry'->>'expiry' as expiry_month,
  (g.v->'packs'->>'value')::numeric as packs, (g.v->'cartons'->>'value')::numeric as cartons,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released, now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (select max(x.at) as last from step_events x where x.batch_id = b.id) s on true
left join lateral (
  select (st.i - 1)::int as stage, (sp.j - 1)::int as step
  from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i), jsonb_array_elements(st.x->'steps') with ordinality sp(y, j)
  where sp.y->'block'->>'id' = 'finished-goods' order by st.i, sp.j limit 1
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
where v.doc ? 'pack';

revoke all on packing_batch_v1 from public;

reset search_path;
