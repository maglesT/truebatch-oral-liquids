-- Round 45 (agreed with LIMS: its in-process specification is per PRODUCT and maps each in-process test by a code):
-- lab_request_v1's tests carry a `code`, unique within the master, which LIMS's result_v1 names back as ipc_code (the
-- result then fills only the field of that code: shared/engine/lims.ts ipcCodes, answersField). Same name and columns
-- (0020, 0021), replaced in place; nothing new is stored (the step and batch events stay insert-only, 0019): the codes
-- are kept with the "started" event's lab request (server/routes/batches.ts labRequestOf).
--   tests: [{ code, name, label, unit, individual, stages }]:
--   code '<block id>.<field name>' ('bulk-test.assay', 'blend-uniformity.results'); content uniformity, one
--   test in two stages, 'content-uniformity'; '@<n>' added when the block is in the master more than once (n: its
--   occurrence in order: 'blend-uniformity.results@2'). A request opened before round 45 has code null (LIMS matches
--   it by name, as before).
--   Content uniformity is ONE test: name 'results' (its first stage's field), individual 30, stages [10, 20]; a
--   30-value result fills both stages, a 10-value result the first.
-- LIMS reads this view from every TrueBatch edition as its own link: name and columns are the same in each (packing
-- migrates this file too). Columns are only ever added at the end (0006).

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view lab_request_v1 with (security_barrier) as
select q.request_id, b.batch_no, v.doc->'header'->>'productCode' as product_code,
  s.payload->'labRequest'->>'stage' as stage_title, q.step_key, s.payload->'labRequest'->>'step' as step_title,
  (select coalesce(jsonb_agg(case when e.tt ? 'code' then e.tt else e.tt || '{"code": null}' end order by e.i), '[]')
    from jsonb_array_elements(s.payload->'labRequest'->'tests') with ordinality e(tt, i)) as tests, s.at as requested_at,
  case when p.picked_at is not null or h.typed_at is not null then 'done'
    when t.na_at is not null or t.closed_at is not null or r.at is not null then 'cancelled' else 'open' end as status,
  now() as read_at, greatest(s.at, p.picked_at, h.typed_at, t.na_at, t.closed_at, r.at) as data_as_of
from step_events s
join batches b on b.id = s.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (select concat_ws('.', s.stage, s.sub, s.step, s.round) as step_key) k
cross join lateral (select b.batch_no || '/' || k.step_key as request_id, k.step_key) q
-- This round not applicable; or the step's rounds ended (the "done" event of the round that ended them has labClosed).
cross join lateral (
  select min(x.at) filter (where x.kind = 'not_applicable' and x.round = s.round) as na_at,
    min(x.at) filter (where x.kind = 'done' and x.payload->>'labClosed' = 'true') as closed_at
  from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
) t
-- Done: a round of the step picked a result of this request (the same or a later round).
left join lateral (
  select min(x.at) as picked_at from step_events x cross join jsonb_each(coalesce(x.payload->'source', '{}')) e
  where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.kind in ('value', 'corrected')
    and jsonb_typeof(e.value) = 'object' and lower(e.value->>'request') = lower(q.request_id)
) p on true
-- Done: this round's in-process test typed by hand from the QC report (LIMS off or down).
left join lateral (
  select min(x.at) as typed_at from step_events x cross join jsonb_array_elements(s.payload->'labRequest'->'tests') tt
  where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round and x.kind in ('value', 'corrected')
    and x.payload->'values' ? (tt->>'name') and x.payload->'source'->(tt->>'name')->>'from' = 'hand'
) h on true
-- The batch rejected or terminated, or its record approved by production (closed to changes): nothing more is sampled.
left join lateral (select min(x.at) as at from batch_events x where x.batch_id = s.batch_id and x.kind in ('rejected', 'production_approved')) r on true
where s.kind = 'started' and jsonb_typeof(s.payload->'labRequest'->'tests') = 'array';

revoke all on lab_request_v1 from public;
comment on column lab_request_v1.tests is 'The in-process tests of the request: [{code, name, label, unit, individual, stages}]. code: unique within the master (<block id>.<field name>, content-uniformity; @<n> for a block in the master more than once), named back by result_v1.ipc_code; null for a request opened before round 45. stages: the values of each stage of a staged list (content uniformity [10, 20]).';

reset search_path;
