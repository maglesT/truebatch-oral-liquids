-- Tablets round 34 (found by the LIMS build session in its copy of this engine): the batches table is the one record
-- table without an insert-only trigger. The app role cannot change it (grants), but the database owner could UPDATE,
-- DELETE or TRUNCATE a batch row. The app never changes a batch row after issuing it (status and everything else live
-- in the insert-only batch_events / step_events), so batches gets the same guard as the other record tables.
create trigger batches_insert_only before update or delete or truncate on batches
  for each statement execute function refuse_change();
