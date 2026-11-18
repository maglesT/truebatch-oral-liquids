-- Review and approval of master versions (TB-02): the author sends a draft for review, a second person checks it
-- (passes or returns it), QA approves it with a change control number, and making it effective retires the previous
-- effective version. Each step is one insert-only event; the signed ones are the object of their signature
-- (object_type 'master_event'). The version's state follows the events (master_versions.state, migration 0003).
create table master_events (
  id bigint generated always as identity primary key,
  version_id bigint not null references master_versions(id),
  kind text not null check (kind in ('submitted', 'passed', 'returned', 'approved', 'effective', 'retired')),
  payload jsonb not null default '{}',
  person_id bigint not null references users(id),
  at timestamptz not null default now(),
  -- QA's approval carries the change control number.
  check (kind <> 'approved' or length(trim(coalesce(payload->>'changeControl', ''))) > 0)
);
create index master_events_version on master_events (version_id, id);
-- A version is approved, made effective and retired once.
create unique index master_events_once on master_events (version_id, kind) where kind in ('approved', 'effective', 'retired');
create trigger master_events_insert_only before update or delete or truncate on master_events
  for each statement execute function refuse_change();

-- Review comments on a version, optionally about one item (a path such as "stages[1].steps[2]"). Insert-only.
create table master_comments (
  id bigint generated always as identity primary key,
  version_id bigint not null references master_versions(id),
  path text check (path ~ '^[a-zA-Z0-9_.\[\]]{1,120}$'),
  text text not null check (length(trim(text)) between 1 and 2000),
  person_id bigint not null references users(id),
  at timestamptz not null default now()
);
create index master_comments_version on master_comments (version_id, id);
create trigger master_comments_insert_only before update or delete or truncate on master_comments
  for each statement execute function refuse_change();

revoke all on master_events, master_comments from truebatch_app;   -- the platform's default grants (0000)
revoke all on sequence master_events_id_seq, master_comments_id_seq from truebatch_app;
grant select on master_events, master_comments to truebatch_app;
grant insert (version_id, kind, payload, person_id) on master_events to truebatch_app;
grant insert (version_id, path, text, person_id) on master_comments to truebatch_app;
