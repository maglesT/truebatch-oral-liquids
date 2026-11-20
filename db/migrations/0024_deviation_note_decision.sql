-- deviation_note_v1 (owner decision 20 Nov 2026, migration 0024; Tablets 0025): two new last columns, every other column as 0008
-- (create or replace keeps the grants the platform's set_link gave):
--   decision: for a note without a deviation number, 'open' (no decision yet), 'closed' (closed here, in the batch
--             record) or 'sent' (sent to Deviations); null for a note written with a number (a deviation already);
--   sent_at:  when the note was sent to Deviations; null otherwise. The Deviations system files only notes with sent_at.
-- Not run for TrueBatch Liquids Packing (packing/migrations/0114 is its own view).
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view deviation_note_v1 with (security_barrier) as
select n.id as note_id, 'truebatch_liquids:note:' || n.id as source_ref, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  coalesce(n.payload->>'where', (v.doc->'stages'->n.stage->>'key') || '/' || (v.doc->'stages'->n.stage->'steps'->n.step->>'key')) as step,
  n.payload->>'text' as note, n.payload->>'reference' as reference,
  case when n.payload->>'reference' is null then null when c.at is not null then 'closed' else 'open' end as status,
  n.at as noted_at, now() as read_at, greatest(n.at, c.at, x.at) as data_as_of,
  case when n.payload->>'reference' is not null then null when x.kind = 'exception_closed' then 'closed' when x.kind = 'exception_sent' then 'sent' else 'open' end as decision,
  case when x.kind = 'exception_sent' then x.at end as sent_at
from step_events n
join batches b on b.id = n.batch_id
join master_versions v on v.id = b.master_version_id
left join lateral (
  select min(x.at) as at from batch_events x where x.batch_id = n.batch_id and x.kind = 'deviation_closed' and x.payload->>'note' = n.id::text
) c on true
left join lateral (
  select e.kind, e.at from batch_events e where e.batch_id = n.batch_id and e.kind in ('exception_closed', 'exception_sent') and e.payload->>'note' = n.id::text
  order by e.id limit 1
) x on true
where n.kind = 'note';

reset search_path;
