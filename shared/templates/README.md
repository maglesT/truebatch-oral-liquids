# TrueBatch Tablets: calculation and check templates (version 2)

Small, pure TypeScript functions. One function per template. No formula language, no parser, no
expression engine. The master batch record picks a template and its inputs. Underneath there is
only GMP maths: exact decimals, unit conversion, pharmacopoeia rounding at limits, and refusals in
plain English.

Shared code: the server and the designer's live preview both use it. Tests are in `test/templates/` and run
with the rest of the suite (`npm test`, `npm run ci`). They need no database.

## How every template works

- **Inputs are text.** Each value is a string with its unit: `"50.300 kg"`, or `{ value: "50.300", unit: "kg" }`.
  A JavaScript number is refused, because it is binary floating point. Values are held as
  `decimal.js` decimals with 50 significant digits. Large counts can be written `"3e9"`.
- **The result** is `{ ok: true, value, unit, shown, check? }`:
  - `value` is the full-precision decimal. It is never replaced by a rounded figure.
  - `shown` is the worked line in plain words for the screen, e.g. `50.300 kg ÷ 51.000 kg × 100 = 98.6 %`.
  - `check` is present when the master attached a `limit` (see C1).
  - Some templates add their own fields (T4 `unaccounted`, T7 `stats`, T14 `decision` …).
- **A refusal** is `{ ok: false, message }`. The message says in plain English what is wrong and what to do.
- **Display decimals** can be set with `decimals`. Defaults: kg 3, g/mg 2, % 1.
- **Numbers inside a worked line** follow one rule (`shownNumber` in `core.ts`): a value written with at most 4
  decimals is shown as written; a full-precision value passed on from an earlier calculation is shown at the unit's
  display decimals + 1 (kg 4, g and mg 3, % 2; at least 4 significant figures when small), cut and marked "…"
  (`10.2553… kg`), so rounding the shown figure gives the same result. The value before rounding at a limit is shown
  with 2 decimals more than the limit. Only the display is shortened; nothing is rounded inside a calculation.

## Units (`units.ts`)

There is one fixed list, one line per unit. Only units of the same kind convert.

| Kind | Units |
|---|---|
| mass | µg mg g kg |
| volume | µL mL L m³; US gal (231 in³), imp gal (20 % larger: they never share a symbol, a bare "gal" is refused) |
| length, area | µm mm cm m; mm² cm² |
| time | s min h d |
| temperature | °C °F K (offsets exact); temperature difference Δ°C ΔK Δ°F |
| force | N kN kp (1 kp = 9.80665 N exactly) |
| pressure | Pa hPa kPa MPa N/mm² bar mbar psi mmHg atm kgf/cm² kN/cm² |
| content | % %w/w ppm µg/mg mg/g (1000 µg/mg = 100 %); %w/v mg/mL g/L (a separate kind); density g/mL g/cm³ kg/L kg/m³ |
| rates | rpm; g/h g/min kg/h g/s; mL/h mL/min L/h L/min m³/h cfm; units/h units/min tablets/h tablets/min |
| electrical | mA A; W kW; kJ/kg kWh/kg |
| humidity | %RH, g/kg (dry air) and g/m³ (of air). These never convert into each other: use T25. |
| potency | IU, CFU, U (activity units); IU/g IU/mg, CFU/g CFU/mg, U/g U/mg; mg/IU. These never convert to a mass. |
| other | ° (angle); mg/cm² g/m² (coat per area); mm³; rad/min (↔ rpm); kgf alongside kp; SCU (Strong-Cobb hardness, its own kind: published factors to kp disagree, so it never converts) |
| frequency | Hz (drive frequency): never converts to rpm; Hz × rpm/Hz (the equipment record's factor) = rpm in T8 product |
| charge | mEq: becomes a mass only in T11, with the ion's charge |
| count | units, tablets; plain number; log |

Temperatures are never added (T2 refuses them). A difference of two temperatures is a temperature
difference. When it is compared with a limit written in °C, the difference unit is used.

## Rounding at limits (`rounding.ts`, also C1)

- The result is rounded to the number of decimals of the limit as written, half up, and only then compared.
  The rule paraphrases the USP General Notices. Example: 94.95 against 95.0–105.0 passes; 94.94 fails.
- When the two bounds are written with different decimals, the finer one is used.
- One-sided limits are allowed (low only or high only), and either bound may be strict ("more than").
- Tiers: the action limits are the specification. Optional alert limits sit inside them. The result is
  `pass`, `alert` (passes, flagged) or `fail`.
- The value is converted into the limit's unit before rounding.

## Calculation templates

| ID | Name | Inputs | Output | Settings | Refusals |
|---|---|---|---|---|---|
| T1 | Difference | a, b (gross, tare; inlet, exhaust …) | a − b | result unit; names; `allowNegative` | tare above gross (unless allowed); different kinds |
| T2 | Total | list of values | sum | result unit | empty list; temperatures; percentages; mixed kinds |
| T3 | % of target (yield) | actual, theoretical | actual ÷ theoretical × 100 % | limit | theoretical ≤ 0; negative actual; temperatures |
| T4 | Accountability and unaccounted | input; named parts (output, samples, rejects, waste) | Σ parts ÷ input × 100 %; also unaccounted = input − Σ parts (quantity and %) | limit on %; limit on unaccounted (kg, tablets or %) | input ≤ 0; no parts; negative part; mixed kinds |
| T5 | % change | before, after | change ÷ base × 100; gain = after − before, loss = before − after | mode gain/loss; **base (one setting, required)**: this layer's own starting weight, the final weight, or a named earlier stage (e.g. the uncoated core) | no base chosen; base ≤ 0; temperatures |
| T6 | Ratio and powder indices | a, b | a ÷ b; Carr = (tapped − bulk) ÷ tapped × 100; Hausner = tapped ÷ bulk; log10(a ÷ b); angle of repose = arctan(height ÷ radius), or arctan(2 × height ÷ diameter), in degrees; **whole containers** = a ÷ b rounded up, with the excess (F0087) | mode; result unit (tablets, %, MPa, kN/cm², g/mL, mg/cm², mg per unit …) | ÷ 0; tapped < bulk; kinds that do not make a ratio; log of ≤ 0; height or radius ≤ 0 |
| T7 | Statistics of readings | series; or a per-unit value from 2 readings (first − second) or from any number of readings on the same unit (first minus rest, sum, or split loss % = (whole − Σ parts) ÷ whole × 100) | mean (value), SD (n − 1), % RSD, min, max, count | limit on the mean; limit on % RSD | no readings; mixed kinds; RSD from one reading |
| T8 | Batch scaling | per unit × count; % w/w × batch weight; rate × time; per area: mg/cm² × surface area (from the tooling record) × count; product of 2 or 3 recorded values (L × W × H; Hz × rpm/Hz) | quantity (kg by default; IU stay IU; lengths give mm² or mm³) | mode; result unit | count not a count; % outside 0–100; rate not per time |
| T9 | Potency-adjusted quantity | standard quantity (or the T11 result), assay, basis, water / LOD / solvents | standard × 100 ÷ assay as is. As is = A × (100 − W) ÷ 100 (anhydrous), A × (100 − LOD) ÷ 100 (dried), A × (100 − LOI) ÷ 100 (ignited), A × (100 − W − S) ÷ 100 (anhydrous and solvent-free) | basis; `standardIs` anhydrous or hydrate/solvate; `assayExpressedAs`; `potencyAs` parent or element; assay above 100 % used or taken as 100 | **C5 rules** (below); missing water/LOD/solvents; assay ≤ 0; water/LOD outside 0 to <100 %; standard not a mass |
| T10 | Compensating excipient | filler(s) with standard quantity (and ratio); adjusted materials (standard, adjusted) | filler = standard − Σ (adjusted − standard), shared over several fillers in a ratio (default: their standard quantities) | several adjusted materials at once (excesses + or −); several fillers | **any filler negative** (the batch weight cannot be kept); no filler; not masses |
| T11 | Salt / base factor | quantity of form A; MW and molecules per unit of form A and form B; whether form B's MW includes crystal water/solvent | quantity × (MW B ÷ n B) ÷ (MW A ÷ n A) | any two named forms (base ↔ salt, salt ↔ salt, element ↔ compound, cocrystal); **molecules per formula unit** (default 1; hemifumarate, calcium salts = 2); **a quantity in mEq**: mmol = mEq ÷ the ion's `charge`, ÷ ions per unit × MW (F0393); **`writtenFactor`** checked against the MWs at its decimals (F0062); **`mwFromLot`** with `lotMw`: an average MW from the lot's certificate (F0018) | MW ≤ 0; molecules not a whole number ≥ 1; **a hemi-salt at 1 molecule per unit with a MW at least twice the other form's** (the whole formula unit's MW: the dose would double); not a mass; a written factor the MWs do not give; mEq without the ion charge; a lot MW not given |
| T12 | Quantity from dry basis | quantity, LOD | dry → as is: dry × 100 ÷ (100 − LOD); reverse: as is × (100 − LOD) ÷ 100 | direction | LOD outside 0 to <100 % |
| T13 | Duration and hold time | start, end; or timed readings of a monitored value | end − start; or time counted only while the value is inside limits | unit min/h; limit (max and/or min); target time (accumulated mode) | end before start; bad or impossible date; readings out of time order |
| T14 | Content uniformity acceptance value | 10 or 30 individual contents (% of label claim); or unit weights + assay + label claim | AV = \|M − X̄\| + k·s, with the stage decision; **stratified** (`t14Stratified`, F0229): RSD of N locations × n units against the largest RSD of the master's Bergum (ASTM E2709) table at that mean, interpolated | method: content uniformity, weight variation, large sample; target T; L1, L2; coating type; "individual results only" | **weight variation for sugar-coated or other coated tablets**; weight variation below 25 mg or 25 %; weight variation with "individual results only"; n not 10/30; large sample with ≤ 30 units |
| T15 | Re-scale to actual yield | formula quantity, actual and theoretical intermediate | formula × actual ÷ theoretical | window on actual ÷ theoretical (e.g. 90.0–102.0 %) | outside the window (with rounding); theoretical ≤ 0 |
| T16 | Overage | quantity (after potency), overage % | quantity × (100 + overage) ÷ 100, and the overage amount kept separate | highest allowed overage | negative overage; above the allowed overage |
| T17 | Liquid make-up | w/w: dry components, liquid ingredients with their own solids (by mass, or by volume with density), overage, target % solids. w/v: solutes at % w/v, final volume | w/w: total solids, total liquid, **solvent to add** (and its volume with a density). w/v: each solute's mass; make up to volume | mode; overage; solvent density | **solvent to add negative** (target solids too high); target ≤ 0 or > 100 %; liquid by volume without density |
| T18 | Content-adjusted quantity (any material) | formula quantity, the lot's content | pure × 100 ÷ content %; units ÷ units per gram (IU/g, CFU/g, U/mg); IU × mg/IU | `formulaQuantityIs` dry or wet (wet needs the nominal content); content source (certificate or in-process result); **`resultType`** content or % of theoretical (× the nominal content, F0205); **`second`**: a second API in the same intermediate, its delivered quantity shown and checked (F0187) | **IU/CFU/U with a % content** (never a mass); target and content units that do not match; content ≤ 0 or > 100 %; % of theoretical without the nominal content; **the second API out of its limits** |
| T19 | Split into portions | total; portions as %, fixed quantity or the remainder | each portion; remainder = what is left; check that the parts add up | which portion is the remainder | remainder negative; not exactly one remainder |
| T20 | Multi-lot quantity | required pure quantity; lots with weighed quantity and content | pure content per lot; quantity still to weigh from the last lot; total weighed (feeds T10) | without a required quantity: pure content delivered (e.g. amylase units) | earlier lots already give more than needed; lots with different kinds of content |
| T21 | Lesser / greater of values | named values | the smallest or largest, and which one | lesser or greater | fewer than two; mixed kinds |
| T22 | Sieve analysis | sample weight; sieves (coarsest first) with weight retained; pan. **Mixed lots** (`t22MixPsd`, F0418): each lot's mass and laser-diffraction table | % retained (of the weight recovered), cumulative %, % passing, recovery % (value). Mixed lots: mass-weighted cumulative % undersize, then D0.5, D0.9 … by interpolation, with limits | % fines below a named sieve; d50 by linear or log interpolation; limits on recovery and fines | sieves not coarsest-first; negative weights; fines sieve not used; d50 outside the sieve range |
| T23 | Compact strength and solid fraction | breaking force, diameter, thickness (convex: wall thickness); weight and true density | tensile strength MPa: flat round 2F ÷ (πDt); convex round by Pitt, Newton and Stanley (1988); **fracture area** F ÷ (D × H) in N/mm² (F0039); apparent density, solid fraction, porosity | shape; ribbon mode: envelope density ÷ true density | missing wall thickness; wall > thickness; SF > 1; convex SF without a volume |
| T24 | Extruder specific mechanical energy (optional) | motor power, torque %, screw speed, maximum speed, feed rate, efficiency (default 1) | SME kWh/kg = P × torque/100 × N/Nmax × η ÷ feed | limit | torque outside 0–100; speed above maximum; feed ≤ 0; efficiency outside (0, 1] |
| T25 | Absolute humidity (optional) | % RH, temperature, pressure (default 1013.25 hPa) | g water per kg dry air (Magnus formula, WMO constants), or **per m³ of air** e × 18.01528 ÷ (8.314462618 × T) (F0033); and the dew point | `per`; limit in g/kg or g/m³ | RH outside (0, 100]; temperature outside −45 to 60 °C |
| T26 | Mix to a target | mass of the main lot A and its value a; the donor lot's value b; the target t (a % size fraction, an assay, an LOD …) | donor to add = mA × (t − a) ÷ (b − t); the mixed total; other markers of the mix (F0450) | result unit; **`scale: 'ethanol % v/v'`**: strengths to % w/w at 20 °C by the OIML R 22 formula, donor volume shown (F0008); **`basis`** of each value (F0027); **`others`** with limits | **b not on the far side of t from a** (no amount can reach the target); temperatures; mass not a mass; **values on different bases**; **properties that do not mix by mass** (sizes, hardness, pressure, pH: F0418); another marker out of its limits |
| F8 | Diversion window (pure calculation only) | excursion start and end; shortest and longest residence delay; line rate | divert from start + shortest to end + longest; window minutes; quantity = rate × window. Reverse: the lots that could be in the tablets made in a window | rate in kg/h, tablets/h or L/h | end before start; longest delay shorter than shortest |

| T27 | Expiry from the shelf life (packing, TB-P8) | date of manufacture (YYYY-MM-DD), approved shelf life in months, rule ("month before": the end of the month before; or "same month") | expiry month = month of manufacture + shelf life (− 1); the worked line | — | date not YYYY-MM-DD; shelf life not 1–120 whole months |

F1–F7 and the rest of F8 (step flow) belong to the batch engine and are not here.

## Check templates

| ID | Name | Inputs | What it checks | Refusals |
|---|---|---|---|---|
| C1 | Within limits | value, limit; or ± % / ± amount around a value computed earlier in the batch (e.g. the target tablet weight from the blend assay) | low–high, one side, strict bounds, alert/action tiers, pharmacopoeia rounding, unit conversion; around a centre: the deviation is rounded to the decimals of the ± figure | bad limit text (no exponents), low above high, alert outside action, unit of another kind |
| C2 | Count of readings | the readings (or the count), required number | exactly N, or at least N | count not a whole number |
| C3 | All individual values | series (or pairs); band: absolute limits or ± % of the mean / of a target; number allowed outside; outer band where none may be outside | each unit; e.g. not more than 2 outside ± 5 %, none outside ± 10 %. A ± % deviation is rounded to the decimals of the % written | negative band; bad count allowed |
| C4 | Observation | question; answers (per unit or one); expected answer(s); fixed list (default yes/no); failures allowed | pass/fail; `triggersF3` when it fails | answer not in the list; no answer |
| C5 | Same basis (safety rule, built into T9) | whether the standard is the anhydrous or hydrate/solvate weight; assay basis; what the assay is expressed as; whether the potency is "as parent"; whether a T11 factor is in the chain | refuses: (1) hydrate/solvate MW **and** a water/LOD/solvent correction (pantoprazole: about 6.7 % too much); (2) hydrate weight with an as-is assay expressed as the anhydrous substance; (3) anhydrous weight with an assay expressed as the hydrate; (4) **potency "as parent" (µg parent per mg of material) or "as element" (% Ca, % Zn, % Fe) with a T11 salt/ester/hydrate/compound factor in the same chain** (azithromycin dihydrate ×1.048, cefuroxime axetil ×1.203, faropenem sodium hemipentahydrate ×1.235, calcium carbonate ×2.497, zinc sulfate monohydrate ×2.745 too much); (5) "as parent"/"as element" with a salt/compound weight as the standard. **Allowed**: a factor from the labelled salt or hydrate *down* to the form the potency or assay is on (below 1, to a form without crystal water): procaterol HCl hemihydrate → anhydrous then a water correction (F0088), desmopressin acetate → base with the peptide content as base (F0434). A solvate MW with a solvent-free basis counts the solvent twice (F0201) | — |
| F2 helper | No further change (`noFurtherChange`) | previous round's reading, this round's reading, the largest change (an amount, or % of the previous reading) | "constant weight": \|current − previous\| rounded to the limit's decimals ≤ limit → stop repeating. The round loop itself is the engine's (F2) | readings of different kinds; % change from zero |
| C6 | Staged test | test type and the results of each stage | disintegration (6, then 12 more, 16 of 18); content uniformity L1/L2 (via T14); dissolution IR S1–S3; ER L1–L3 per time point; delayed release acid A1–A3 and buffer B1–B3. Says pass, "next stage" (and how many more units) or fail | wrong number of units per stage; wrong number of time points |
| C7 | Sampling plan by lot size (AQL) | lot size, inspection level (S-1…S-4, I, II, III), AQL per defect class, defects found (optional) | code letter (Table I), sample size, accept/reject per class (Table II-A single, normal, arrows followed); 100 % inspection when the sample would reach the lot size; accept/reject when defects are given | AQL not a table column (0.010–10 only); unknown level; lot size not a whole number |
| C8 | Printed data (packing, TB-P5, TB-P9) | what is checked; the text as printed; the batch record's value: a text (batch number), a month (date of manufacture), the expiry (worked out by T27 from the date of manufacture and shelf life) or the MRP (none when the pack has none) | the printed text against the batch record, after its printed label in any punctuation, spacing and case ("B.No.", "MFG.DT.", "MFD.", "Mfg. Date", "EXP.DT.", "EXP.", "Use before", "M.R.P. Rs. … (Incl. of all taxes)"): text without spaces and case, months in the usual printed forms ("10/2028", "OCT.2028", "10-28"), money as its amount; the values themselves exactly | no printed text; a bad date of manufacture or shelf life |
| C9 | Serialisation codes (packing, TB-P5) | the codes read from sample packs ("(01)…(17)…(10)…(21)…" or raw with a group separator); the pack GTIN; batch number; date of manufacture and shelf life; the codes of earlier rounds | each code: GTIN, batch and expiry (AI 17, YYMMDD) are this batch's; a serial of 1 to 20 GS1 characters; no serial twice in the round or in an earlier round. Checks only: no serial numbers are made or kept | no code; a pack GTIN without its right check digit |

C7 uses the MIL-STD-105E tables, which are US government work in the public domain. They give the
same numbers as ANSI/ASQ Z1.4 and ISO 2859-1 single sampling, normal inspection. The ISO text is not
copied. "AQL 0" for critical defects is treated as a plant rule: accept 0, reject 1, at the code
letter's sample size.

## Calculation checks in the master check

Error-proofing at master-building time (owner decision of 15 November 2026), not GMP rules. The master check
(`shared/master/checks.ts`) shows each on its item, with its path. Tests: `test/master-checks.test.ts`
("calculation check").

| | Check | Where |
|---|---|---|
| ⛔ | Water counted twice: hydrate or solvate MW together with a water/LOD correction | C5 in T9, on the formula line |
| ⛔ | Potency "as parent/base" or "as element" with a salt, ester, hydrate or compound factor up to the weighed form (a factor down from the labelled salt to the parent is allowed: F0434) | C5 in T9, on the formula line |
| ⛔ | Molecules per salt unit ignored: a hemi-salt at 1 molecule per unit with a MW at least twice the other form's | T11, on the formula line |
| ⛔ | Negative filler: a compensating filler that cannot take the adjustments even at the nominal certificate values (salt factor, overage) | T10, on the filler |
| ⛔ | IU, CFU or activity units turned into a mass | T18, on the formula line |
| ⛔ | Negative water or solvent, or target solids out of range (T17): a calculation that needs no recorded value is worked out from the step's settings | the binder solution or coating suspension step |
| ⛔ | Weight-variation content uniformity on coated tablets other than film-coated (T14): the block's coating list has only uncoated and film-coated, and T14 refuses any other in the batch | the uniformity by weight variation step |
| ⚠️ | (a) Label basis: an API with a salt factor or a salt name: is the strength stated as the formula form or the other form, for this master's market? | formula line |
| ⚠️ | (b) A herbal or extract line: raw-herb equivalent or extract weight? | formula line |
| ⚠️ | (c) A ratio or % in a step instruction that involves the API: as weighed, as base or as anhydrous? | step |
| ⚠️ | (d) The API potency-adjusted at dispensing (T9/T18) and a line set again from an in-process granule or blend assay (T18): confirm intended, with a reason, or remove one | the in-process line |
| ⚠️ | (e) A salt factor written in the formula that differs from the molecular-weight ratio of the named forms by more than 0.5 %: confirm, with a reason, or correct it (the quantity uses the molecular weights) | formula line |

| ⛔ | A batch quantity written on a line that the quantity per tablet × the batch size (T8) does not give, at its decimals (F0303, F0388) | formula line, `batchQuantity` |
| ⛔ | One material twice in the same place (and layer) with two quantities (F0250) | the second line |
| ⛔ | The coating lines do not add up to the coated − core weight (the core lines against the core weight were already checked: F0159, F0042) | formula |
| ⛔ | The API per tablet does not give the label claim (0.5 %), on the label basis answered in (a): the formula form, or the other form by the MWs. An excess must be a declared overage (T16), which the batch quantity adds (F0122, F0123, F0229) | formula line, `labelClaim` |
| ⛔ | The same for each strength compressed from the same blend: API per tablet × that strength's core weight ÷ this core weight (F0225, F0366) | `header.otherStrengths` |
| ⛔ | A label claim in mEq without the ion charge on the salt form (F0393: 3 times the potassium when read as mmol of the salt) | formula line |
| ⛔ | An in-process result into T18 without saying whether it is the content or a % of theoretical (F0205: about a third of the dose) | the in-process line |
| ⛔ | A coat or spray step using a liquid made with an overage, without the liquid to apply per charge (F0339: +4.5 % drug, +14 % coat when all is sprayed) | the spray step |
| ⛔ | T26 refuses properties that do not mix by mass (D50, hardness, pH: F0418), values on different bases (F0027) and a second marker pushed out (F0450) | the step using T26 |
| ⚠️ | (f) Label basis for each other strength from the same blend | `header.otherStrengths` |
| ⚠️ | (g) The core weight against the die bore area × the compression thickness: an apparent density outside 0.5-2.5 g/cm³ (F0135: a 10 × unit error) | the compression step |
| ⚠️ | (h) A mean-weight limit that holds neither the core nor the coated weight: the weight at which stage? (F0175) | the limit |
| ⚠️ | (i) An API named wet, cake or damp with no solvent correction (F0204: about 23 % too little) | formula line |
| ⚠️ | (j) A processing aid (polyethylene, camphor, menthol …) not marked removed in processing (F0476: about 12.5 % too much drug) | formula line |
| ⚠️ | (k) A particle-size, surface-area or crystal-form test with one limit only (F0490: Cmax 67.5-130 %) | the limit |
| ⚠️ | (l) An order-critical step (`orderAfter`) no longer after the step it must follow (F0318) | the step |

A ⚠️ needs an answer: one of its choices, with a reason for (d) and (e). The answer is kept in the master document
(`answers`, by warning and item) and shown in the review and changes views. It counts while the warning reads the same
as when it was answered; until then the warning blocks "Send for review" and approval like a ⛔.

## Pharmacopoeia rules written from the chapters (paraphrased; no chapter text copied)

- **T14 (USP <905> / Ph. Eur. 2.9.40).**
  - Reference value M: for T ≤ 101.5, M = 98.5 if X̄ < 98.5, M = X̄ up to 101.5, and M = 101.5 above that.
    For T > 101.5, M = 98.5 if X̄ < 98.5, M = X̄ up to T, and M = T above that.
  - k = 2.4 for 10 units and 2.0 for 30 units.
  - Stage 1 passes if AV ≤ L1 = 15.0. Stage 2 passes if AV ≤ 15.0 and every unit lies within 0.75 M to 1.25 M (L2 = 25.0).
  - Weight variation is only for uncoated and film-coated tablets, with ≥ 25 mg of drug making up ≥ 25 % of the unit.
- **C6.** USP <701> / Ph. Eur. 2.9.1 for disintegration, and the USP <711> acceptance tables for dissolution.

## Settings left to the engine (smallest data-level option)

- **F4 by a rule** (F0040): a step's `onlyIf` (a limit on the batch size or the core batch weight) leaves it out as not
  applicable, with no operator choice. A rule on a value recorded during the batch is not supported.
- **F6 with a changing interval** (F0030): `everyMinutesLater` (after N minutes from the first round, a round every M
  minutes; still at most the block's interval, TB-15). A change "as the target nears" (on a value) is not supported.

## Decisions taken while building (see also the report)

- **T13 accumulated time:** an interval between two readings counts only when both readings are inside the limits.
  This is conservative: time next to an out-of-limit reading never counts.
- **T14 large sample (Ph. Eur. 2.9.47):** the library does not hold that chapter's table. The master supplies k
  for the sample size and the number of units allowed outside 0.75 M–1.25 M.
- **T9 "as is" with a hydrate weight:** refused unless the master confirms that the assay is expressed as the hydrate.
  This is stricter than "no further water correction", because an as-is assay expressed as the anhydrous
  substance also counts the water twice.
- **T22:** % retained is of the total weight recovered. Recovery against the sample weight is the template's value.
- **T26 ethanol:** % v/v ↔ % w/w at 20 °C from the density polynomial of the international alcoholometric tables
  (OIML R 22, Council Directive 76/766/EEC, 12 coefficients), solved by bisection; 96 % v/v = 93.84 % w/w.
- **Written salt factor:** in the master it stays the answered warning (e), because the batch quantity uses the
  molecular weights, not the written factor; T11 refuses a `writtenFactor` only where a calculation is given one.
- **T14 stratified:** the library does not compute Bergum's acceptance limits (ASTM E2709); the master supplies the
  table for its sample size, confidence and coverage, as for the large sample.
- **T25:** Magnus formula over water with the WMO (Sonntag 1990) constants 6.112 hPa, 17.62, 243.12 °C. The ratio
  621.98 is 1000 × M(water) ÷ M(dry air).

## Files

- `dec.ts`, `refuse.ts`, `core.ts`: decimals, refusals, reading values, display. `index.ts` exports everything.
- `units.ts`, `rounding.ts`
- `basic.ts` (T1–T6, T21), `series.ts` (T7, C1–C4, noFurtherChange), `mixing.ts` (T26 and the alcohol table),
  `dispensing.ts` (T8–T12, T15, T16, T18–T20, C5), `liquid.ts` (T17), `time.ts` (T13, F8), `uniformity.ts` (T14),
  `physical.ts` (T22, T22 mixed lots, T23–T25), `staged.ts` (C6), `sampling.ts` (C7); `uniformity.ts` also T14 stratified;
  `packing.ts` (T27, C8, C9: TrueBatch Tablets Packing)
- `test/templates/*.test.ts`: table-style tests. Every test name starts with its template ID. Each expected number
  has its hand calculation in a comment. Real cases cite the formulation number from the formulation test.
