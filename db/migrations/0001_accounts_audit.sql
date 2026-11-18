-- People, sessions and the audit trail (platform PL-01, PL-06).

-- The application connects as truebatch_app. On the platform, init creates it as a login; standalone, the owner login
-- switches to it (DB_APP_ROLE). Migrations run as the database owner.
do $$
begin
  if not exists (select from pg_roles where rolname = 'truebatch_app') then
    create role truebatch_app nologin;
  end if;
end $$;
do $$
begin
  execute format('grant usage on schema %I to truebatch_app', current_schema());
end $$;

-- People are core's. `users` is only the id map that signatures and the audit trail refer to: one row per core
-- employee, created at first sign-on. The login is unique and never changes; no passwords are kept here.
create table users (
  id bigint generated always as identity primary key,
  employee_id uuid not null unique,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  full_name text not null check (length(trim(full_name)) > 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- A session keeps this product's permission codes from core's token and the tokens to renew them; renewals re-check
-- core's permission register at least every 5 minutes. Only a hash of the session id is stored.
create table sessions (
  id text primary key,
  user_id bigint not null references users(id),
  permissions text[] not null default '{}',
  refresh_token text,
  id_token text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);

-- PL-06: one audit trail, written by the server in the same transaction as the change. Insert-only: the app role may
-- only add rows and cannot choose their id or time, and a trigger refuses any change or removal, by anyone.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id bigint references users(id),
  action text not null,
  object_type text not null,
  object_id text,
  old_value jsonb,
  new_value jsonb,
  reason text
);
create index audit_log_object on audit_log (object_type, object_id);

create function refuse_change() returns trigger language plpgsql as $$
begin
  raise exception '% is insert-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger audit_log_insert_only before update or delete or truncate on audit_log
  for each statement execute function refuse_change();

revoke all on users, sessions, audit_log from truebatch_app;   -- the platform's default grants (0000)
revoke all on sequence users_id_seq, audit_log_id_seq from truebatch_app;   -- identity columns need no sequence right
grant select, insert on users to truebatch_app;
grant update (full_name, last_login_at) on users to truebatch_app;
grant select, insert, update, delete on sessions to truebatch_app;
grant select on audit_log to truebatch_app;
grant insert (actor_id, action, object_type, object_id, old_value, new_value, reason) on audit_log to truebatch_app;
