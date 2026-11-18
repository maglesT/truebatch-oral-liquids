-- Master versions, batches and the batch's step events.

-- A master version is one JSON document (shared/master/schema.ts). Versions of one master share master_id. Only a
-- draft may change: once a version leaves draft its document is locked by the database, and approved, effective and
-- retired versions never go back to draft.
create sequence master_ids;
create table master_versions (
  id bigint generated always as identity primary key,
  master_id bigint not null default nextval('master_ids'),
  version_no integer not null check (version_no >= 1),
  state text not null default 'draft' check (state in ('draft', 'in_review', 'approved', 'effective', 'retired')),
  doc jsonb not null,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  unique (master_id, version_no)
);
-- One draft and one effective version per master at a time.
create unique index master_versions_one_draft on master_versions (master_id) where state = 'draft';
create unique index master_versions_one_effective on master_versions (master_id) where state = 'effective';

create function refuse_change_unless_draft() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'master version % cannot be removed', old.id using errcode = 'P0001';
  end if;
  if old.state <> 'draft' and new.doc is distinct from old.doc then
    raise exception 'master version % is % and cannot be changed', old.id, old.state using errcode = 'P0001';
  end if;
  if new.state <> old.state and (old.state, new.state) not in (('draft', 'in_review'), ('in_review', 'draft'),
      ('in_review', 'approved'), ('approved', 'effective'), ('effective', 'retired')) then
    raise exception 'master version % cannot go from % to %', old.id, old.state, new.state using errcode = 'P0001';
  end if;
  if new.master_id <> old.master_id or new.version_no <> old.version_no or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'master version % keeps its identity', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger master_versions_locked before update or delete on master_versions
  for each row execute function refuse_change_unless_draft();

-- TB-03: batch numbers come from one counter per year and are never reused (batch_no is unique).
create table batch_counters (
  year integer primary key,
  last_no integer not null check (last_no >= 1)
);

-- A batch is an issued copy of one effective master version; the version itself is immutable, so it is not copied.
create table batches (
  id bigint generated always as identity primary key,
  batch_no text not null unique,
  master_version_id bigint not null references master_versions(id),
  issued_by bigint not null references users(id),
  issued_at timestamptz not null default now()
);

-- The only store of step state. Insert-only, like the audit trail: each start, value, signature, correction, note
-- or timer finding is one row; the state is computed from them (shared/engine). A signed event is the object of its
-- signature (object_type 'step_event').
create table step_events (
  id bigint generated always as identity primary key,
  batch_id bigint not null references batches(id),
  stage integer not null check (stage >= 0),
  sub integer not null check (sub >= 1),
  step integer not null check (step >= 0),
  round integer not null check (round >= 1),
  kind text not null check (kind in ('started', 'value', 'done', 'checked', 'sent_back', 'corrected', 'not_applicable',
    'late', 'qa_released_hold', 'note')),
  payload jsonb not null default '{}',
  person_id bigint references users(id),
  at timestamptz not null default now(),
  check ((person_id is null) = (kind = 'late'))
);
create index step_events_batch on step_events (batch_id, id);
-- The timer job records each overrun once.
create unique index step_events_late_once on step_events (batch_id, (payload->>'timer')) where kind = 'late';
create trigger step_events_insert_only before update or delete or truncate on step_events
  for each statement execute function refuse_change();

revoke all on master_versions, batch_counters, batches, step_events from truebatch_app;   -- the platform's default grants (0000)
revoke all on sequence master_ids, master_versions_id_seq, batches_id_seq, step_events_id_seq from truebatch_app;
grant usage on sequence master_ids to truebatch_app;
grant select on master_versions to truebatch_app;
grant insert (master_id, version_no, doc, created_by) on master_versions to truebatch_app;
grant update (doc, state) on master_versions to truebatch_app;
grant select, insert, update (last_no) on batch_counters to truebatch_app;
grant select on batches to truebatch_app;
grant insert (batch_no, master_version_id, issued_by) on batches to truebatch_app;
grant select on step_events to truebatch_app;
grant insert (batch_id, stage, sub, step, round, kind, payload, person_id) on step_events to truebatch_app;
