-- Electronic signatures (platform PL-05) and the protection of signed records (PL-06).

-- Each signature names its signer, meaning and server time, and holds a hash of exactly what was signed, so it cannot
-- be moved to other content. Insert-only, like the audit trail. The meanings are those of server/signatures.ts.
create table signatures (
  id bigint generated always as identity primary key,
  object_type text not null check (object_type ~ '^[a-z][a-z_]{0,39}$'),
  object_id bigint not null,
  user_id bigint not null references users(id),
  printed_name text not null check (length(trim(printed_name)) > 0),
  meaning text not null check (meaning in ('prepared', 'checked', 'approved', 'issued', 'performed', 'verified',
    'production_approved', 'qc_approved', 'released')),
  signed_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  unique (object_type, object_id, meaning)
);
create trigger signatures_insert_only before update or delete or truncate on signatures
  for each statement execute function refuse_change();

-- Each signing proof from core's re-authentication is spent by the save that stores its signature(s): once, in one
-- transaction (tx). One save may carry two signatures of the same person.
create table signing_proofs (
  nonce text primary key,
  user_id bigint not null references users(id),
  tx bigint not null default txid_current(),
  used_at timestamptz not null default now()
);

-- Locked rows: a record table whose rows the app may update while they are drafts attaches this trigger with its
-- signature object type, e.g.
--   create trigger step_locked_when_signed before update or delete on step
--     for each row execute function refuse_change_when_signed('step');
-- Once a row carries any signature, the database refuses to change or remove it, whoever asks.
create function refuse_change_when_signed() returns trigger language plpgsql as $$
begin
  if exists (select 1 from signatures where object_type = tg_argv[0] and object_id = old.id) then
    raise exception '% % is signed and cannot be changed', tg_argv[0], old.id using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on signatures, signing_proofs from truebatch_app;   -- the platform's default grants (0000)
revoke all on sequence signatures_id_seq from truebatch_app;   -- identity columns need no sequence right
-- Signature time and id come only from the database.
grant select on signatures to truebatch_app;
grant insert (object_type, object_id, user_id, printed_name, meaning, content_hash) on signatures to truebatch_app;
grant select, insert on signing_proofs to truebatch_app;
grant update (used_at) on signing_proofs to truebatch_app;
