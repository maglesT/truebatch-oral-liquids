-- Fix round 21 Nov 2026 (A12, for Medhanta LIMS): master_lab_field_v1, one row per in-process lab test of each master
-- version that is not retired (nor deleted; Liquids 0027): what a batch of that version will ask QC for, so LIMS can write its
-- in-process specification from the master's blocks before any batch raises a lab request. code is exactly the code a
-- lab request names (lab_request_v1 tests[].code): '<block id>.<field>' (a staged list, the block's one test: the block
-- id), with '@<n>' when the block is in the master more than once (n: its occurrence, stages and steps in order;
-- shared/engine/lims.ts ipcCodes). label and unit as the step's lab request gives them (a lab test: as the master names
-- it); individual: the number of values of a list (all stages of a staged list), else null. A test whose unit the master
-- has not set is not asked for (as the lab request). Nothing new is stored: derived from master_versions and their
-- events. lab_field_parameters (not published) is the list of in-process fields of the blocks, as shared/engine/lims.ts
-- labFieldParameters gives it (test/lims.test.ts compares the two), so a new in-process field needs a migration
-- replacing it. LIMS reads this view from every TrueBatch edition: name and columns are the same in each (packing
-- migrates this file too). Columns are only ever added at the end (0006).

create or replace view lab_field_parameters (block, block_name, field, code, label, label_setting, unit, unit_setting, individual) as values
  ('bulk-test', 'Bulk test (hold)', 'ph', 'bulk-test.ph', 'pH', null, 'pH', null, null::int),
  ('bulk-test', 'Bulk test (hold)', 'density', 'bulk-test.density', 'Density', null, 'g/mL', null, null::int),
  ('bulk-test', 'Bulk test (hold)', 'viscosity', 'bulk-test.viscosity', 'Viscosity', null, 'mPa·s', null, null::int),
  ('bulk-test', 'Bulk test (hold)', 'assay', 'bulk-test.assay', 'Assay (% of target)', null, '%', null, null::int),
  ('bulk-test', 'Bulk test (hold)', 'ethanol', 'bulk-test.ethanol', 'Alcohol content', null, '%v/v', null, null::int),
  ('bulk-test', 'Bulk test (hold)', 'preservative', 'bulk-test.preservative', 'Preservative content (% of target)', null, '%', null, null::int),
  ('blend-uniformity', 'Blend uniformity sampling', 'results', 'blend-uniformity.results', 'Content at 10 locations (% of label claim)', null, '%', null, 10),
  ('dissolution', 'Dissolution (QC lab)', 'results', 'dissolution', 'Dissolved, 6 units (% of label claim), then dissolved, 6 more units (% of label claim), then dissolved, 12 more units (% of label claim)', null, '%', null, 24),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test1', 'lab-tests.test1', 'Lab test 1', 'what1', null, 'unit1', null::int),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test2', 'lab-tests.test2', 'Lab test 2', 'what2', null, 'unit2', null::int),
  ('lab-tests', 'In-process lab tests (QC lab)', 'test3', 'lab-tests.test3', 'Lab test 3', 'what3', null, 'unit3', null::int)
;

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  execute format('create schema if not exists %I', rep);
  execute format('revoke all on schema %I from public', rep);
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create view master_lab_field_v1 with (security_barrier) as
with steps as (
  select v.id as version_id, s.stage_no, t.step_no, s.stage, t.step,
    count(*) over (partition by v.id, t.step->'block'->>'id') as times,
    row_number() over (partition by v.id, t.step->'block'->>'id' order by s.stage_no, t.step_no) as occurrence
  from master_versions v
  cross join lateral jsonb_array_elements(v.doc->'stages') with ordinality s(stage, stage_no)
  cross join lateral jsonb_array_elements(s.stage->'steps') with ordinality t(step, step_no)
  where v.state not in ('retired', 'deleted')
)
select v.doc->'header'->>'productCode' as product_code, v.version_no as master_version, v.state as master_state,
  x.stage->>'name' as stage_title,
  coalesce(nullif(x.step->>'name', ''), p.block_name || coalesce(': ' || (
    select l->>'name' from jsonb_each(x.step->'settings') e cross join jsonb_array_elements(v.doc->'formula') l
    where jsonb_typeof(e.value) = 'object' and e.value ? 'formula' and l->>'key' = e.value->>'formula' limit 1), '')) as step_title,
  p.code || case when x.times > 1 then '@' || x.occurrence else '' end as code,
  coalesce(nullif(trim(x.step->'settings'->>p.label_setting), ''), p.label) as label,
  coalesce(p.unit, x.step->'settings'->>p.unit_setting) as unit,
  p.individual,
  greatest(v.created_at, (select max(e.at) from master_events e where e.version_id = v.id)) as data_as_of
from steps x
join master_versions v on v.id = x.version_id
join lab_field_parameters p on p.block = x.step->'block'->>'id'
where coalesce(p.unit, x.step->'settings'->>p.unit_setting, '') <> '';

revoke all on master_lab_field_v1 from public;
comment on view master_lab_field_v1 is 'One row per in-process lab test of each master version that is not retired: product, version, stage and step, the test code as lab_request_v1 names it, label, unit, number of values. For LIMS in-process specifications.';

reset search_path;
