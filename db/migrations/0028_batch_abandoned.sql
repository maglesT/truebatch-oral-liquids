-- Fix round 21 Nov 2026 (A5): production abandons a batch issued by mistake, before any step is recorded. It is a
-- terminated batch (a batch event 'rejected' with terminated and abandoned in its payload: every published view treats
-- it as a terminated batch), signed with its own meaning 'abandoned' by a person holding truebatch_liquids.batch.issue
-- (server/signatures.ts MEANING_NEEDS).
alter table signatures drop constraint signatures_meaning_check;
alter table signatures add constraint signatures_meaning_check check (meaning in ('prepared', 'checked', 'approved',
  'issued', 'performed', 'verified', 'production_approved', 'qc_approved', 'released', 'rejected', 'exception_closed', 'abandoned'));
