# TrueBatch Tablets Packing: design decisions

Owner decisions of 15 November 2026. The packing batch record: from the RELEASED bulk tablets of TrueBatch Tablets to
QA release of the packed batch. Built the Logbook way, as TrueBatch Tablets is.

## A separate product on the same engine
- **Its own product on the platform**: its own tile, licence, database (`truebatch_packing`), app login
  (`truebatch_packing_app`), sign-on client (`truebatch_packing`) and permissions (`truebatch_packing.view`,
  `.master.author`, `.master.check`, `.master.approve`, `.batch.issue`, `.batch.operate`, `.batch.check`,
  `.batch.supervise`, `.qc.approve`, `.qa.release`). The platform allows only lower case and `_` in product, database and permission
  names, so the product is written `truebatch_packing`, not `truebatch-packing`.
- **The same code**: one server (`server/`), one engine, block library, templates, master document and checks
  (`shared/`), one set of screens (`web/src`). Nothing is copied. `server/product.ts` says which product a server is;
  inside the app each permission is known by its TrueBatch code, and a product's own codes in core's token are read as
  those (`truebatch_packing.batch.operate` is `truebatch.batch.operate`); every other code is ignored.
- **`packing/`** holds only what is the packing product's own: its entry points (`packing/server/index.ts`,
  `packing/web/`), its descriptor (`packing/product.ts`), its migrations (`packing/migrate.ts`: TrueBatch Tablets'
  migrations without the views it publishes, with packing's app role, then `packing/migrations/`) and its published
  views (`packing_batch_v1`, `equipment_use_v1`, `material_use_v1`, `deviation_note_v1`). `ops/packing.Dockerfile` and `ops/packing.manifest.draft.json` are its image and manifest.

## The packing master (TB-P1)
- One master document, as for tablets, with a **pack** section: the pack product (header), the bulk product, pack
  type (blister, strip, bottle) and size, packs per carton, the approved shelf life and expiry rule, destination
  (India domestic or export), MRP, serialisation on or off with the pack GTIN, and the packing materials picked from
  master data (kind, printed, coded, quantity per pack). The formula is empty; a step's material setting names a
  packing material.
- One master per product, pack type and size, and destination (another destination is a copy).
- The designer offers the packing blocks and a packing skeleton (issue to the line; packing; reconciliation and line
  clearance after). The master check runs the packing checks (`shared/master/packing.ts`) instead of the formula and
  calculation checks.

## The packing record
- **Issued from a released bulk batch** (TB-P2): the issue carries the line, the bulk batch and the tablets issued,
  recorded as the first step's values. The bulk batch is read live from TrueBatch Tablets' `batch_fact_v1`: it must
  be RELEASED and of the master's bulk product. Its date of manufacture (owner, 15 November 2026) is the date the
  bulk batch's FIRST processing step started, in plant time: TrueBatch Tablets publishes it as
  `batch_fact_v1.manufactured_on` (`db/migrations/0007_batch_fact_manufactured_on.sql`), not its issue date; a bulk
  batch without one is refused. Without the link the bulk and its date of manufacture are typed from the bulk labels
  ("RELEASED", the product) with a second-person check, and QA's review lists them; a typed date in the future is
  refused. The tablets issued come with the bulk batch too (owner, 17 November 2026: pull, don't type): its good
  tablets, `batch_fact_v1.good_quantity` (`0015`); typed only while TrueBatch Tablets does not give them. Offered is
  what is LEFT of them (bug fix, 17 November 2026): the good tablets less the tablets issued to the other packing
  batches of the same bulk batch, net of what went back unused when QA terminated one (the terminate window asks for
  the bulk tablets too). Less may be typed (a part issue), more is refused; `shared/engine/stock.ts` `bulkLeft`.
- **One active packing order per line** (TB-P7): a line with a batch still being packed takes no other.
- **Batch facts and pack facts**: block calculations read the issue values (`$batch.bulk`, `$batch.mfgDate`,
  `$batch.tablets`, `$batch.packs`) and the master's pack (`$pack.shelfLifeMonths`, `$pack.mrp` …), so the coding
  checks compare the print with the record, never with a typed copy.
- **Checks alongside the line**: the periodic checks (coding, forming and sealing, leak test, on-line inspection,
  cartons, serialisation sample) open the next check after their first round and go on side by side; the stage
  closes when each has its end round.
- **Coded batch number**: the bulk batch number is printed on the packs; the packing record has its own number
  (`TP` + year + counter).
- **Expiry** (TB-P8): worked out from the date of manufacture (above) and the approved shelf life (T27), never typed.
- **Reconciliation** (TB-P6): tablets (count by weight) and every printed material (issued = used + destroyed +
  returned, zero gap); a gap is out of limits, needs a deviation note and blocks release until its number is linked.
- **Serialisation** (optional per product): checked, never generated. Serial numbers received (typed, with the order
  or file reference), camera challenge at the start, sample codes at the start, at intervals and at the end (GTIN,
  batch, expiry of this batch; well-formed serial; no serial twice in the batch), and reconciliation (received =
  printed OK + rejected + destroyed + unused). No serial register, no regulator reporting.
- **Release** (owner, 15 November 2026: "QC signs first", as for tablets): production approval, then QC approval by
  e-signature (`truebatch_packing.qc.approve`, meaning `qc_approved`, with the QC report number: the finished packed
  product was tested and complies), then QA release or rejection by e-signature. QA cannot release or reject before
  QC has approved. `packing_batch_v1` shows QC_APPROVED in between (`packing/migrations/0101_packing_qc_status.sql`).
- **Published**: `packing_batch_v1` (packing order, coded batch number, products, pack, dates, packs and cartons,
  status, and at its end `shippers`, the shippers counted at the finished goods step or null, `0108`; then
  `good_quantity`, `good_unit` 'packs' and `yield_percent`, the good packs and the yield in packs of the finished goods
  step, null until it is done, `0109`, for OEE; then `released_at` and `released_by`, the time of QA's release event
  and the name printed on its e-signature, null until released, `0111`, so MMS shows who released the FG lot and when) for MMS finished goods; the line named only in the line clearance has the stage as its `step_name` ("Packing", `0107`); `equipment_use_v1` (the line and rooms used, for the Logbook) and
  `material_use_v1` (per signed issue step its lot, packing material and quantity issued in the material's unit, for
  MMS to reduce the lot's stock) with TrueBatch Tablets' names and columns
  (`packing/migrations/0102_packing_equipment_and_material_use.sql`). `0103`: one use of the line per packing batch:
  it is in use by the batch through its packing and its reconciliation and line clearance (stages in the line's
  rooms), and dirty after the batch (the line named at issue, the line clearance after packing and a balance do not start a use;
  that clearance is not refused because the line is dirty), `step_name` at the end of both, quantities in the material's
  master-data unit (a count in e.g. nos), and `deviation_note_v1` with TrueBatch Tablets' columns (source_ref
  `truebatch_packing:note:<id>`), so the Deviations system files packing's notes too (late periodic checks).
  `0110` (whole-suite run, S17): a use of the line or a room starts when it was first recorded on a step, not at that
  step's start (as TrueBatch Tablets' `0016`).
  **The bulk batch's open deviations** (whole-suite run, S24): QA's review and the packing record PDF list the
  deviations of the bulk batch packed that are still open, read through TrueBatch Tablets' `deviation_note_v1` of the
  bulk batch (a note's number, or the deviation Deviations filed from a note without one) and the Deviations system's
  `deviation_v1` (their status, and the deviations that name the bulk batch there); release waits until they are closed
  there (`server/routes/batches.ts` bulkDeviations, `shared/engine/release.ts` bulkRefusal). When either link is off
  or down they are shown as "Bulk deviations not checked (link off)": QA checks them in the Deviations system and types
  what was found; release keeps that text (`released` event `bulk`), shown in the review and the PDF. Packing reads
  `truebatch` `deviation_note_v1` (manifest `reads`).
  `0104` (owner, 16 Nov 2026): `material_use_v1.quantity` is what the batch used of the lot: the quantity issued less
  what the reconciliation of the same material returned to stores uncoded, once that reconciliation is signed done
  (before it, the quantity issued). Destroyed and batch-coded material stays used. MMS takes the quantity off the lot,
  so the uncoded material returned to stores is available again in MMS with no change there.
  `0105` (owner, 16 Nov 2026): when QA terminates a packing batch that has packing material issued, the "Terminate
  batch" window asks, per lot issued, how much went back to stores unused (0 up to what the batch still counts as used
  of it); the rest counts as used (destroyed or coded). The quantities are kept in the terminate event
  (`payload.returns`: lot, material, quantity and unit as `material_use_v1` publishes them) and `material_use_v1`
  takes them off the batch's issues of that lot, the last first, never below 0: same columns and rows, MMS shows the
  returned material available again with no change there. Shared with TrueBatch Tablets (`db/migrations/0012`,
  `shared/engine/stock.ts`); see docs/design.md.

## Left for later
- An issue screen (as for TrueBatch Tablets, batches are issued through the API for now) and a read-only line display.
- Reading the serialisation system's file (the count is typed with the file reference).
- Artwork specimens as attachments (the line set-up confirms they are attached to the paper annex).
