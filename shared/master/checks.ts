/**
 * Master checks: pure checks over one master document. Each problem is an error (⛔, the version cannot be approved)
 * or a warning (⚠️), with the path to the item. Template settings are checked by the templates library itself.
 * The calculation checks (calculationChecks below) are error-proofing of the calculations, not GMP rules.
 */
import { findBlock, type Block } from '../blocks/index.js';
import { Dec, c1WithinLimits, convert, findUnit, t10Compensating, t11SaltFactor, t2Total, type Q } from '../templates/index.js';
import { decimalsOf } from '../templates/core.js';
import { claimMg, claimWords, evaluate, headerValue, lineQuantity, perBatch } from '../engine/values.js';
import { materialLines, type Answer, type FormulaLine, type Limit, type MasterDoc, type SettingValue } from './schema.js';
import { packingChecks } from './packing.js';
import { unitKindProblem } from './kinds.js';
import { isBalance } from '../engine/picks.js';

/** A warning the author answers: one of the options, with a reason when `needsReason`. */
export interface Question { key: string; options: string[]; needsReason: boolean; answer?: Answer }
export interface Problem { level: 'error' | 'warning'; path: string; message: string; rule?: string; question?: Question }

/**
 * A message in plain words for the people who read it: without the internal codes of the rules (TL-11), templates
 * (T9) and failure cases (F0204) the code comments use. The rule stays in `rule` for the tests.
 */
export const plainWords = (m: string) => m
  .replace(/\s*\((?:TL-P?\d+|T\d+)\)/g, '')
  .replace(/\bF0\d{3}:\s*/g, '')
  .replace(/\s*\(F0\d{3}\)/g, '');

/** What stops "Send for review" and approval: an error, or a warning that needs an answer and has none. */
export const blocking = (p: Problem) => p.level === 'error' || (p.question !== undefined && !p.question.answer);

const QUANTITY = /^[+-]?(\d+(\.\d*)?|\.\d+)\s*(\S.*)?$/;
const DECIMAL = /^\d+(\.\d+)?$/;
// Neutral certificate values for checking a formula line's adjustment settings with the templates themselves.
const SAMPLE = { assay: { value: '100.0', unit: '%' }, water: { value: '0', unit: '%' }, lod: { value: '0', unit: '%' } };
const HERE = { stage: 0, sub: 1, step: 0, round: 1 };

export function masterChecks(doc: MasterDoc): Problem[] {
  const out: Problem[] = [];
  const error = (path: string, message: string, rule?: string) => out.push({ level: 'error', path, message, ...(rule ? { rule } : {}) });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));

  // A packing master (it has a pack) has its own checks instead of the formula and calculation checks.
  if (doc.pack) out.push(...packingChecks(doc));
  else formulaChecks(doc, out, error);

  twice(doc.stages.map((s) => s.key), 'stages');
  // TL-11: a master that weighs names the rooms its materials are weighed in (its balances are offered there).
  const weighs = doc.stages.some((s) => s.steps.some((t) => findBlock(t.block)?.fields.some((f) => f.kind === 'machine' && isBalance(f))));
  if (weighs && !doc.header.dispensingRooms?.length) error('header.dispensingRooms', 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)', 'TL-11');
  doc.stages.forEach((s, si) => {
    const path = `stages[${si}]`;
    twice(s.steps.map((t) => t.key), `${path}.steps`);
    if (s.kind === 'sub-batch' && !s.count) error(path, 'A sub-batch stage needs the number of sub-batches');
    if (s.produces && !s.produces.holdHours) error(`${path}.produces`, `The intermediate ${s.produces.name} has no hold time`, 'TL-01');
    // Everything the plain view would show as "(not set)" is reported here (the plain view's sentences, describe.ts).
    if (!s.role.trim()) warn(path, `Stage ${s.name} names no responsible role`);
    if (!doc.pack && s.kind !== 'preparation' && !s.steps.some((t) => findBlock(t.block)?.gmp === 'yield')) error(path, `Stage ${s.name} has no yield step`);
    if (s.kind === 'preparation' && !doc.stages.some((x) => x.uses.includes(s.key))) warn(path, `No stage uses the preparation ${s.name}`);
    // TL-10: a stage worked in a room starts with line clearance.
    const clearance = s.steps.findIndex((t) => findBlock(t.block)?.gmp === 'line-clearance');
    if (s.roomTypes.length && clearance < 0) error(path, `Stage ${s.name} is worked in a room but has no line clearance step`, 'TL-10');
    if (clearance > 0 && !doc.pack) warn(`${path}.steps[${clearance}]`, `Line clearance is not the first step of ${s.name}`);
    // TL-11: a stage that works machines (not balances, nor the line a packing batch is issued to) or names a room
    // runs only in the rooms it allows (shared/engine/picks.ts).
    const placed = s.steps.some((t) => { const b = findBlock(t.block); return !b?.atIssue && b?.fields.some((f) => f.kind === 'room' || (f.kind === 'machine' && !isBalance(f))); });
    if (placed && !s.roomTypes.length) error(`${path}.roomTypes`, `Stage ${s.name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`, 'TL-11');
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((x) => x.key === u);
      if (pi < 0 || pi >= si) error(`${path}.uses`, `${u} is not an earlier stage`);
      else if (!doc.stages[pi]!.produces) error(`${path}.uses`, `Stage ${doc.stages[pi]!.name} produces no intermediate`);
    }
    s.steps.forEach((st, ti) => {
      const p = `${path}.steps[${ti}]`;
      const block = findBlock(st.block);
      if (!block) return void error(`${p}.block`, `No block ${st.block.id} version ${st.block.version}`);
      if (block.packing && !doc.pack) error(p, `${block.name} is a packing step: a manufacturing master cannot use it`);
      if (!st.checker && (block.gmp || st.critical)) error(p, `${block.gmp ? `A ${block.gmp.replace('line-clearance', 'line clearance')} step` : 'A critical step'} needs a second-person check`, 'TL-08');
      if (st.critical && st.flow.kind === 'optional-with-reason') error(`${p}.flow`, 'A critical step cannot be optional');
      if (st.waitForCheck && !st.checker) warn(p, 'The next step waits for a check this step does not have');
      for (const bs of block.settings) if (!bs.optional && st.settings[bs.name] === undefined) error(`${p}.settings.${bs.name}`, `${bs.label} is not set`);
      for (const [name, v] of Object.entries(st.settings)) {
        const bs = block.settings.find((x) => x.name === name);
        const listed = !bs?.options || (typeof v === 'string' && bs.options.includes(v));
        const why = !bs ? `The block ${block.name} has no setting ${name}` : listed ? settingProblem(doc, si, ti, bs.kind, v) : `${bs.label}: choose one of ${bs.options!.join(', ')}`;
        if (why) error(`${p}.settings.${name}`, why);
        // TL-01: a limit (or a typed target) in a unit of another kind than the value it checks.
        const unit = typeof v === 'object' && 'unit' in v ? v.unit : typeof v === 'string' && bs?.kind === 'quantity' ? QUANTITY.exec(v)?.[3] : undefined;
        const wrong = !why && unit !== undefined ? unitKindProblem(block, name, st.settings, unit) : null;
        if (wrong) error(`${p}.settings.${name}`, wrong, 'TL-01');
      }
      // A temperature recorded with optional limits left empty is recorded without a check (the disintegration
      // medium at 37 ± 2 °C, an inlet or forming temperature): a warning, so the author sets them or leaves them knowingly.
      for (const c of block.calcs) {
        const a = c.args as { value?: unknown; limit?: unknown };
        const lim = c.template === 'C1' && typeof a.limit === 'string' ? block.settings.find((x) => x.name === a.limit!.toString().slice(1) && x.optional) : undefined;
        const f = typeof a.value === 'string' ? block.fields.find((x) => x.name === (a.value as string).slice(1)) : undefined;
        if (lim && f && findUnit(f.unit ?? '')?.kind === 'temperature' && st.settings[lim.name] === undefined) warn(`${p}.settings.${lim.name}`, `${f.label} is recorded but not checked: set the ${lim.label.toLowerCase()}`);
      }
      // A stage's yield (by mass) on an earlier stage's output while this stage adds formula materials (extragranular materials,
      // the lubricant): the base leaves out what the stage adds, so the yield reads above 100 %.
      const base = block.id === 'stage-yield' ? st.settings.theoretical : undefined;
      const from = base && typeof base === 'object' && 'ref' in base ? doc.stages.find((x) => x.key === base.ref.split('/')[0]) : undefined;
      if (from && from !== s && !doc.pack) {
        const added = [...new Set(s.steps.flatMap((x) => Object.values(x.settings)).flatMap((v) => (typeof v === 'object' && 'formula' in v ? [v.formula] : [])))]
          .map((k) => doc.formula.find((l) => l.key === k)?.name).filter((n): n is string => !!n);
        if (added.length) error(`${p}.settings.theoretical`, `The yield of ${s.name} is worked out on the output of ${from.name} only, but ${s.name} adds ${added.join(' and ')}: the yield would read above 100 %. Take the theoretical core batch weight (or a quantity that includes what this stage adds) as the theoretical quantity`);
      }
      // A calculation that needs no recorded value is worked out now (e.g. a liquid make-up, T17): a refusal must be fixed.
      const now = evaluate(doc, [], { stage: si, sub: 1, step: ti, round: 1 }, {});
      for (const c of block.calcs) { const r = now[c.name]; if (r && !r.ok) error(p, `${c.label}: ${r.message}`); }
      if (st.flow.kind === 'repeat-until') {
        if (!st.flow.maxRounds) error(`${p}.flow`, 'A repeat-until step needs the most rounds allowed');
        const stop = st.flow.stop ?? block.stop;
        if (!stop || !block.calcs.some((c) => c.name === stop)) error(`${p}.flow`, 'A repeat-until step needs a stop check (a calculation of its block)');
      }
      if (st.everyMinutes && st.flow.kind !== 'repeat-until') error(`${p}.everyMinutes`, 'Checks every N minutes need a repeat-until step');
      const later = st.everyMinutesLater;
      if (later && !st.everyMinutes) error(`${p}.everyMinutesLater`, 'A later interval needs the interval of the first checks');
      if (later && block.periodic && later.everyMinutes > block.periodic.maxMinutes) error(`${p}.everyMinutesLater`, `Periodic checks every ${later.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, block.packing ? 'TL-P5' : 'TL-14');
      if (st.onlyIf) {
        const r = c1WithinLimits({ value: { value: '0', unit: st.onlyIf.header === 'batchSize' ? 'tablets' : 'kg' }, limit: st.onlyIf.limit });
        if (!r.ok) error(`${p}.onlyIf`, `The rule for leaving the step out: ${r.message}`);
      }
      // A spray of a liquid made in excess: the amount to apply per charge, or all of it would be sprayed (F0339).
      const excess = /^(coat|spray-coat)$/.test(st.block.id) && s.uses.some((u) => doc.stages.find((x) => x.key === u && x.kind === 'preparation')?.steps
        .some((t) => Object.values(t.settings).some((v) => typeof v === 'object' && 'formula' in v && v.adjusted && doc.formula.find((f) => f.key === v.formula)?.adjust?.overage)));
      if (excess && !st.applyPerCharge) error(p, 'The liquid is made with an overage: state the amount to apply per charge, and stop at that net weight (F0339: spraying all of it gives about 4.5 % more drug); the rest goes to the reconciliation');
      if (st.applyPerCharge) for (const [k, v] of Object.entries(st.applyPerCharge)) if (!isMass(v)) error(`${p}.applyPerCharge.${k}`, `"${v}" is not a mass with a unit, e.g. "971 g"`);
      if (block.periodic && !st.everyMinutes) error(`${p}.everyMinutes`, `${block.name} needs the interval of its periodic checks`, block.packing ? 'TL-P5' : 'TL-14');
      if (block.periodic && st.everyMinutes && st.everyMinutes > block.periodic.maxMinutes) {
        error(`${p}.everyMinutes`, `Periodic checks every ${st.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, block.packing ? 'TL-P5' : 'TL-14');
      }
    });
  });
  return out.map((p) => ({ ...p, message: plainWords(p.message) }));
}

/**
 * The formula: per mL of a liquid (the vehicle made up to volume has no quantity: q.s.), or per g of a dry syrup powder
 * (its solids add up to 1000 mg per g).
 */
function formulaChecks(doc: MasterDoc, out: Problem[], error: (path: string, message: string, rule?: string) => void): void {
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));
  twice(doc.formula.map((l) => l.key), 'formula');
  const solids = doc.formula.filter((l) => l.role !== 'solvent');
  if (!solids.length) error('formula', 'The formula has no materials');
  const qs = doc.formula.map((l, i) => [l, i] as const).filter(([l]) => l.mg === undefined);
  for (const [l, i] of qs) if (l.role !== 'solvent') error(`formula[${i}].mg`, `${l.name} has no quantity: only the vehicle made up to volume (q.s.) has none`);
  if (qs.length > 1) error('formula', 'Only one vehicle is made up to volume (q.s.)');
  if (doc.header.type === 'dry syrup') {
    if (qs.length) error('formula', 'A dry syrup powder has no vehicle made up to volume: every line has its mg per g');
    const total = t2Total({ values: solids.filter((l) => l.mg !== undefined).map((l) => `${l.mg} mg`), unit: 'mg' });
    if (total.ok && solids.length && !total.value.eq(1000)) error('formula', `The materials add up to ${total.value.toString()} mg per g of powder, not 1000 mg`);
  }
  doc.formula.forEach((l, i) => {
    const a = l.adjust;
    if (!a) return;
    if (a.potency && a.content) error(`formula[${i}].adjust`, 'A line is adjusted for potency (T9) or for content (T18), not both');
    for (const k of a.compensates ?? []) if (k === l.key || !doc.formula.some((x) => x.key === k)) error(`formula[${i}].adjust.compensates`, `No other formula line ${k} to compensate`);
    const values = { ...SAMPLE, content: nominal(l) };
    if (a.content?.contentSource === 'in-process result' && !a.content.resultType) {
      error(`formula[${i}].adjust`, `State what the in-process result for ${l.name} is: the content (% w/w) or a relative assay in % of theoretical (F0205: a % of theoretical read as the content gives about a third of the dose)`);
    }
    const r = lineQuantity(doc, [], HERE, { ...l, adjust: { ...a, compensates: undefined } }, true, values);
    if (!r.ok) error(`formula[${i}].adjust`, r.message, a.potency ? 'TL-13' : undefined);
    // A compensating filler that would go below zero even at the nominal certificate values (salt factor, overage).
    const others = (a.compensates ?? []).map((k) => doc.formula.find((x) => x.key === k)).filter((x): x is FormulaLine => !!x && x.key !== l.key);
    const quantity = (x: FormulaLine, adjusted: boolean) => {
      const r = lineQuantity(doc, [], HERE, x, adjusted, { ...SAMPLE, content: nominal(x) });
      return r.ok ? { value: r.value, unit: r.unit } : undefined;
    };
    const std = quantity(l, false);
    const adj = others.map((x) => ({ name: x.name, standard: quantity(x, false), adjusted: quantity(x, true) }));
    if (std && adj.length && adj.every((x) => x.standard && x.adjusted)) {
      const t10 = t10Compensating({ fillers: [{ name: l.name, standard: std }], adjusted: adj as { name: string; standard: Q; adjusted: Q }[] });
      if (!t10.ok) error(`formula[${i}].adjust.compensates`, `At the nominal certificate values: ${t10.message.replace(/; raise a deviation$/, '')}`, 'TL-13');
    }
  });
  formulaSums(doc, error);
  calculationChecks(doc, out);
  liquidChecks(doc, out);
}

// The liquids master checks (library section 7, plan data change 4), from the 457-formulation test: error-proofing of
// the header and the claim, not GMP rules (TL-01 asks for the header's content).
const NON_AQUEOUS = /\b(oil|glycerol|glycerin|glycerine|syrup|sucrose|sugar|sorbitol|maltitol|propylene glycol|polyethylene glycol|macrogol|ethanol|alcohol|liquid paraffin)\b/i;
const ETHANOL = /\b(ethanol|alcohol)\b/i;
const ETHANOL_GRADE = /\b(absolute|anhydrous|dehydrated|9[0-9](\.\d+)?\s*%|rectified)/i;
const DILUTED = /\b(diluted|dilution|premix|blend|with silica|adsorbate|triturate|\d+\s*%\s*(w\/w)?\s*(on|in|with))\b/i;
const PRESERVATIVE = /\b(paraben|hydroxybenzoate|benzoate|benzoic acid|sorbate|sorbic acid|preservative)\b/i;
function liquidChecks(doc: MasterDoc, out: Problem[]): void {
  const h = doc.header;
  const ask = asker(doc, out);
  const error = (path: string, message: string) => out.push({ level: 'error', path, message, rule: 'TL-01' });
  const powder = h.type === 'dry syrup';
  if (!h.type) error('header.type', 'Choose the product type (solution, drops, suspension, emulsion or dry syrup)');
  if (powder && h.batchUnit !== 'kg') error('header.batchUnit', 'A dry syrup powder is made in kg');
  // A liquid batch has its density: a batch in kg, a make-up by weight and the fill weight need it (library 7).
  if (!powder && !h.densityGPerMl) error('header.densityGPerMl', `The density of the ${h.batchUnit === 'kg' ? 'batch made in kg' : 'liquid'} is not set: a batch in kg, a make-up by weight and the fill weight need it`);
  if (!powder && h.densityGPerMl && !h.densityAtC) error('header.densityAtC', 'The temperature the density is measured at is not set');
  if (!h.claimPer) error('header.claimPer', 'Choose what the label claim is per');
  if (h.claimPer && h.claimPer !== 'none' && !h.claimAs?.trim()) error('header.claimAs', 'Name what the label claim is of: the base, salt, ion or element, with its hydrate (KCl or K, pyrantel or its embonate)');
  if (h.claimPer === 'drop' && !h.dropsPerMl) error('header.dropsPerMl', 'A claim per drop needs the drops per mL of the dropper (30 or 40 drops per mL is 25-33 % apart)');
  if (h.claimPer === 'dose volume' && !h.doseVolumeMl) error('header.doseVolumeMl', 'A claim per dose volume needs the dose volume (5 mL, 10 mL …)');
  if (h.claimPer === 'g of powder' && !powder) error('header.claimPer', 'A claim per g of powder is for a dry syrup powder');
  if (powder) {
    if (!h.fillWeightG) error('header.fillWeightG', 'The fill weight of powder per container is not set');
    if (h.claimPer === 'g of powder') {
      if (h.reconstitutedMl) error('header.reconstitutedMl', 'A powder claimed per g is not made up to a volume: leave the volume after reconstitution empty');
      // Scoop-dosed powder: the scoop doses by volume, so the bulk density is checked (a scoop against a teaspoon is 4 times).
      if (!doc.stages.some((s) => s.steps.some((t) => t.block.id === 'density-flow'))) error('stages', 'A powder claimed per g (dosed by scoop) needs a bulk density step (density-flow) with its limits');
    } else if (h.claimPer !== 'container' && h.claimPer !== 'none' && !h.reconstitutedMl) {
      error('header.reconstitutedMl', 'The volume after reconstitution is not set: the claim per mL uses the reconstituted (mixed) volume, never the water to add or the usable volume (31 % under-dose)');
    }
  }
  if (h.claimPer === 'dose volume' && h.doseVolumeMl && !new Dec(h.doseVolumeMl).eq(5)) {
    ask('header.doseVolumeMl', 'dose-volume', `The claim is per ${h.doseVolumeMl} mL. Is that the dose volume the label states the claim per? A claim per 10 mL keyed per 5 mL is 2 times the dose.`, ['the label states it per this volume']);
  }
  if (!powder && h.densityGPerMl && new Dec(h.densityGPerMl).eq(1)) {
    const vehicle = doc.formula.find((l) => NON_AQUEOUS.test(l.name));
    if (vehicle) ask('header.densityGPerMl', 'density-water', `The density is 1.000 g/mL, but the formula has ${vehicle.name}: an oil, sugar, polyol or alcohol vehicle is up to 24 % away from water. Confirm the measured density, with the reason, or correct it.`, ['measured 1.000 g/mL'], true);
  }
  doc.formula.forEach((l, i) => {
    if (l.role !== 'api' || l.mg === undefined) return;
    const per = claimMg(doc, l.mg);
    if (typeof per !== 'string' && per.lte(1) && per.gt(0)) {
      ask(`formula[${i}]`, `high-potent/${l.key}`, `${l.name} is ${per.toFixed(3, Dec.ROUND_HALF_UP)} mg ${claimWords(doc)}: confirm the label is in mg and not in µg (1000 times).`, ['mg is right']);
    }
    if (DILUTED.test(l.name) && !l.adjust?.potency && !l.adjust?.content) {
      ask(`formula[${i}]`, `diluted-lot/${l.key}`, `${l.name} looks like a blend or dilution of the API: its quantity needs the lot's own content as is (a potency or content adjustment). Weighed as pure API it gives about half the dose. Is it pure API?`, ['pure API'], true);
    }
  });
  doc.formula.forEach((l, i) => {
    if (ETHANOL.test(l.name) && !ETHANOL_GRADE.test(l.name)) error(`formula[${i}]`, `Name the grade of ${l.name} (absolute, 96 % or 95 % v/v): 96 % ethanol is not absolute ethanol`);
    if (powder && PRESERVATIVE.test(l.name)) {
      ask(`formula[${i}]`, `preservative-basis/${l.key}`, `${l.name} in a dry syrup: a preservative % is of the reconstituted volume. Is its mg per g worked out from the % of the volume after reconstitution (per container ÷ the fill weight)?`, ['yes, from the reconstituted volume']);
    }
  });
}

const nominal = (l: FormulaLine) => (l.adjust?.content?.resultType === 'percent of theoretical' ? SAMPLE.assay : l.adjust?.content?.nominalContent ?? SAMPLE.assay);
const quantityOf = (text: string | undefined) => { const m = QUANTITY.exec(text ?? ''); const u = m && findUnit(m[3] ?? ''); return m && u ? { v: new Dec(m[1]!), u, text: text! } : undefined; };
const isMass = (text: string) => quantityOf(text)?.u.kind === 'mass';
const off = (a: Dec, b: Dec) => a.minus(b).abs().div(b).times(100);

/**
 * Calculation checks on the formula's own numbers (refusals): a batch quantity written that per mL (or g) × the batch
 * does not give (F0303, F0388), and one material twice in one place with two quantities (F0250).
 */
function formulaSums(doc: MasterDoc, error: (path: string, message: string) => void): void {
  doc.formula.forEach((l, i) => {
    if (l.batchQuantity !== undefined) {
      const w = quantityOf(l.batchQuantity);
      const t8 = perBatch(l.mg, doc);
      const value = w && t8.ok && 'value' in t8 ? (t8 as { value: Dec; unit: string }) : undefined;
      if (!w || w.u.kind !== 'mass') error(`formula[${i}].batchQuantity`, `"${l.batchQuantity}" is not a mass with a unit, e.g. "24.000 kg"`);
      else if (value && !convert(value.value, findUnit(value.unit)!, w.u).toDecimalPlaces(decimalsOf(l.batchQuantity.split(/\s/)[0]!), Dec.ROUND_HALF_UP).eq(w.v)) {
        error(`formula[${i}].batchQuantity`, `The batch quantity ${l.batchQuantity} written for ${l.name} is not ${(t8 as { shown: string }).shown}: every batch quantity comes from the quantity per ${perWhat(doc)} × the batch (T8). Correct the batch column or the mg per ${perWhat(doc)}`);
      }
    }
    const twin = doc.formula.findIndex((x, j) => j < i && x.materialItemId === l.materialItemId && x.place === l.place);
    const tw = doc.formula[twin];
    if (tw && tw.mg !== undefined && l.mg !== undefined && !new Dec(tw.mg).eq(l.mg)) {
      error(`formula[${i}]`, `${l.name} appears twice${l.place ? ` in the ${l.place} part` : ''} with two quantities (${tw.mg} and ${l.mg} mg per ${perWhat(doc)}): keep one line with the quantity that is charged`);
    }
  });
}
const perWhat = (doc: MasterDoc) => (doc.header.type === 'dry syrup' ? 'g' : 'mL');

// Calculation checks (owner decision of 15 November 2026). Not GMP rules: error-proofing of the calculations while the
// master is built. The refusals (water counted twice, potency as parent or element with a salt factor, molecules per
// salt unit, negative filler, IU or CFU as a mass) come from the templates through the formula checks above. These
// warnings need an answer, kept in the master document under their key; the answer counts while the warning reads the
// same as when it was answered.
const SALT_WORD = /\b(hydrochloride|hcl|hydrobromide|sodium|potassium|calcium|magnesium|zinc|maleate|fumarate|hemifumarate|succinate|tartrate|besylate|besilate|mesylate|mesilate|citrate|phosphate|sulfate|sulphate|acetate|bromide|chloride|nitrate|lactate|gluconate|tosylate|oxalate|malate|carbonate|oxide)\b/i;
const HERBAL = /\b(extracts?|herbs?|herbal|botanical|churna|tincture|oleoresin)\b|\b(leaf|leaves|roots?|rhizomes?|bark|seeds?|fruits?|flowers?)\s+powder\b/i;
const WET = /\b(wet|cake|damp|solvent-wet)\b/i;
const AID = /\b(polyethylene|camphor|menthol|thymol|ammonium (bi)?carbonate|processing aid)\b/i;
const SIZE = /\b(d\s?\(?0?\.?[159]0?\)?|d10|d50|d90|dv\d+|particle size|surface area|polymorph|crystal form)\b/i;
const RATIO = /\d+(\.\d+)?\s*(:\s*\d+(\.\d+)?|%(\s*w\/w)?)/;

/** A warning the author answers (kept under its key while the warning reads the same); the choice once answered. */
const asker = (doc: MasterDoc, out: Problem[]) => (path: string, key: string, message: string, options: string[], needsReason = false) => {
  const a = doc.answers?.[key];
  const ok = a && (a.about === message || a.about === plainWords(message)) && options.includes(a.choice) && (!needsReason || a.reason.trim() !== '');
  out.push({ level: 'warning', path, message, question: { key, options, needsReason, ...(ok ? { answer: a } : {}) } });
  return ok ? a.choice : undefined;
};

function calculationChecks(doc: MasterDoc, out: Problem[]): void {
  const ask = asker(doc, out);
  const refuse = (path: string, message: string) => out.push({ level: 'error', path, message });
  const apis = doc.formula.filter((l) => l.role === 'api');
  // (d) the API adjusted for potency at dispensing, then set again from an in-process granule or blend assay
  const atDispensing = apis.find((l) => l.adjust?.potency || (l.adjust?.content && l.adjust.content.contentSource !== 'in-process result'));
  doc.formula.forEach((l, i) => {
    const salt = l.adjust?.salt;
    // (a) the label basis for this master's market
    if (l.role === 'api' && (salt || SALT_WORD.test(l.name))) {
      const formulaForm = salt?.from.name || l.name;
      const other = salt ? salt.to.name || 'the dispensed form' : 'the base, acid or element';
      const basis = ask(`formula[${i}]`, `label-basis/${l.key}`, `Label claim for this master's market: is the strength of ${l.name} stated as ${formulaForm} or as ${other}? The formula gives ${l.mg ?? '?'} mg of ${formulaForm} per ${perWhat(doc)}.`, [`as ${formulaForm}`, `as ${other}`]);
      if (l.labelClaim && l.mg !== undefined) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, l.mg, basis, l.name);
    } else if (l.role === 'api') {
      if (l.labelClaim && l.mg !== undefined) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, l.mg, `as ${l.name}`, l.name);
    }
    // A solvent-wet API weighed as if dry (F0204: about 23 % too little); answered, or corrected with the lot's solvent.
    const corrected = l.adjust?.potency?.basis === 'dried' || l.adjust?.potency?.basis === 'anhydrous and solvent-free' || l.adjust?.content?.formulaQuantityIs === 'wet';
    if (l.role === 'api' && WET.test(l.name) && !corrected) {
      ask(`formula[${i}]`, `solvent-wet/${l.key}`, `${l.name} looks solvent-wet: its quantity needs the lot's measured solvent content (an assay adjustment on the dried or solvent-free basis, or a content adjustment). Weighed as dry API it gives too little drug (F0204: about 23 %). Is it weighed dry?`, ['weighed dry'], true);
    }
    // A processing aid that is removed (rinsed out, sublimed) but counted in the product (F0476: about 12.5 % too much drug).
    if (l.role !== 'solvent' && AID.test(l.name)) {
      ask(`formula[${i}]`, `removed/${l.key}`, `${l.name} is often a processing aid removed in processing (rinsed out, sublimed). If it is removed, set its role to removed so the content, yield and reconciliation use only what stays. Does it stay in the product?`, ['stays in the product'], true);
    }
    // (b) a herbal or extract line
    if (l.role !== 'solvent' && HERBAL.test(l.name)) {
      ask(`formula[${i}]`, `herbal/${l.key}`, `${l.name} is a herbal or extract line: is ${l.mg ?? '?'} mg per ${perWhat(doc)} the raw-herb equivalent or the weight of the extract?`, ['raw-herb equivalent', 'extract weight']);
    }
    if (atDispensing && l.adjust?.content?.contentSource === 'in-process result') {
      ask(`formula[${i}].adjust`, `double-adjustment/${l.key}`, `${atDispensing.name} is adjusted for its potency at dispensing, and ${l.name} is set again from an in-process granule or blend assay (T18): the potency would be corrected twice. Confirm that this is intended, with a reason, or remove one of the adjustments.`, ['intended'], true);
    }
    // (e) a salt factor written in the formula that differs from the molecular weights by more than 0.5 %
    const t11 = salt?.factor ? t11SaltFactor({ quantity: '1 kg', from: salt.from, to: salt.to }) : undefined;
    if (salt?.factor && t11?.ok) {
      const off = new Dec(salt.factor).minus(t11.factor).abs().div(t11.factor).times(100);
      if (off.gt('0.5')) {
        ask(`formula[${i}].adjust.salt`, `salt-factor/${l.key}`, `The salt factor ${salt.factor} written for ${l.name} differs by ${off.toFixed(1, Dec.ROUND_HALF_UP)} % from the molecular weights of ${salt.from.name} and ${salt.to.name} (factor ${t11.factor.toFixed(4, Dec.ROUND_HALF_UP)}), which the batch quantity uses. Confirm with a reason, or correct the factor or the molecular weights.`, ['confirmed'], true);
      }
    }
  });
  // (c) a ratio or % in a step instruction that involves the API
  doc.stages.forEach((s, si) => s.steps.forEach((t, ti) => {
    const m = RATIO.exec(t.instruction ?? '');
    const text = (t.instruction ?? '').toLowerCase();
    const api = m && apis.find((l) => Object.values(t.settings).some((v) => typeof v === 'object' && 'formula' in v && v.formula === l.key) || text.includes(l.name.toLowerCase()));
    if (m && api) {
      ask(`stages[${si}].steps[${ti}]`, `ratio-basis/${s.key}/${t.key}`, `The instruction gives "${m[0]}" with ${api.name}: on which basis is the ${api.name} quantity taken?`, ['as weighed', 'as base', 'as anhydrous']);
    }
    const p = `stages[${si}].steps[${ti}]`;
    const block = findBlock(t.block);
    const limits = Object.entries(t.settings).filter((e): e is [string, Limit] => typeof e[1] === 'object' && 'unit' in e[1]);
    // An API lot test of particle size, surface area or crystal form needs both limits (F0490: Cmax 67.5-130 %).
    const words = Object.values(t.settings).filter((v): v is string => typeof v === 'string').join(' ') + ` ${t.instruction ?? ''}`;
    const oneSide = limits.find(([, l]) => (l.low === undefined) !== (l.high === undefined));
    if (oneSide && SIZE.test(words)) {
      ask(`${p}.settings.${oneSide[0]}`, `two-sided/${s.key}/${t.key}`, `Step ${t.key} tests particle size, surface area or crystal form with only ${oneSide[1].low === undefined ? 'an upper' : 'a lower'} limit: both sides can change the dose taken up (F0490: Cmax 67.5-130 % with the API's surface area). Confirm that one side is enough, with the reason, or add the other limit.`, ['one side is enough'], true);
    }
    // An order-critical step stays after the step it must follow (F0318: 37 % of the drug converted in the wrong order).
    if (t.orderAfter && !s.steps.slice(0, ti).some((x) => x.key === t.orderAfter)) {
      ask(p, `order/${s.key}/${t.key}`, `Step ${t.key} is order-critical: it must come after step ${t.orderAfter} in ${s.name}, and it no longer does. Put it back, or confirm the new order with the reason.`, ['new order confirmed'], true);
    }
  }));

  /** The API per claim (per mL, dose volume, drop, container or g) against a label claim (refusal), on the basis answered. */
  function labelClaim(path: string, l: FormulaLine, claim: string, perUnit: string, basis: string | undefined, what: string): void {
    const per = claimMg(doc, perUnit);
    if (typeof per === 'string') return;
    const mg = per;
    const q = quantityOf(claim);
    const salt = l.adjust?.salt;
    const form = salt?.from.name || l.name;
    if (!q || (q.u.kind !== 'mass' && q.u.kind !== 'charge')) return void refuse(path, `"${claim}" is not a label claim with a unit, e.g. "20 mg" or "10 mEq"`);
    let expected: Dec | undefined;
    if (q.u.kind === 'charge') {
      if (!salt?.from.charge) return void refuse(path, `The label claim ${claim} is in mEq: give the salt form from the ion with its charge from the material record (F0393: 10 mEq K read as mmol of the salt is 3 times the potassium)`);
      expected = q.v.div(salt.from.charge).times(salt.from.mw);
    } else {
      const claimMg = q.v.times(q.u.factor).times(1000);
      if (basis === `as ${form}`) expected = claimMg;
      else if (salt && basis === `as ${salt.to.name || 'the dispensed form'}`) expected = claimMg.times(new Dec(salt.from.mw).div(salt.from.moleculesPerUnit ?? 1)).div(new Dec(salt.to.mw).div(salt.to.moleculesPerUnit ?? 1));
    }
    if (expected && !expected.isZero() && off(mg, expected).gt('0.5')) {
      refuse(path, `${what}: ${perUnit} mg per ${perWhat(doc)} gives ${mg.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form} ${claimWords(doc)}, not the label claim ${claim} (${expected.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form}). Write the label quantity in the formula; an excess is an overage (T16), which the batch quantity adds (F0122: 22 mg for a 20 mg claim)`);
    }
  }
}

/** Whether a step setting fits its kind, and a reference points at something earlier that exists. */
function settingProblem(doc: MasterDoc, si: number, ti: number, kind: Block['settings'][number]['kind'], v: SettingValue): string | null {
  if (typeof v === 'string') {
    if (kind === 'number') return DECIMAL.test(v) ? null : `"${v}" is not a plain decimal`;
    if (kind === 'quantity') {
      const m = QUANTITY.exec(v);
      return m && findUnit(m[3] ?? '') ? null : `"${v}" is not a number with a unit from the unit list`;
    }
    return kind === 'text' ? null : `A ${kind} cannot be written as text`;
  }
  if ('unit' in v) {
    if (kind !== 'limit') return `A limit is given where a ${kind} is wanted`;
    const r = c1WithinLimits({ value: { value: '0', unit: v.unit }, limit: v });
    return r.ok ? null : r.message;
  }
  if ('formula' in v) {
    if (kind !== 'material' && kind !== 'quantity') return `A formula line is given where a ${kind} is wanted`;
    return materialLines(doc).some((l) => l.key === v.formula) ? null : `No formula line ${v.formula}`;
  }
  if ('header' in v) {
    if (kind !== 'quantity') return `A header value is given where a ${kind} is wanted`;
    const h = headerValue(doc, v.header);
    return typeof h === 'string' || h.ok ? null : h.message;
  }
  const [sk, tk, name] = v.ref.split('/') as [string, string, string];
  const ri = doc.stages.findIndex((x) => x.key === sk);
  const target = doc.stages[ri];
  const rt = target?.steps.findIndex((t) => t.key === tk) ?? -1;
  if (!target || rt < 0) return `${v.ref}: no such stage and step`;
  if (ri > si || (ri === si && rt >= ti)) return `${v.ref} comes later than this step`;
  if (ri !== si && target.kind === 'sub-batch') return `${v.ref} is inside the sub-batch stage ${target.name}: refer to it from that stage only`;
  const b = findBlock(target.steps[rt]!.block);
  const names = b ? [...b.fields, ...b.calcs].map((x) => x.name) : [];
  if (!names.includes(name)) return `${v.ref}: step ${tk} has no field or calculation ${name}`;
  return null;
}
