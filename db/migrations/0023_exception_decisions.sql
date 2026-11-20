-- Owner decision 20 Nov 2026: the Deviations system no longer files a deviation note without a number on its own. Such a
-- note is an exception of the batch record, and a person holding <product>.exception.decide chooses once:
--   'exception_closed': closed here, with a reason and an e-signature (meaning 'exception_closed'), kept in the record;
--   'exception_sent':   sent to Deviations, which then files it (deviation_note_v1.sent_at), no signature.
-- payload.note is the note's step event id. One decision per note. TrueBatch Liquids Packing runs this too (Tablets 0024).
alter table batch_events drop constraint batch_events_kind_check;
alter table batch_events add constraint batch_events_kind_check check (kind in ('production_approved', 'qc_approved', 'released', 'rejected',
  'deviation_closed', 'stage_closed', 'exception_closed', 'exception_sent'));
drop index batch_events_once;
create unique index batch_events_once on batch_events (batch_id, (case when kind = 'rejected' then 'released' else kind end))
  where kind not in ('deviation_closed', 'stage_closed', 'exception_closed', 'exception_sent');
create unique index batch_events_exception_once on batch_events (batch_id, (payload->>'note')) where kind in ('exception_closed', 'exception_sent');

alter table signatures drop constraint signatures_meaning_check;
alter table signatures add constraint signatures_meaning_check check (meaning in ('prepared', 'checked', 'approved',
  'issued', 'performed', 'verified', 'production_approved', 'qc_approved', 'released', 'rejected', 'exception_closed'));
