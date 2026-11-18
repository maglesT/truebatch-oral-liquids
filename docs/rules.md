# TrueBatch rules

The 23 TrueBatch rules. Each is checked once, in the app. Each test that proves a rule starts its name with the rule
ID, e.g. `TB-08 the person who performed a step cannot check it`. `npm run traceability` prints the rule-to-test list;
CI (`npm run traceability -- --check`) fails when a rule has no test, unless its feature comes later (marked
"later" in the Tests column, with the feature it waits for).

Clauses: the binding clauses each rule rests on (US: 21 CFR 211 and Part 11; EU: EudraLex Vol 4 Part I chapters C2, C4, C5 and Annexes A11, A16; IN: Revised Schedule M Part I (SCHM) and Part VIII oral solids (SCHM-VIII)), checked against the official texts when the minimum register was made. QA should confirm them before validation.

| Rule | Requirement | Clauses | Tests |
|------|-------------|---------|-------|
| TB-01 | A master is complete before it can be approved | US 211.186(a),(b); 211.101(a); 211.110(a); EU C4 4.17, 4.18; IN SCHM 17.3.6.1, 17.3.6.2(a)-(k); SCHM-VIII 2.3 | `test/master-checks.test.ts` |
| TB-02 | A master is checked by a second person and approved by QA; one effective version; a new version needs a change control number | US 211.186(a); 211.100(a); 211.68(b); EU C4 4.3; A11 10; IN SCHM 17.2.4; 8.3; 17.3.6.1 | `test/master-review.test.ts`, `test/links.test.ts` (QMS change control) |
| TB-03 | A batch is issued from the effective master, with a unique number never reused | US 211.188(a); 211.186(a); EU C4 4.2, 4.20 (lead-in); IN SCHM 17.3.8.1; 17.3.10.8-17.3.10.11; 14.32 (new number for rework) | `test/batches.test.ts` |
| TB-04 | Entries are saved at once, with the person and the server time; late entries need a reason | US 211.100(b); 211.188(b)(1); 11.10(e); EU C4 4.8, 4.20(b); A11 12.4; IN SCHM 17.2.7; 17.3.8.3 (lead-in, (c)); 20.4 (omissions) | `test/batches.test.ts`, `test/release.test.ts` |
| TB-05 | TrueBatch keeps its own audit trail | US 11.10(e); EU A11 9, 12.4; IN SCHM 20.4; 17.2.8 ("record of changes and deletions") | `test/batches.test.ts` |
| TB-06 | A correction keeps the original value and its reason, and reaches the steps that used it; nothing is deleted | US 11.10(e); 211.180(a); EU C4 4.9, 4.11; A11 9; IN SCHM 17.2.6, 17.2.7 (retention: expiry + 1 year) | `test/engine.test.ts`, `test/batches.test.ts` |
| TB-07 | E-signatures carry the name, time and meaning, linked to what was signed | US 11.50(a),(b); 11.70; 11.200(a); 211.186(a); 211.188(a); EU A11 14; C4 4.20(h),(i); IN SCHM 17.3.8.3 ("dated and signed"); 17.2.8 | `test/batches.test.ts` |
| TB-08 | Significant steps have a second-person check; the checker is not the performer | US 211.188(b)(11); 211.101(c),(d); 211.103; 211.68(c); EU C4 4.20(c); C5 5.38; A11 6; IN SCHM 14.19; 17.2.8 ("critical data independently checked"); 17.3.8.3(e); 20.6 | `test/engine.test.ts`, `test/batches.test.ts`, `test/master-checks.test.ts`, `test/mywork.test.ts` |
| TB-09 | Steps are done in order; a departure needs a deviation note | US 211.100(b); 11.10(f); EU C5 5.15; C4 4.20(h); IN SCHM 18.2.2; 17.3.8.3(k) | `test/engine.test.ts` |
| TB-10 | Line clearance before each stage | US 211.67(b)(6); 211.100(a); EU C4 4.18(c); C5 5.40, 5.14; IN SCHM 17.3.8.2; 18.4.1; 18.4.7 | `test/master-checks.test.ts`, `test/engine.test.ts`, `test/designer.test.ts`, `test/links.test.ts` (cleaning facts from the Logbook; typed from the label without it) |
| TB-11 | Equipment and rooms are fit for use | US 211.67; 211.68(a); 211.105(b); 211.160(b)(4); 211.188(b)(2); 211.42(c); EU C4 4.20(e); C5 5.9, 5.12; IN SCHM 18.4.3, 18.4.4, 18.4.9; 18.2.4; 17.3.6.2(e) | `test/batches.test.ts` (master data), `test/picks.test.ts` (the machines offered: balances of the master's dispensing rooms, lines in the stage's rooms), `test/master-checks.test.ts` (a stage names its rooms), `test/links.test.ts` (Logbook status; the label questions without it) |
| TB-12 | Only released, in-date lots are used | US 211.84(a); 211.86; 211.87; 211.101(c)(1); EU C5 5.34; IN SCHM 14.14, 14.16, 14.17 | `test/links.test.ts` (MMS lot status, material and dates; the label without it) |
| TB-13 | The dispensing target comes from the master, adjusted by assay and LOD | US 211.101(a),(b),(d); 211.188(b)(3),(4); EU C5 5.37, 5.39; C4 4.20(d), 4.8; IN SCHM 14.18, 14.20; 17.3.8.3(f); 7 (recalls) | `test/engine.test.ts`, `test/master-checks.test.ts` |
| TB-14 | In-process checks against the master's limits; out of limits needs a deviation note | US 211.110(a)-(c); 211.188(b)(5),(10); 211.192; EU C4 4.18(d),(e), 4.20(f); C5 5.43; IN SCHM 17.3.6.2(g),(h); 17.3.8.3(i); 18.4.2; 19.7.5; SCHM-VIII 1.5, 2.3 | `test/engine.test.ts`, `e2e/floor.spec.ts` |
| TB-15 | Compression: every station at the start, then a sample at least every 30 minutes | US 211.110(a)(1),(2); EU C5 5.43; IN SCHM-VIII 3.3, 3.4, 3.5, 3.7, 3.8 | `test/engine.test.ts`, `test/mywork.test.ts` |
| TB-16 | Sieves, punches and dies are checked before and after use | IN SCHM-VIII 1.3, 1.4, 2.2, 2.5, 4.2, 6.1, 6.2; US 211.67, 211.113(a) (general); EU C5 5.11 (dust, general) | `test/engine.test.ts` (screens), `test/blocks.test.ts` (punches and dies, the punch and die check block) |
| TB-17 | Hold times run on the server clock; an overrun needs a deviation note | US 211.111; EU C4 4.18(f); C5 5.41; IN SCHM 17.3.6.2(k); 17.3.8.3(h); 18.4.4 | `test/engine.test.ts`, `test/batches.test.ts` |
| TB-18 | Yield is calculated and verified; out of limits blocks release | US 211.103; 211.186(b)(7); 211.188(b)(7); 211.192; EU C4 4.17(d), 4.20(g); C5 5.44; IN SCHM 17.3.6.2(d); 17.3.8.3(j); 18.2.3; 18.4.6 | `test/engine.test.ts`, `test/release.test.ts` |
| TB-19 | Rework only as a new batch issued from an approved master | US 211.115(a),(b); EU C5 5.67, 5.68, 5.69; C4 4.20(d); IN SCHM 14.32, 14.33, 14.34; 17.3.8.3(f) | `test/batches.test.ts` |
| TB-20 | The record is complete before production signs | US 211.188(b); EU C4 4.20(i); IN SCHM 17.3.8.3 (lead-in, (d)); 18.5.12 | `test/release.test.ts`, `test/batches.test.ts` |
| TB-21 | QC approval, then QA review and release or rejection by e-signature; all changes and deviations shown; release blocked until linked deviations are closed | US 211.22(a); 211.192; 211.165(a); EU C4 4.27; A11 9, 15 (only if certifying here); IN SCHM 1 PQS (i); 11.3.6-11.3.9; 18.5.12; 19.8.1 | `test/release.test.ts`, `test/batches.test.ts`, `test/links.test.ts` (Deviations status), `test/packing.test.ts` and `test/packing-api.test.ts` (packing: QC before QA) |
| TB-22 | A complete copy (PDF) with its signatures and changes | US 11.10(b); 211.180(c); EU A11 8.1, 8.2; C4 4.27; IN SCHM 17.2.8 ("readily available") | `test/batches.test.ts`, `e2e/release.spec.ts` |
| TB-23 | A step that names a training is signed (performed or checked) only by a person Recruitment shows trained in it; while Recruitment cannot be reached the signer confirms it and QA sees it | US 211.25(a); 11.10(i); EU C2 2.11 | `test/training.test.ts`, `e2e/floor.spec.ts` |

## Packing rules (TrueBatch Tablets Packing)

The 9 packing rules of the minimum register, section E (owner, 15 November 2026: packing is a separate product,
"TrueBatch Tablets Packing", with the shared engine). Each uses the mechanisms of the rules above: the master and its
check (TB-01, TB-02), issue (TB-03), entries, signatures and second-person checks (TB-04 to TB-08), deviation notes
(TB-09), in-process checks and periodic checks (TB-14, TB-15), reconciliation that blocks release (TB-18) and QA
release (TB-21, TB-22), which apply to the packing record unchanged (QC approves it, then QA releases it). The tests
name the packing rule; the tests of the shared rules cover the packing record through the same engine and routes.

| Rule | Requirement | Clauses | Tests |
|------|-------------|---------|-------|
| TB-P1 | A packing master per product, pack type and size (and destination): its packing materials with codes, where the batch number, dates and MRP are printed, line clearance before and after, and IPCs with limits | US 211.186(b); EU C4 4.19; IN SCHM 17.3.7 | `test/packing.test.ts` |
| TB-P2 | A packing record per packing batch, linked to the RELEASED bulk batch: quantities, responsible people, checks, specimens and problems | US 211.188(b)(6),(8),(9),(13); EU C4 4.21; IN SCHM 17.3.9 | `test/packing.test.ts`, `test/packing-api.test.ts` (bulk released, read from TrueBatch Tablets; typed from its labels without the link), `e2e/packing.spec.ts` |
| TB-P3 | Line clearance before and after packing, checked by a second person; strips and blisters formed and sealed within limits and leak tested periodically | US 211.130(e); 211.188(b)(6); EU C4 4.19(f),(g), C5 5.50; IN SCHM 17.3.9.2, 18.5.2; SCHM-VIII 7.1-7.4 | `test/packing.test.ts` |
| TB-P4 | Printed and other packing materials issued only by their signed and checked step, from a released lot of the master's material; every component checked against the packing master at line start | US 211.125(a),(b),(f), 211.130(d); EU C5 5.52 | `test/packing.test.ts` |
| TB-P5 | Coding (batch number, dates, MRP) checked at the start and at intervals; the camera challenged; packs inspected on line; line samples never returned; the customer's serialisation checked (codes of this batch, no serial twice, reconciled), never generated | US 211.122(g), 211.130(c), 211.134; EU C5 5.55-5.60; IN SCHM 18.5.4-18.5.9 | `test/packing.test.ts` |
| TB-P6 | Bulk tablets and every printed material reconciled (issued = used + destroyed + returned); a gap needs a deviation note and blocks release until its number is linked; batch-coded leftovers destroyed and recorded | US 211.125(c)-(e), 211.192; EU C4 4.21(h), C5 5.61, 5.62; IN SCHM 18.2.3, 18.5.10, 18.5.11 | `test/packing.test.ts`, `test/packing-api.test.ts` |
| TB-P7 | One active packing order per line; the line is named on the record, with the product and batch | US 211.130(a); EU C5 5.49, 5.51; IN SCHM 18.5.1, 18.5.3 | `test/packing-api.test.ts` |
| TB-P8 | The expiry is worked out from the approved shelf life and the bulk's date of manufacture, never typed | US 211.137; EU C4 4.16; IN SCHM 17.3.1.2 | `test/packing.test.ts`, `test/links.test.ts` (`batch_fact_v1.manufactured_on`: the date the first step started), `test/packing-api.test.ts` (read from it; a typed date in the future refused) |
| TB-P9 | Label data per destination (India domestic: dates and MRP); the coding check compares the printed data with the batch record | IN SCHM 17.3.1.2; US 211.137 (expiry) | `test/packing.test.ts` |

## Notes: safety rules built into the calculation templates

These notes record which TrueBatch rule each template safety rule protects. They are not rule rows, and they add no
rules to the table above. Each safety rule refuses with a plain-English message. Each has its own tests in
`test/templates/` (the test names start with the template ID). The templates are described in
`shared/templates/README.md`.

- **TB-13 (dispensing):**
  - **Same basis (C5, built into T9).** A hydrate or solvate molecular weight in the salt factor (T11) together with
    a water, LOD or solvent correction of the assay (T9) is refused, because it counts the water twice (about 6.7 %
    too much pantoprazole).
    A salt, ester, hydrate or compound factor is also refused when the certificate states the potency "as parent"
    (µg of parent drug per mg of material) or "as element" (% Ca, % Zn, % Fe), because that factor is already
    inside the potency.
  - **Molecules per salt formula unit (T11).** The salt factor uses the MW of the salt divided by the number of drug
    molecules per formula unit (2 for hemifumarates and for calcium salts with two anions), so a hemi-salt cannot
    double the dose. A hemi-salt left at 1 molecule per unit with the MW of the whole formula unit (at least twice
    the other form's) is refused.
  - **No negative filler (T10).** A compensating excipient that would go below zero is refused: the batch weight
    cannot be kept, and a deviation is needed.
  - **Potency units are never a mass.** IU, CFU and activity units never convert to a mass. They become a weight
    only through the lot's content per gram (T18).
- **TB-14 (in-process checks against the master's limits):**
  - **No weight-variation method for coated tablets other than film-coated (T14).** Uniformity of dosage units by
    weight variation is refused for sugar-coated and other coated tablets. It is also refused below 25 mg or 25 %
    of the unit, and for products set to "individual results only".
- **TB-16 (coating solutions):**
  - **No negative water or solvent (T17).** A liquid make-up whose water or solvent to add would be negative (the
    target solids are higher than the ingredients allow) is refused.
