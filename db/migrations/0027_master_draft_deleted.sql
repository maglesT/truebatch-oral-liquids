-- Fix round 21 Nov 2026 (A4): a draft master version can be deleted by its author's colleagues with the author
-- permission (a draft is never effective, so no batch was ever issued from it). Nothing is removed: the version keeps
-- its rows (and its insert-only events and comments) and goes to the state 'deleted', with a 'deleted' event carrying
-- the reason. A deleted version is no longer listed and cannot change again. Only a draft can be deleted.
alter table master_versions drop constraint master_versions_state_check;
alter table master_versions add constraint master_versions_state_check
  check (state in ('draft', 'in_review', 'approved', 'effective', 'retired', 'deleted'));

create or replace function refuse_change_unless_draft() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'master version % cannot be removed', old.id using errcode = 'P0001';
  end if;
  if old.state <> 'draft' and new.doc is distinct from old.doc then
    raise exception 'master version % is % and cannot be changed', old.id, old.state using errcode = 'P0001';
  end if;
  if new.state <> old.state and (old.state, new.state) not in (('draft', 'in_review'), ('in_review', 'draft'),
      ('in_review', 'approved'), ('approved', 'effective'), ('effective', 'retired'), ('draft', 'deleted')) then
    raise exception 'master version % cannot go from % to %', old.id, old.state, new.state using errcode = 'P0001';
  end if;
  if new.master_id <> old.master_id or new.version_no <> old.version_no or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'master version % keeps its identity', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table master_events drop constraint master_events_kind_check;
alter table master_events add constraint master_events_kind_check
  check (kind in ('submitted', 'passed', 'returned', 'approved', 'effective', 'retired', 'deleted'));
-- A version is deleted once, with its reason.
drop index master_events_once;
create unique index master_events_once on master_events (version_id, kind) where kind in ('approved', 'effective', 'retired', 'deleted');
alter table master_events add constraint master_events_deleted_reason
  check (kind <> 'deleted' or length(trim(coalesce(payload->>'reason', ''))) > 0);
