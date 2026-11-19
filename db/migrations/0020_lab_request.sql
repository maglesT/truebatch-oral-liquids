-- Round 42 (owner: in-process lab tests are picked from Medhanta LIMS, not typed): lab_request_v1, one row per
-- in-process lab request, read by LIMS to receive the sample. A step whose block has in-process QC fields (qc
-- 'in_process': blend uniformity, the liquid bulk test) opens its request when it starts: the "started" event keeps the
-- request's stage and step in words and its tests (server/routes/batches.ts labRequestOf). Nothing new is stored: the
-- view is derived from the insert-only step and batch events, so the batches table stays insert-only (0019).
--   request_id: '<batch number>/<step key>' (stage.sub-batch.step.round: a repeated round or sub-batch has its own);
--   tests: [{ name, label, unit, individual }]: individual is the number of values a list takes, else null;
--   status: open; done once the step is signed as performed; cancelled when the step is set not applicable, or the
--   batch is rejected or terminated, before it was signed.
-- LIMS reads this view from every TrueBatch edition as its own link: name and columns are the same in each (packing
-- migrates this file too). Columns are only ever added at the end (0006).

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  execute format('create schema if not exists %I', rep);
  execute format('revoke all on schema %I from public', rep);
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create view lab_request_v1 with (security_barrier) as
select b.batch_no || '/' || concat_ws('.', s.stage, s.sub, s.step, s.round) as request_id, b.batch_no, v.doc->'header'->>'productCode' as product_code,
  s.payload->'labRequest'->>'stage' as stage_title, concat_ws('.', s.stage, s.sub, s.step, s.round) as step_key,
  s.payload->'labRequest'->>'step' as step_title, s.payload->'labRequest'->'tests' as tests, s.at as requested_at,
  case when t.done_at is not null then 'done' when t.na_at is not null or r.at is not null then 'cancelled' else 'open' end as status,
  now() as read_at, greatest(s.at, t.done_at, t.na_at, case when t.done_at is null then r.at end) as data_as_of
from step_events s
join batches b on b.id = s.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (
  select min(x.at) filter (where x.kind = 'done') as done_at, min(x.at) filter (where x.kind = 'not_applicable') as na_at
  from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
) t
left join lateral (select min(x.at) as at from batch_events x where x.batch_id = s.batch_id and x.kind = 'rejected') r on true
where s.kind = 'started' and jsonb_typeof(s.payload->'labRequest'->'tests') = 'array';

revoke all on lab_request_v1 from public;

reset search_path;
