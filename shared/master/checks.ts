/**
 * Master checks: pure checks over one master document. Each problem is an error (⛔, the version cannot be approved)
 * or a warning (⚠️), with the path to the item. Template settings are checked by the templates library itself.
 * The calculation checks (calculationChecks below) are error-proofing of the calculations, not GMP rules.
 */
import { findBlock, type Block } from '../blocks/index.js';
import { Dec, c1WithinLimits, findUnit, t10Compensating, t11SaltFactor, t2Total, t8BatchScaling, type Q } from '../templates/index.js';
import { decimalsOf } from '../templates/core.js';
import { evaluate, lineQuantity } from '../engine/values.js';
import { materialLines, type Answer, type FormulaLine, type Limit, type MasterDoc, type SettingValue } from './schema.js';
import { packingChecks } from './packing.js';
import { unitKindProblem } from './kinds.js';
import { isBalance } from '../engine/picks.js';

/** A warning the author answers: one of the options, with a reason when `needsReason`. */
export interface Question { key: string; options: string[]; needsReason: boolean; answer?: Answer }
export interface Problem { level: 'error' | 'warning'; path: string; message: string; rule?: string; question?: Question }

/**
 * A message in plain words for the people who read it: without the internal codes of the rules (TB-11), templates
 * (T9) and failure cases (F0204) the code comments use. The rule stays in `rule` for the tests.
 */
export const plainWords = (m: string) => m
  .replace(/\s*\((?:TB-P?\d+|T\d+)\)/g, '')
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
  // TB-11: a master that weighs names the rooms its materials are weighed in (its balances are offered there).
  const weighs = doc.stages.some((s) => s.steps.some((t) => findBlock(t.block)?.fields.some((f) => f.kind === 'machine' && isBalance(f))));
  if (weighs && !doc.header.dispensingRooms?.length) error('header.dispensingRooms', 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)', 'TB-11');
  doc.stages.forEach((s, si) => {
    const path = `stages[${si}]`;
    twice(s.steps.map((t) => t.key), `${path}.steps`);
    if (s.kind === 'sub-batch' && !s.count) error(path, 'A sub-batch stage needs the number of sub-batches');
    if (s.produces && !s.produces.holdHours) error(`${path}.produces`, `The intermediate ${s.produces.name} has no hold time`, 'TB-01');
    // Everything the plain view would show as "(not set)" is reported here (the plain view's sentences, describe.ts).
    if (!s.role.trim()) warn(path, `Stage ${s.name} names no responsible role`);
    if (!doc.pack && s.kind !== 'preparation' && !s.steps.some((t) => findBlock(t.block)?.gmp === 'yield')) error(path, `Stage ${s.name} has no yield step`);
    if (s.kind === 'preparation' && !doc.stages.some((x) => x.uses.includes(s.key))) warn(path, `No stage uses the preparation ${s.name}`);
    // TB-10: a stage worked in a room starts with line clearance.
    const clearance = s.steps.findIndex((t) => findBlock(t.block)?.gmp === 'line-clearance');
    if (s.roomTypes.length && clearance < 0) error(path, `Stage ${s.name} is worked in a room but has no line clearance step`, 'TB-10');
    if (clearance > 0 && !doc.pack) warn(`${path}.steps[${clearance}]`, `Line clearance is not the first step of ${s.name}`);
    // TB-11: a stage that works machines (not balances, nor the line a packing batch is issued to) or names a room
    // runs only in the rooms it allows (shared/engine/picks.ts).
    const placed = s.steps.some((t) => { const b = findBlock(t.block); return !b?.atIssue && b?.fields.some((f) => f.kind === 'room' || (f.kind === 'machine' && !isBalance(f))); });
    if (placed && !s.roomTypes.length) error(`${path}.roomTypes`, `Stage ${s.name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`, 'TB-11');
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((x) => x.key === u);
      if (pi < 0 || pi >= si) error(`${path}.uses`, `${u} is not an earlier stage`);
      else if (!doc.stages[pi]!.produces) error(`${path}.uses`, `Stage ${doc.stages[pi]!.name} produces no intermediate`);
    }
    s.steps.forEach((st, ti) => {
      const p = `${path}.steps[${ti}]`;
      const block = findBlock(st.block);
      if (!block) return void error(`${p}.block`, `No block ${st.block.id} version ${st.block.version}`);
      if (block.packing && !doc.pack) error(p, `${block.name} is a packing step: a tablet master cannot use it`);
      if (!st.checker && (block.gmp || st.critical)) error(p, `${block.gmp ? `A ${block.gmp.replace('line-clearance', 'line clearance')} step` : 'A critical step'} needs a second-person check`, 'TB-08');
      if (st.critical && st.flow.kind === 'optional-with-reason') error(`${p}.flow`, 'A critical step cannot be optional');
      if (st.waitForCheck && !st.checker) warn(p, 'The next step waits for a check this step does not have');
      for (const bs of block.settings) if (!bs.optional && st.settings[bs.name] === undefined) error(`${p}.settings.${bs.name}`, `${bs.label} is not set`);
      for (const [name, v] of Object.entries(st.settings)) {
        const bs = block.settings.find((x) => x.name === name);
        const listed = !bs?.options || (typeof v === 'string' && bs.options.includes(v));
        const why = !bs ? `The block ${block.name} has no setting ${name}` : listed ? settingProblem(doc, si, ti, bs.kind, v) : `${bs.label}: choose one of ${bs.options!.join(', ')}`;
        if (why) error(`${p}.settings.${name}`, why);
        // TB-01: a limit (or a typed target) in a unit of another kind than the value it checks.
        const unit = typeof v === 'object' && 'unit' in v ? v.unit : typeof v === 'string' && bs?.kind === 'quantity' ? QUANTITY.exec(v)?.[3] : undefined;
        const wrong = !why && unit !== undefined ? unitKindProblem(block, name, st.settings, unit) : null;
        if (wrong) error(`${p}.settings.${name}`, wrong, 'TB-01');
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
      if (later && block.periodic && later.everyMinutes > block.periodic.maxMinutes) error(`${p}.everyMinutesLater`, `Periodic checks every ${later.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TB-15');
      if (st.onlyIf) {
        const r = c1WithinLimits({ value: { value: '0', unit: st.onlyIf.header === 'batchSize' ? 'tablets' : 'kg' }, limit: st.onlyIf.limit });
        if (!r.ok) error(`${p}.onlyIf`, `The rule for leaving the step out: ${r.message}`);
      }
      // A spray of a liquid made in excess: the amount to apply per charge, or all of it would be sprayed (F0339).
      const excess = /^(coat|spray-coat)$/.test(st.block.id) && s.uses.some((u) => doc.stages.find((x) => x.key === u && x.kind === 'preparation')?.steps
        .some((t) => Object.values(t.settings).some((v) => typeof v === 'object' && 'formula' in v && v.adjusted && doc.formula.find((f) => f.key === v.formula)?.adjust?.overage)));
      if (excess && !st.applyPerCharge) error(p, 'The liquid is made with an overage: state the amount to apply per charge, and stop at that net weight (F0339: spraying all of it gives about 4.5 % more drug); the rest goes to the reconciliation');
      if (st.applyPerCharge) for (const [k, v] of Object.entries(st.applyPerCharge)) if (!isMass(v)) error(`${p}.applyPerCharge.${k}`, `"${v}" is not a mass with a unit, e.g. "971 g"`);
      if (block.periodic && !st.everyMinutes) error(`${p}.everyMinutes`, `${block.name} needs the interval of its periodic checks`, 'TB-15');
      if (block.periodic && st.everyMinutes && st.everyMinutes > block.periodic.maxMinutes) {
        error(`${p}.everyMinutes`, `Periodic checks every ${st.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TB-15');
      }
    });
  });
  return out.map((p) => ({ ...p, message: plainWords(p.message) }));
}

/** The formula: the core materials (not coating, not a solvent removed in processing) make the core weight. */
function formulaChecks(doc: MasterDoc, out: Problem[], error: (path: string, message: string, rule?: string) => void): void {
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));
  twice(doc.formula.map((l) => l.key), 'formula');
  const core = doc.formula.filter((l) => l.place !== 'coating' && l.role !== 'solvent');
  const total = t2Total({ values: core.map((l) => `${l.mgPerTablet} mg`), unit: 'mg' });
  if (!core.length) error('formula', 'The formula has no core materials');
  else if (total.ok && !total.value.eq(new Dec(doc.header.coreWeightMg))) {
    error('formula', `The core materials add up to ${total.value.toString()} mg per tablet, not the theoretical core weight ${doc.header.coreWeightMg} mg`);
  }
  if (doc.header.coatedWeightMg && new Dec(doc.header.coatedWeightMg).lt(doc.header.coreWeightMg)) error('header.coatedWeightMg', 'The coated weight is below the core weight');
  if (doc.formula.some((l) => l.place === 'coating') && !doc.header.coatedWeightMg) error('header.coatedWeightMg', 'A coated product needs the theoretical coated weight');
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
    if (!r.ok) error(`formula[${i}].adjust`, r.message, a.potency ? 'TB-13' : undefined);
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
      if (!t10.ok) error(`formula[${i}].adjust.compensates`, `At the nominal certificate values: ${t10.message.replace(/; raise a deviation$/, '')}`, 'TB-13');
    }
  });
  formulaSums(doc, error);
  calculationChecks(doc, out);
}

const nominal = (l: FormulaLine) => (l.adjust?.content?.resultType === 'percent of theoretical' ? SAMPLE.assay : l.adjust?.content?.nominalContent ?? SAMPLE.assay);
const quantityOf = (text: string | undefined) => { const m = QUANTITY.exec(text ?? ''); const u = m && findUnit(m[3] ?? ''); return m && u ? { v: new Dec(m[1]!), u, text: text! } : undefined; };
const isMass = (text: string) => quantityOf(text)?.u.kind === 'mass';
const off = (a: Dec, b: Dec) => a.minus(b).abs().div(b).times(100);

/**
 * Calculation checks on the formula's own numbers (refusals): a batch quantity written that per tablet × batch size
 * does not give (F0303, F0388), one material twice in one place with two quantities (F0250), and the coating lines
 * against the coated − core weight (F0159, F0042; the core lines are checked above).
 */
function formulaSums(doc: MasterDoc, error: (path: string, message: string) => void): void {
  doc.formula.forEach((l, i) => {
    if (l.batchQuantity !== undefined) {
      const w = quantityOf(l.batchQuantity);
      const t8 = w && t8BatchScaling({ mode: 'per unit', perUnit: `${l.mgPerTablet} mg`, count: `${doc.header.batchSize} tablets`, unit: w.u.symbol });
      if (!w || !t8?.ok) error(`formula[${i}].batchQuantity`, `"${l.batchQuantity}" is not a mass with a unit, e.g. "120.000 kg"`);
      else if (!t8.value.toDecimalPlaces(decimalsOf(l.batchQuantity.split(/\s/)[0]!), Dec.ROUND_HALF_UP).eq(w.v)) {
        error(`formula[${i}].batchQuantity`, `The batch quantity ${l.batchQuantity} written for ${l.name} is not ${t8.shown}: every batch quantity comes from the quantity per tablet × the batch size (T8). Correct the batch column or the mg per tablet`);
      }
    }
    const twin = doc.formula.findIndex((x, j) => j < i && x.materialItemId === l.materialItemId && x.place === l.place && x.layer === l.layer);
    if (twin >= 0 && !new Dec(doc.formula[twin]!.mgPerTablet).eq(l.mgPerTablet)) {
      error(`formula[${i}]`, `${l.name} appears twice in the ${l.place} part with two quantities (${doc.formula[twin]!.mgPerTablet} and ${l.mgPerTablet} mg per tablet): keep one line with the quantity that is charged`);
    }
  });
  const coat = doc.formula.filter((l) => l.place === 'coating' && l.role !== 'solvent');
  if (coat.length && doc.header.coatedWeightMg) {
    const sum = coat.reduce((t, l) => t.plus(l.mgPerTablet), new Dec(0));
    const gain = new Dec(doc.header.coatedWeightMg).minus(doc.header.coreWeightMg);
    if (!sum.eq(gain)) error('formula', `The coating materials add up to ${sum.toString()} mg per tablet, not the coated − core weight ${gain.toString()} mg`);
  }
}

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

function calculationChecks(doc: MasterDoc, out: Problem[]): void {
  const ask = (path: string, key: string, message: string, options: string[], needsReason = false) => {
    const a = doc.answers?.[key];
    const ok = a && (a.about === message || a.about === plainWords(message)) && options.includes(a.choice) && (!needsReason || a.reason.trim() !== '');
    out.push({ level: 'warning', path, message, question: { key, options, needsReason, ...(ok ? { answer: a } : {}) } });
    return ok ? a.choice : undefined;
  };
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
      const basis = ask(`formula[${i}]`, `label-basis/${l.key}`, `Label claim for this master's market: is the strength of ${l.name} stated as ${formulaForm} or as ${other}? The formula gives ${l.mgPerTablet} mg of ${formulaForm} per tablet.`, [`as ${formulaForm}`, `as ${other}`]);
      if (l.labelClaim) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, new Dec(l.mgPerTablet), basis, l.name);
      // The same basis question for each strength from the same blend (F0225: a strength's claim may be on another basis).
      (doc.header.otherStrengths ?? []).forEach((st, n) => {
        const mg = new Dec(l.mgPerTablet).times(st.coreWeightMg).div(doc.header.coreWeightMg);
        const b = ask(`header.otherStrengths[${n}]`, `label-basis/${l.key}/${st.name}`, `Label claim of ${st.name}: is the strength of ${l.name} stated as ${formulaForm} or as ${other}? Its ${st.coreWeightMg} mg tablets hold ${mg.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${formulaForm}.`, [`as ${formulaForm}`, `as ${other}`]);
        labelClaim(`header.otherStrengths[${n}]`, l, st.labelClaim, mg, b, `${l.name} in ${st.name}`);
      });
    } else if (l.role === 'api') {
      if (l.labelClaim) labelClaim(`formula[${i}].labelClaim`, l, l.labelClaim, new Dec(l.mgPerTablet), `as ${l.name}`, l.name);
      (doc.header.otherStrengths ?? []).forEach((st, n) => labelClaim(`header.otherStrengths[${n}]`, l, st.labelClaim,
        new Dec(l.mgPerTablet).times(st.coreWeightMg).div(doc.header.coreWeightMg), `as ${l.name}`, `${l.name} in ${st.name}`));
    }
    // A solvent-wet API weighed as if dry (F0204: about 23 % too little); answered, or corrected with the lot's solvent.
    const corrected = l.adjust?.potency?.basis === 'dried' || l.adjust?.potency?.basis === 'anhydrous and solvent-free' || l.adjust?.content?.formulaQuantityIs === 'wet';
    if (l.role === 'api' && WET.test(l.name) && !corrected) {
      ask(`formula[${i}]`, `solvent-wet/${l.key}`, `${l.name} looks solvent-wet: its quantity needs the lot's measured solvent content (an assay adjustment on the dried or solvent-free basis, or a content adjustment). Weighed as dry API it gives too little drug (F0204: about 23 %). Is it weighed dry?`, ['weighed dry'], true);
    }
    // A processing aid that is removed (rinsed out, sublimed) but counted in the tablet (F0476: about 12.5 % too much drug).
    if (l.role !== 'solvent' && AID.test(l.name)) {
      ask(`formula[${i}]`, `removed/${l.key}`, `${l.name} is often a processing aid removed in processing (rinsed out, sublimed). If it is removed, set its role to removed so the core weight, content, yield and reconciliation use only the solids that stay. Does it stay in the tablet?`, ['stays in the tablet'], true);
    }
    // (b) a herbal or extract line
    if (l.role !== 'solvent' && HERBAL.test(l.name)) {
      ask(`formula[${i}]`, `herbal/${l.key}`, `${l.name} is a herbal or extract line: is ${l.mgPerTablet} mg per tablet the raw-herb equivalent or the weight of the extract?`, ['raw-herb equivalent', 'extract weight']);
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
    const { coreWeightMg: core, coatedWeightMg: coated, dieAreaMm2: area } = doc.header;
    // A weight target must name its stage (F0175: a sublimation tablet compressed to its weight after sublimation).
    for (const [name, lim] of limits) {
      if (lim.unit !== 'mg' || !/mean|weight/i.test(name)) continue;
      const inside = (w?: string) => { const r = w === undefined ? undefined : c1WithinLimits({ value: { value: w, unit: 'mg' }, limit: lim }); return r?.ok === true && r.check?.pass === true; };
      if (!inside(core) && !inside(coated)) {
        ask(`${p}.settings.${name}`, `weight-stage/${s.key}/${t.key}/${name}`, `The limits ${lim.low ?? ''}-${lim.high ?? ''} mg of this step contain neither the theoretical core weight ${core} mg nor the coated weight${coated ? ` ${coated} mg` : ''}: at which stage is this weight? A weight taken after a later loss or gain doses wrong (F0175: about 10 %). Confirm that it is the weight at this step, with the reason, or correct it.`, ['weight at this step'], true);
      }
    }
    // The target weight must fit the tooling (F0135: 0.079 g printed for a 2 mm mini-tablet of about 8 mg).
    const th = limits.find(([n, l]) => /thickness/i.test(n) && l.unit === 'mm')?.[1];
    const mid = th && (th.low && th.high ? new Dec(th.low).plus(th.high).div(2) : new Dec(th.low ?? th.high ?? '0'));
    if (area && mid && mid.gt(0) && block?.id === 'compress') {
      const density = new Dec(core).div(new Dec(area).times(mid));
      if (density.lt('0.5') || density.gt('2.5')) {
        ask(p, `tooling/${s.key}/${t.key}`, `The core weight ${core} mg in a die of ${area} mm² at about ${mid.toString()} mm thick is ${density.toFixed(2, Dec.ROUND_HALF_UP)} g/cm³; tablets are about 0.5-2.5 g/cm³. Check the weight's unit and the tooling (F0135: a 10 times unit error), and confirm with the reason, or correct it.`, ['confirmed'], true);
      }
    }
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

  /** The API per tablet against a label claim (refusal), on the basis answered: the formula form, or the other form by the MWs. */
  function labelClaim(path: string, l: FormulaLine, claim: string, mg: Dec, basis: string | undefined, what: string): void {
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
      refuse(path, `${what}: ${mg.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form} per tablet does not give the label claim ${claim} (${expected.toFixed(3, Dec.ROUND_HALF_UP)} mg of ${form}). Write the label quantity in the formula; an excess is an overage (T16), which the batch quantity adds (F0122: 22 mg in a 20 mg tablet)`);
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
    return v.header.startsWith('coated') && !doc.header.coatedWeightMg ? 'The header has no coated weight' : null;
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
