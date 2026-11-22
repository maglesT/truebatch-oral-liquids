# TrueBatch Oral Liquids: design decisions

Owner decisions of 15 November 2026. Built the Logbook way (the platform Logbook is the model for structure, patterns
and size), not the Batchwright way.

## Product
- **One product per dosage form.** TrueBatch Oral Liquids covers manufacturing, from dispensing to QA release of bulk
  tablets. Packing is a separate product, "TrueBatch Oral Liquids Packing", in this repository on the same engine
  (`docs/packing-design.md`).

## Platform
- Runs on the Medhanta platform. Core provides people, sign-in, permissions, e-signature re-authentication and master
  data. Normal platform sign-in (OIDC through core, one person per browser).
- Optional links: MMS (lots, status, assay, LOD), Logbook (equipment and room status), Deviations, QMS (change
  control numbers). Every link has a hand-entry fallback with a second-person check.
- Sessions as the Logbook's: 15 minutes idle (background polls never count); a tap or a key on the screen counts as
  use (at most one renewal a minute); the session ends with core's sign-on (8 hours).

## Links
Owner decisions of 15 November 2026. Built as the Logbook's link clients: one client (`server/links.ts`) reads each
provider's report views live through `<PROVIDER>_DATABASE_URL`, which the platform writes only while the link is on;
nothing is copied or cached. A read is **absent** (no URL: not licensed or switched off), **down** (refused or not
answering) or **ok**.
- **Ok: pull only.** The value comes from the provider, as read, and is kept with the record (PL-07); it cannot be
  typed over.
- **Absent or down: by hand.** The value is typed from the label or certificate, the step needs a second-person check,
  the value is stored with source `hand` (and whether the link was absent or down), and QA's review lists it.
- **Deviations** (`deviation_v1`): a note's reference must exist; while the link answers its status is Deviations'
  (closed, rejected or cancelled there counts as closed; *cancelled* is Deviations' "Cancelled by QA: not a
  deviation", shown as "cancelled: not a deviation", owner 20 Nov 2026) and QA cannot close it by hand. By hand: a QA person other than the one
  who typed the number closes it. The number flows back (owner, 17 November 2026): a note written without a number
  that Deviations filed a deviation from (`deviation_v1.source_ref` = the note's `deviation_note_v1.source_ref`) is
  that deviation, read live while the link answers: its number and status are shown on the step, the batch screen,
  QA's review and the PDF, and it blocks release until closed there. A number typed while the link was off says
  "typed by hand".
- **A note without a number is decided here** (owner decision 20 Nov 2026; replaces Deviations filing every such note
  on its own, Deviations D-51, D-53 to D-55, D-59). A deviation note written without a number is an *exception* of
  the batch record. A person holding `truebatch_liquids.exception.decide` (Packing: `truebatch_liquids_packing.exception.decide`;
  granted per employee in the platform's permission register, no role gives it) chooses once: **Close here**, with a
  reason and an e-signature (meaning *Exception closed here*; batch event `exception_closed`), or **Send to
  Deviations** (batch event `exception_sent`, no signature; offered only while the Deviations link is not absent).
  `deviation_note_v1` has two new last columns (0024; Packing 0114): `decision` (`open`, `closed`, `sent`; null for a
  note written with a number) and `sent_at`; the Deviations system files only notes with `sent_at`, keyed by
  `source_ref` as before, and the number then flows back as above. QA's release and rejection wait until every such
  note is closed here or sent and filed in Deviations; closed-here notes show with who, when and why on the step, the
  batch screen, QA's review and the PDF. Production approval does not wait for the decision.
- **QMS** (`change_v1`, planned): the change control at approval must exist and be QA-approved, in a step of
  `CHANGE_STEPS`, and its products must name the master's product (code or name, without case); one that names no
  product is taken with a warning to QA. By hand: another person makes the version effective.
- **Logbook** (`equipment_status_v1`, planned): a machine or room must be fit for use and not in use by another batch,
  and not kept for another product: after an antibiotic the Logbook names in `only_product` (its last column, read
  null-safely through `to_jsonb`, so a view without it means any product) the one product that may follow until a
  product-changeover cleaning is verified there; any other product is refused in plain words, the same product goes on
  (owner, 17 Nov 2026). The product compared is the one the batch publishes (`batch_fact_v1` / `packing_batch_v1`
  `product_code`, the master's header);
  the Logbook's reasons are shown word for word (each without its own closing stop inside our sentence); a status
  older than 5 minutes counts as down. While the link answers, the machine and room pickers offer only what the
  Logbook has and name the ones left out (`shared/engine/picks.ts`, `inLogbook`); absent or down, every one is offered. Line clearance takes
  clean, cleaned on and cleaned by from it; the previous product and batch is offered from this product's own batches
  that named the room or line before (one tap; typed only when another product used it since). An empty picker says
  why: where the machines of its type stand, or that master data has none (owner, 17 Nov 2026). By hand: the status-label questions, each answered yes.
- **MMS** (`lot_v1`, `lot_test_v1`, planned, with numbers): the lot must exist, be the line's material, released, in
  date and not past retest; assay, water, LOD and content come as numbers in %, the assay on the master's basis. By
  hand: the lot label's status and date, the certificate values and their report number. A quantity taken from a lot
  pulled from MMS (a net weight, a packing material issued) may not be more than MMS shows available (owner, 16 Nov
  2026): MMS's balance of the lot (`lot_v1.stock`, in `lot_v1.unit`, MMS D-61) less what this product already used from it as
  its `material_use_v1` gives it (`shared/engine/stock.ts`), checked when it is recorded or corrected and when the
  step is signed done. An MMS whose `lot_v1` has no stock yet, or a lot typed by hand, is not compared. What the other
  TrueBatch products used of the same lot (bug fix, 18 Nov 2026: a leaflet lot issued by two packing products went
  below 0 in MMS): `lot_v1.stock_after_use` (MMS D-70, platform 1.20.0), the lot's stock after the use by every
  TrueBatch product linked to MMS, this one included, read through `to_jsonb` like `stock` (null on an older view or
  while MMS has not read every product lately). When it is there, what is available is the lower of it (plus the
  step's own earlier quantity, so a correction is not counted twice) and the figure above; the message then says
  "after use in all TrueBatch products". MMS works it out from its own read of the products, about every minute, so
  two products issuing from the same lot within that minute can both pass (accepted: it is a check, not a lock);
  once MMS has read the first issue, the next one is refused. This product's own uses count at once (the figure
  above). Without `stock_after_use`: this product's own use only, as before.
- **Recruitment** (`training_v1`, owner 17 Nov 2026: only trained people sign): one row per person and skill
  (`person_login`, `skill_code`, `skill_title`, `trained_on`, `valid_until`, `qualified`, already false when expired),
  read through `RECRUITMENT_DATABASE_URL`. A master step may name the training it needs (`step.training`: the skill's
  code and title, picked in the designer's Signatures section from the skills `training_v1` lists; typed only while
  the link is off or down; none by default, so existing masters do not change). The plain view says "Done by a
  person trained in SOP-… (Recruitment)". When a person signs such a step as performed or checked, the server reads
  their row by their login and the skill now (`shared/engine/training.ts`, `trainingCheck`): qualified, the signing
  event records `training` (code, title, trained on, valid until, as read) and the signed content includes it; not
  qualified, expired or missing, the signature is refused in plain words ("<name> has no valid training in <skill>
  (Recruitment): ask QA, or another trained person signs."). Link off or down: the sign dialog asks the signer to
  tick "I am trained in <skill>", and the signature records `training` from `hand` ("training typed by hand
  (Recruitment not reachable)"), shown on the step, listed in QA's release review and in the PDF (TL-23). A step
  marked not applicable, a QA hold release and the batch-level signatures do not read training.
- **LIMS** (`coa_v1`, `result_v1`, readers round 2, 19 Nov 2026, as Tablets): QC's certificate of analysis (CoA) and
  its results, read through `LIMS_DATABASE_URL` (`shared/engine/lims.ts`, `server/pull.ts`). While the link answers
  they are PICKED, never typed: (1) a QC result field (`qc` on a number field: the bulk test's pH, density, viscosity,
  assay, alcohol and preservative content) takes the `reported` figure of a result of this batch's approved CoA in the
  field's unit (pH: LIMS keeps it without a unit); (2) QC approval of the batch (or packing batch) takes this batch's
  approved CoA number, kept in the approval's payload (`source`) and signed with it; (3) the QC report number of a lot
  typed by hand (MMS off or down) is an approved CoA of that lot and the step's material. Only an APPROVED CoA (not one
  LIMS also rejected), of this batch number and product or this lot and material, of a release sample (a lot: release
  or retest). Absent or down: typed by hand as before, marked "typed by hand: LIMS …" (second-person check, listed for QA).
- **LIMS in-process tests** (rounds 42 and 43, as Tablets; owner: "it has to be there"): a step with in-process QC
  fields (`qc: 'in_process'`: the bulk test's pH, density, viscosity, assay, alcohol and preservative content, each one
  figure; blend uniformity, 10 values with their mean) opens a lab request when it starts, published as
  `report.lab_request_v1` ('<batch>/<step key>', 0020; its status follows the picks, 0021). Its fields pick a result of
  an APPROVED in-process report of that request (or of an earlier round of the same step, each result filling one
  round): a single figure takes LIMS's reported figure in the field's unit; a list takes exactly its count of values in
  LIMS's order, and LIMS's mean is worked out again and must agree. A release CoA is never an in-process result. While
  LIMS answers typing is refused; absent or down, typed and marked as above. A step started before round 42 has no
  request: its fields are typed, marked "started before LIMS in-process requests", checked and listed for QA.
  Round 44: LIMS names the field each in-process result answers (`result_v1.ipc_field`); such a result fills only that
  field (`answersField`), so the bulk test's assay and preservative content (both in %) never take each other's
  result ("<test> of report <IPR…> answers <field>, not <this field>."). A result naming no field is matched by unit.
  Round 45 (agreed with LIMS, whose in-process specification is per product): each test of a lab request has a code
  unique within the master, '<block id>.<field name>' ('bulk-test.assay'), with '@<n>' when the block is in the master
  more than once ('blend-uniformity.results@2'; the master check says so as info). LIMS names it back on its result
  (`result_v1.ipc_code`): the result then fills only the field of that code; without a code the round 44 rule holds.
  Requests opened before round 45 publish code null (0022).
- **Published** (`db/migrations/0006_report_views.sql`): `batch_fact_v1` and `equipment_use_v1` with Batchwright's
  names and columns, so the Logbook and Deviations read TrueBatch as they read Batchwright, and `deviation_note_v1`
  for Deviations to file notes later. `batch_fact_v1` has one more column at its end (`0007`): `manufactured_on`, the
  date of manufacture, the plant-time date the batch's first processing step started (null before), which TrueBatch
  Tablets Packing reads; readers of Batchwright's columns select them by name and are not affected. `0008` adds
  `product_name` and `master_version` at the end (family_code is the master version's number); `0015` adds the
  output counts for OEE and packing: `good_quantity` (the good tablets of the tablet reconciliation, whole),
  `good_unit` ('tablets') and `yield_percent`, null until that step is done; `0017` adds `released_at` (the time of
  QA's release event) and `released_by` (the name printed on its e-signature), null until released, as packing; it publishes
  `material_use_v1`: per signed weighing step its lot, material and net quantity (status dispensed, or corrected with
  the corrected quantity); MMS reduces the lot's stock by reading it (owner decision), nothing is sent. `0011`: a
  machine or room is in use by its **batch**, not its step or stage (cleaning is due between batches, not between the
  stages of one batch): `equipment_use_v1` has one row per batch and machine or room (sub-batches included), from the
  first start of a step of the batch that names it until every stage of the batch that names it, or whose rooms allow
  its room (by code or area), has closed (the batch event `stage_closed`, recorded once by the action that closes it,
  `0010`), or the production approval or rejection if earlier. So the binder preparation and the granulation in RM-104
  are one use, not dirty between them, and the Logbook marks it dirty after the last; another batch is another use. A
  picked machine or room keeps its room's area for this. A weighing instrument (a balance, by the type rule of
  `shared/engine/picks.ts`) is never a use: shared by the batches weighing on it, it is neither in use by a batch nor
  dirty between weighings; the record keeps which balance was used and the Logbook checks its calibration as before. Both views add `step_name` at the end ("Granulation › Granulate to
  an end point", kept with the step's start); `step` stays the keys. `0013` (17 Nov 2026): the use's `step` and
  `step_name` are the step that names it **last** (the latest started), so the Logbook's "last used by … (stage ›
  step)" names where it was last used. `0014`: a machine or room named only in line clearance steps (a room, the
  packing line) was used by the stage, so its `step_name` is the stage's name ("Blending"); a machine operated in a
  process step keeps that step. `0016` (whole-suite run, S17): a use starts when the machine or room was first
  recorded on a step, not at that step's start, so a room refused until its changeover cleaning was done does not
  overlap that cleaning in the Logbook. `material_use_v1` gives the quantity in the
  material's unit in master data, read when the step is signed done (g and mg exactly in kg for a kg material).
- **Readings for CPV** (round 46, `db/migrations/0026`): `reading_v1`, one row per recorded number of a step signed
  done, as the record holds it now (a correction replaces it, `corrected` says so): `reading_id` ('<batch number>/<stage.
  sub-batch.step.round>/<field>/<reading_no>'), `batch_number`, `product_code`, `stage` (name), `step` (keys, as
  `material_use_v1`), `step_name`, `sub_batch`, `round`, `block`, `parameter` (the field's label; a "check a value"
  step: what it checks), `field`, `reading_no` (a list of readings: one row each, in order), `value` (numeric), `unit`,
  `low_limit`, `high_limit` (numeric), `limit_unit` (may differ from `unit`: the reader converts), `limit_of` ('each':
  a C1 on the value; 'mean': a T7 on the list, the limit is the mean's), `recorded_at`, `corrected`, `read_at`,
  `data_as_of`. The limits are the master step's written limit setting the block checks the field against, or a fixed
  limit the block writes (no damaged punch, no device failing its function test); none for an earlier step's result.
  Every number field of the blocks a liquid master may use feeds it (`shared/engine/readings.ts`; the list is kept in
  the database as `reading_parameters`, not published; a test compares the two, so a new number field needs a
  migration). Liquids only (packing does not migrate it). Read by Operations (CPV).
- **Device assembly** (round 46; Tablets' roller compaction is not in Liquids). Device assembly
  (`device-assembly`, any edition: a dosing device or dropper, an autoinjector, an inhaler) is a yield step: one
  component from a lot (MMS, or the label by hand), the assembly line, the units fed and the devices out; a function
  test (at least the master's number tested, none failing, each works and is complete, the activation force when
  limits are set); an AQL inspection of the good devices (ISO 2859-1, critical, major, minor); yield, accountability of
  the units fed and of the component (one per device). The component used (issued − returned, its `net`) is published
  in `material_use_v1` as a weighing's net (`0025`), so MMS takes it off the lot; the step is checked against MMS's
  stock as any issue.
- **QA terminates a batch** (owner, 16 Nov 2026): a batch still in production (before production approval) that
  cannot be finished is terminated by QA (`qa.release`) from the batch screen or the "To review" list, with a reason
  and an e-signature meaning "rejected". It is a rejection (batch event `rejected` with `terminated`), so the status is
  rejected (`batch_fact_v1`: REJECTED), the record is kept and takes no more actions, and `equipment_use_v1` ends every
  open use of the batch then (machines and rooms dirty, no longer in use). Screens, review and PDF say "Terminated by
  … at …: reason", followed by what went back to stores.
  **Material of a terminated batch** (owner, 16 Nov 2026, both products): when the batch has used material (signed
  weighings, packing material issued), the "Terminate batch" window also asks, for each lot it used, how much went
  back to stores unused; the rest counts as used (destroyed or in the batch). Refused unless every lot is answered,
  from 0 up to what the batch counts as used of the lot (as published), and only for lots it used. The answers are
  kept in the terminate event, `payload.returns` [{lot, material, value, unit}], in the unit `material_use_v1`
  publishes for the lot, and signed with it. `material_use_v1` (`db/migrations/0012`; packing `0105`) takes them off:
  same columns and rows, `quantity` is now the quantity as before less what was returned of the same lot and unit,
  taken off the batch's uses of that lot from its last step back (stage, sub-batch, step, round), never below 0;
  `data_as_of` is then the later of the step's last event and the termination. So MMS shows the returned material
  available again with no change there. The app counts the same when it compares a lot with MMS's stock
  (`shared/engine/stock.ts`: materialUses, issuedLots, returnProblems). A batch that used no material is asked nothing.
- **Where machines are**: a stage that works machines or names a room chooses the rooms it may run in (master check,
  TL-11); the floor is offered the machines of the field's type standing in those rooms. A balance is offered where
  the weighing is done: in one of the master's **dispensing rooms** (header, picked from master data's rooms; a new
  tablet master starts with none, as a segregated block's booth may also be in a "Dispensing" area (17 Nov 2026 run);
  the rooms where a weighing balance stands are listed first; a master that weighs and names none is ⛔),
  or in a room the stage allows, never in a QC or laboratory area (`shared/engine/picks.ts`, the same rule on the
  server and the screen). Not every area called dispensing: a liquids block's "Liquid dispensing" balance is not
  offered to a tablet weighing. A version approved before the setting reads the rooms of the Dispensing area.
  The designer lists first the areas and rooms where the stage's machines stand (by type, from master data), and the
  master check warns (⚠️, TL-11) when no machine of a step's type stands in the rooms its stage allows, naming where
  the machines of that type stand: the floor's picker would be empty (17 Nov 2026 run: the disintegration tester in
  the QC lab). A warning, not ⛔: master data changes without a new master version, and the floor checks it again.
- **Pick lists from master data** (17 Nov 2026 run): the product pick lists offer the products whose dosage form
  names the product's dosage form (tablets; `web/src/product.ts`), not injections or capsules. Master data does not
  say whether a product is a bulk or a pack, so a pack product is still offered. Rooms read "code · name (area)".
- **What the master check reports**: everything the plain view would show as not set (a required setting, a hold
  time, a stage's responsible role, the stop check of a repeat-until step); an optional setting left empty is left out
  of the plain view's sentences, as the engine leaves it out. A temperature recorded with its optional limits left
  empty is a warning (the disintegration medium, an inlet or forming temperature). A stage's yield on an earlier
  stage's output is ⛔ when the stage adds formula materials (blending with extragranular materials and the
  lubricant: the yield would read above 100 %); the skeletons take blending's yield on the theoretical core batch
  weight. The messages carry no internal codes (rules, templates, failure cases).
- **The changes view shows every change** (round 38, 18 Nov 2026): the review's changes from the previous version
  compare the plain view's lines, so every field of a master has a line (alert limits, a salt form's charge, a stage's
  name, the master data item of the product and of each material, shown only in the changes view). A guard test
  (`test/describe-guard.test.ts`) changes each field of the schema in turn and expects a changed line, so a field added
  later fails until it has one. Safety net: when the versions differ but no line changed, the view says "Changed (not
  described)" with the changed fields' paths, never "No changes".

## Rules and where they are enforced
- 22 TrueBatch GMP rules (EU GMP Part I and Annex 11, 21 CFR 211 and Part 11, Revised Schedule M), listed in
  `rules.md`. Each is checked **once, in the app**.
- The database only protects records: an insert-only audit trail, locked signed records, and only the app may write.

## Engine
- About 40 calculation and check templates, each a small pure function. No formula language.
- Step blocks are **data**: a description of their fields, templates, signatures and limits. One engine runs all blocks.
  The library holds the standard tablet steps, from sifting to the reconciliation of tablets (`shared/blocks/`). A text
  setting may have a fixed list the author picks from.
- A fixed, short list of units. Counts are whole (owner, 17 Nov 2026): tablets counted by weight are rounded to the
  whole tablet, packs from tablets to whole packs (down); a count is named as people count it (tablets, packs, nos).
- A result is shown by its figure and its limit in a few words, with one verdict (the screen's chip, the PDF's
  verdict line); its worked line stays with it ("How it was worked out"; in the PDF under the figure)
  (`shared/engine/plain.ts`, owner 17 Nov 2026). Times are shown to the minute.
- A master version is stored as one JSON document.
- The designer is forms and ordered lists.
- Server timers as the Logbook does them. In a demo installation only (`TRUEBATCH_DEMO=1`, set by the platform for the
  demo customer alone) a person with the demo permission may end a running wait at once; the skip is an insert-only
  step event the timers count as the wait satisfied (owner, 15 November 2026; README "Demo installations"). A mixing
  time (T13 from a start timer to an end timer) is such a wait too: once skipped, its lower limit counts as met, the
  recorded duration and the upper limit are kept, and the result says "DEMO: wait skipped" (16 November 2026).
- The second-person checker signs on their own device.
- Version 1: weights are typed (no balance connection).
- PDF output as the Logbook does its exports.

## Calculation checks
Owner decision of 15 November 2026. The master check also runs calculation checks: error-proofing of the
calculations while a master is built. They are **not GMP rules** and are not among the 22. A **refusal** (⛔) is a
clear maths error: a calculation the templates library refuses (water or solvent counted twice, a salt factor up to
the weighed form with a potency stated as parent or element, molecules per salt unit ignored, a negative filler or
solvent, IU or CFU turned into a mass, weight variation on coated tablets other than film-coated, a property that does
not mix by mass), or the master's own numbers disagreeing (a batch quantity against per tablet × batch size, one
material twice with two quantities, the coating lines against coated − core, the API per tablet against the label
claim for each strength, mEq without the ion charge, an in-process result without its type, a liquid made in excess
without the amount to apply per charge); it shows on its item and must be fixed. A **warning** (⚠️) is an "it depends"
question only the author can answer (label basis per market and strength, herbal line, ratio basis, double
adjustment, a written salt factor, a weight that does not fit the tooling, a weight target without its stage, a
solvent-wet API, a removed processing aid, a one-sided particle-size limit, a moved order-critical step): the author
picks an answer, with a reason where asked, and the answer is kept in the master document and shown to the checker
and QA. An unanswered warning blocks "Send for review" like a refusal. The list, with the formulation each comes from
(1,000-formulation test, waves 1-5), is in `shared/templates/README.md`.

## Testing
- Tests per rule and per template, and a few browser journeys.
- No Batchwright machinery: no control register, mutation testing, golden batches, API contract package, CLI, sandbox,
  continuity or markets.
