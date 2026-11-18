-- The date of manufacture of a batch (owner, 15 Nov 2026): the plant-time date its FIRST processing step started (the
-- earliest `started` step event), for TrueBatch Tablets Packing's expiry (T27) and the dates printed on the packs.
-- Null until a step has started.
--
-- batch_fact_v1 keeps every column of 0006, in the same order, with the same names and types: manufactured_on is
-- added at the END only (create or replace view allows no other change). The Logbook and Deviations select named
-- columns, so they read TrueBatch as before, and as they read Batchwright's batch_fact_v1, which has no such column.
-- create or replace keeps the grants the platform's set_link gave.
--
-- Plant time: the plant's time zone (DISPLAY_TZ's default, Asia/Kolkata), as the batch number's year.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view batch_fact_v1 with (security_barrier) as
select md5('truebatch:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch:master_version:' || v.id)::uuid as mbr_version_id, 'master-' || v.master_id as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  (s.started at time zone 'Asia/Kolkata')::date as manufactured_on
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

reset search_path;
