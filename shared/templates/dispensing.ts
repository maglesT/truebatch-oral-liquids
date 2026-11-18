/**
 * Dispensing templates: T8 Batch scaling, T9 Potency-adjusted quantity, C5 Same basis (built into T9),
 * T10 Compensating excipient, T11 Salt / base factor, T12 Dry basis, T15 Re-scale to actual yield,
 * T16 Overage, T18 Content-adjusted quantity, T19 Split into portions, T20 Multi-lot quantity.
 */
import { checkOf, decimalsOf, defaultDecimals, Dec, fmt, HUNDRED, needKind, parse, percent, refuse, run, sameKind, show, shownNumber, to, unitOf, ZERO, type Done, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';
import type { Kind, Unit } from './units.js';

const MASS: Kind[] = ['mass'];
const POTENCY: Kind[] = ['IU', 'CFU', 'activity units'];

function outUnit(p: Parsed, wanted: string | undefined): Unit {
  if (wanted !== undefined) return unitOf(wanted);
  return p.unit;
}

// ---------------------------------------------------------------- T8 Batch scaling
export type T8Input = (
  | { readonly mode: 'per unit'; readonly perUnit: Q; readonly count: Q }
  | { readonly mode: 'percent'; readonly percent: Q; readonly batch: Q }
  | { readonly mode: 'rate x time'; readonly rate: Q; readonly time: Q }
  /** Coat by area: target mg/cm² × tablet surface area (from the tooling record) × number of units. */
  | { readonly mode: 'per area'; readonly perArea: Q; readonly area: Q; readonly count: Q }
  /** Product of two or three recorded values, e.g. tablet volume = length × width × height; Hz × rpm/Hz (equipment record) = rpm. */
  | { readonly mode: 'product'; readonly factors: readonly Q[] }
) & { readonly unit?: string; readonly decimals?: number; readonly limit?: Limit };

const RATE: Partial<Record<Kind, { rate: string; result: string }>> = {
  'mass rate': { rate: 'kg/h', result: 'kg' },
  'volume rate': { rate: 'L/h', result: 'L' },
  'count rate': { rate: 'units/h', result: 'units' },
};

/** T8 Batch scaling: quantity per tablet × number of tablets; or % w/w × batch weight; or rate × time. */
export function t8BatchScaling(i: T8Input): Outcome {
  return run(() => {
    let value: Dec;
    let u: Unit;
    let line: string;
    if (i.mode === 'per unit') {
      const per = parse(i.perUnit, 'The quantity per unit');
      const n = parse(i.count, 'The number of units');
      needKind(n, ['count', 'number'], 'The number of units');
      if (n.v.isNegative() || per.v.isNegative()) refuse('Quantities and counts cannot be negative');
      const def = per.unit.kind === 'mass' ? 'kg' : per.unit.kind === 'volume' ? 'L' : per.unit.symbol;
      u = unitOf(i.unit ?? def);
      value = to(per, u).times(n.v);
      line = `${per.text} × ${n.text}`;
    } else if (i.mode === 'percent') {
      const pc = percent(i.percent, 'The % w/w');
      const batch = parse(i.batch, 'The batch weight');
      needKind(batch, MASS, 'The batch weight');
      if (pc.v.isNegative() || pc.v.gt(HUNDRED)) refuse('A % w/w must be between 0 and 100');
      u = outUnit(batch, i.unit);
      value = to(batch, u).times(pc.v).div(HUNDRED);
      line = `${pc.text} × ${batch.text} ÷ 100`;
    } else if (i.mode === 'per area') {
      const pa = parse(i.perArea, 'The quantity per area');
      const area = parse(i.area, 'The surface area per unit');
      const n = parse(i.count, 'The number of units');
      needKind(pa, ['mass per area'], 'The quantity per area');
      needKind(area, ['area'], 'The surface area per unit');
      needKind(n, ['count', 'number'], 'The number of units');
      if (pa.v.isNegative() || !area.v.isPositive() || area.v.isZero() || n.v.isNegative()) refuse('Quantity per area and count cannot be negative, and the area must be more than zero');
      u = unitOf(i.unit ?? 'kg');
      const mg = to(pa, 'mg/cm²').times(to(area, 'cm²')).times(n.v);
      value = to({ v: mg, unit: unitOf('mg'), text: '' }, u);
      line = `${pa.text} × ${area.text} × ${n.text}`;
    } else if (i.mode === 'product') {
      if (i.factors.length < 2 || i.factors.length > 3) refuse('A product takes two or three values');
      const fs = i.factors.map((f, n) => parse(f, `Value ${n + 1}`));
      const lengths = fs.filter((f) => f.unit.kind === 'length').length;
      const numbers = fs.filter((f) => f.unit.kind === 'number' || f.unit.kind === 'count').length;
      if (fs.some((f) => f.v.isNegative())) refuse('The values cannot be negative');
      let raw: Dec;
      let rawUnit: string;
      const hz = fs.find((f) => f.unit.kind === 'frequency');
      const perHz = fs.find((f) => f.unit.kind === 'rpm per Hz');
      if (fs.length === 2 && hz && perHz) {
        // A drive frequency to a speed, only through the equipment record's factor (F0250 chopper 10-12 Hz).
        raw = hz.v.times(perHz.v);
        rawUnit = 'rpm';
      } else if (lengths === fs.length) {
        raw = fs.reduce((s, f) => s.times(to(f, 'mm')), new Dec(1));
        rawUnit = fs.length === 2 ? 'mm²' : 'mm³';
      } else if (numbers >= fs.length - 1) {
        const other = fs.find((f) => f.unit.kind !== 'number' && f.unit.kind !== 'count');
        raw = fs.reduce((s, f) => s.times(f.v), new Dec(1));
        rawUnit = other?.unit.symbol ?? '';
      } else {
        refuse('A product needs all lengths (giving an area or a volume) or plain numbers times one quantity');
      }
      u = unitOf(i.unit ?? rawUnit);
      value = to({ v: raw, unit: unitOf(rawUnit), text: '' }, u);
      line = fs.map((f) => f.text).join(' × ');
    } else {
      const rate = parse(i.rate, 'The rate');
      const time = parse(i.time, 'The run time');
      needKind(time, ['time'], 'The run time');
      const r = RATE[rate.unit.kind];
      if (r === undefined) refuse(`The rate must be a mass, volume or count per time; "${rate.text}" is not`);
      u = unitOf(i.unit ?? r.result);
      const raw = to(rate, r.rate).times(to(time, 'h'));
      value = to({ v: raw, unit: unitOf(r.result), text: '' }, u);
      line = `${rate.text} × ${time.text}`;
    }
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return { ok: true, value, unit: u.symbol, shown: `${line} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T11 Salt / base factor
export interface Form {
  readonly name: string;
  /** Molecular weight of the form as written (per formula unit). */
  readonly mw: string;
  /** Drug molecules (moieties) per formula unit: 1 by default; 2 for hemifumarates, hemisulfates, calcium salts of two anions. */
  readonly moleculesPerUnit?: number;
  /** true when this MW includes water or solvent of crystallisation (a hydrate or solvate MW). */
  readonly hydrateOrSolvate?: boolean;
  /** The ion's charge (K⁺ 1, Ca²⁺ 2), from the material record: needed for a quantity in mEq of this form. */
  readonly charge?: number;
  /** The MW is an average that varies by lot (HP-β-cyclodextrin, degree of substitution): taken from `lotMw`. */
  readonly mwFromLot?: boolean;
}

export interface T11Input {
  /** Quantity of the form it is given as (e.g. 40 mg pantoprazole base). */
  readonly quantity: Q;
  readonly from: Form;
  readonly to: Form;
  /** The lot's average MW from its certificate, for the form marked `mwFromLot`. */
  readonly lotMw?: string;
  /** A salt factor as written in a dossier: refused when the molecular weights do not give it (at its decimals). */
  readonly writtenFactor?: string;
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

export interface T11Extra {
  readonly factor: Dec;
  /** The form the result is in; T9 reads it for the same-basis rule (C5). */
  readonly form: { readonly name: string; readonly hydrateOrSolvate: boolean };
}

// A hemi-salt (hemifumarate, hemisulfate, hemitartrate …) has 2 drug molecules per formula unit; a hemihydrate or
// hemipentahydrate is about water, not about the drug molecules.
const HEMI_SALT = /hemi(?![a-z]*(hydrate|solvate))[a-z]/i;

function molecules(f: Form): number {
  const n = f.moleculesPerUnit ?? 1;
  if (!Number.isInteger(n) || n < 1) refuse(`Molecules per formula unit for ${f.name} must be a whole number, 1 or more`);
  return n;
}

/**
 * Molecules per salt unit ignored: a hemi-salt given with 1 molecule per unit and a molecular weight at least twice
 * the other form's is the MW of the whole formula unit (2 drug molecules); the factor would double the dose.
 * A MW per drug molecule (quetiapine hemifumarate 441.55 against quetiapine 383.51) is fine.
 */
function hemiIgnored(f: Form, n: number, mw: Dec, otherPerMolecule: Dec): void {
  if (n === 1 && HEMI_SALT.test(f.name) && mw.div(otherPerMolecule).gte(2)) {
    refuse(`${f.name} is a hemi-salt and its molecular weight ${f.mw} is that of the whole formula unit, which carries 2 drug molecules. Set 2 molecules per formula unit, or the dose would be doubled`);
  }
}

/**
 * T11 Salt / base factor (any two named forms): quantity × (MW to ÷ molecules to) ÷ (MW from ÷ molecules from).
 * Aliskiren hemifumarate carries 2 aliskiren per formula unit: (1219.6 ÷ 2) ÷ 551.8, not 1219.6 ÷ 551.8.
 */
export function t11SaltFactor(i: T11Input): Outcome<T11Extra> {
  return run(() => {
    const q = parse(i.quantity, `The quantity of ${i.from.name}`);
    if (q.unit.kind === 'charge') return milliequivalents(i, q);
    needKind(q, MASS, `The quantity of ${i.from.name}`);
    const mw = (f: Form): Dec => {
      if (f.mwFromLot !== true) return parse(f.mw, `The molecular weight of ${f.name}`).v;
      if (i.lotMw === undefined) refuse(`The average molecular weight of ${f.name} varies by lot: give it from the lot's certificate`);
      return parse(i.lotMw, `The lot's average molecular weight of ${f.name}`).v;
    };
    const mwFrom = mw(i.from);
    const mwTo = mw(i.to);
    if (!mwFrom.isPositive() || mwFrom.isZero() || !mwTo.isPositive() || mwTo.isZero()) refuse('Molecular weights must be more than zero');
    const nFrom = molecules(i.from);
    const nTo = molecules(i.to);
    hemiIgnored(i.to, nTo, mwTo, mwFrom.div(nFrom));
    hemiIgnored(i.from, nFrom, mwFrom, mwTo.div(nTo));
    const factor = mwTo.div(nTo).div(mwFrom.div(nFrom));
    if (i.writtenFactor !== undefined) {
      const w = parse(i.writtenFactor, 'The salt factor as written').v;
      const dp = decimalsOf(i.writtenFactor);
      if (!factor.toDecimalPlaces(dp, Dec.ROUND_HALF_UP).eq(w)) {
        refuse(`The salt factor ${i.writtenFactor} as written does not match the molecular weights of ${i.from.name} and ${i.to.name} (factor ${fmt(factor, Math.max(dp, 4))}): check which form is weighed (F0062: 1.177 is the anhydrous dihydrochloride, the monohydrate is 1.220)`);
      }
    }
    const u = outUnit(q, i.unit);
    const value = to(q, u).times(factor);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    const term = (f: Form, n: number): string => (n === 1 ? f.mw : `(${f.mw} ÷ ${n})`);
    const hyd = i.to.hydrateOrSolvate === true;
    const shown =
      `${q.text} ${i.from.name} × ${term(i.to, nTo)} ÷ ${term(i.from, nFrom)} = ${show(value, u.symbol, dp)} ${i.to.name}` +
      ` (factor ${fmt(factor, 4)}; ${nTo} molecule${nTo === 1 ? '' : 's'} per ${i.to.name} unit; MW ${hyd ? 'includes' : 'without'} water/solvent of crystallisation)`;
    return { ok: true, value, unit: u.symbol, factor, form: { name: i.to.name, hydrateOrSolvate: hyd }, shown, ...checkOf(value, u.symbol, i.limit) };
  });
}

/**
 * A quantity in mEq of an ion: mmol of ion = mEq ÷ the ion's charge; the mass of the form weighed = mmol of ion ÷ ions
 * per formula unit × its MW (10 mEq K = 3.333 mmol potassium citrate monohydrate = 1081 mg, F0393). Read as mmol of
 * the salt it would be 3 times the potassium, so the charge must come from the material record.
 */
function milliequivalents(i: T11Input, q: Parsed): Done & T11Extra {
  const z = i.from.charge;
  if (z === undefined || !Number.isInteger(z) || z < 1) refuse(`A quantity in mEq needs the charge of the ion ${i.from.name} from the material record (1 for K⁺ or Na⁺, 2 for Ca²⁺ or Mg²⁺)`);
  const n = molecules(i.to);
  const mwTo = parse(i.to.mw, `The molecular weight of ${i.to.name}`).v;
  if (!mwTo.isPositive() || mwTo.isZero()) refuse('Molecular weights must be more than zero');
  const mmol = q.v.div(z).div(n);
  const u = unitOf(i.unit ?? 'mg');
  needKind({ v: ZERO, unit: u, text: '' }, MASS, 'The result unit');
  const value = to({ v: mmol.times(mwTo), unit: unitOf('mg'), text: '' }, u);
  const dp = i.decimals ?? defaultDecimals(u.symbol);
  const shown = `${q.text} ${i.from.name} ÷ ${z} (charge) = ${fmt(q.v.div(z), 3)} mmol; ÷ ${n} per ${i.to.name} unit × ${i.to.mw} = ${show(value, u.symbol, dp)} ${i.to.name}`;
  return { ok: true, value, unit: u.symbol, factor: mwTo.div(n).div(z), form: { name: i.to.name, hydrateOrSolvate: i.to.hydrateOrSolvate === true }, shown, ...checkOf(value, u.symbol, i.limit) };
}

// ---------------------------------------------------------------- C5 Same basis
export type Basis = 'as is' | 'anhydrous' | 'dried' | 'ignited' | 'anhydrous and solvent-free';

export interface C5Input {
  /** Is the standard quantity the anhydrous weight, or the hydrate/solvate weight (MW includes crystal water/solvent)? */
  readonly standardIs: 'anhydrous' | 'hydrate or solvate';
  /** The basis of the certificate's assay. */
  readonly basis: Basis;
  /** What the assay's 100 % refers to; monographs usually calculate on the anhydrous (or dried) substance. Default 'anhydrous substance'. */
  readonly assayExpressedAs?: 'anhydrous substance' | 'hydrate';
  /**
   * The certificate states the potency AS THE PARENT drug per mass of material (µg azithromycin per mg of
   * azithromycin dihydrate, µg cefuroxime per mg of cefuroxime axetil) or AS THE ELEMENT (% Ca, % Zn, % Fe).
   * The salt/ester/hydrate/compound factor is then already inside the potency figure.
   */
  readonly potencyAs?: 'parent' | 'element';
  /** true when the standard quantity came through a salt/base factor (T11) in the same chain. */
  readonly saltFactorInChain?: boolean;
  /**
   * true when that factor runs from the labelled salt or hydrate DOWN to the form the potency is stated as (factor
   * below 1, to a form without crystal water): desmopressin acetate to base (F0434), procaterol HCl hemihydrate to
   * anhydrous (F0088). That chain is right and is not refused; the other way round it is.
   */
  readonly saltFactorToParent?: boolean;
}

/** The same-basis rule as a plain message, or undefined when the basis is consistent. */
export function sameBasisProblem(i: C5Input): string | undefined {
  if (i.potencyAs !== undefined) {
    const as = i.potencyAs === 'parent' ? 'the parent drug per mg of material' : 'the element (% Ca, % Zn, % Fe …)';
    if (i.saltFactorInChain === true && i.saltFactorToParent !== true) {
      return (
        `Same-basis rule (C5): the potency is stated as ${as}, so the salt/ester/hydrate/compound factor is already inside it. ` +
        'Applying the salt/base factor (T11) as well would overstate the dose by that factor ' +
        (i.potencyAs === 'parent'
          ? '(about 1.05 for azithromycin dihydrate, 1.20 for cefuroxime axetil, 1.23 for faropenem sodium hemipentahydrate). Start from the parent quantity of the formula'
          : '(about 2.5 for calcium carbonate, 2.8 for zinc sulfate monohydrate). Start from the element quantity of the formula') +
        ' and divide by the potency only.'
      );
    }
    if (i.standardIs === 'hydrate or solvate') {
      return `Same-basis rule (C5): with a potency stated as ${as}, the standard quantity must be the ${i.potencyAs} amount (the label claim), not the weight of the salt, compound or hydrate.`;
    }
    return undefined;
  }
  const expressed = i.assayExpressedAs ?? 'anhydrous substance';
  const correction = i.basis !== 'as is';
  if (i.standardIs === 'hydrate or solvate' && correction) {
    return (
      'Same-basis rule (C5): the standard quantity already uses the hydrate (or solvate) molecular weight, so it already contains the water. ' +
      (i.basis === 'anhydrous and solvent-free'
        ? 'Correcting the assay to the anhydrous and solvent-free basis as well would count the water or solvent twice (darunavir ethanolate: about 8.4 % too much API). '
        : `Correcting the ${i.basis} assay for water/LOD as well would count the water twice (for pantoprazole sodium sesquihydrate about 6.7 % too much API). `) +
      'Use the anhydrous molecular weight in the salt factor (T11), or use the assay as is stated for the hydrate.'
    );
  }
  if (i.standardIs === 'hydrate or solvate' && expressed === 'anhydrous substance') {
    return (
      'Same-basis rule (C5): the standard quantity uses the hydrate (or solvate) molecular weight, but the as-is assay is expressed as the anhydrous substance, ' +
      'so the water would be counted twice. Use the anhydrous molecular weight in the salt factor (T11), or confirm that the certificate states the assay as the hydrate.'
    );
  }
  if (i.standardIs === 'anhydrous' && expressed === 'hydrate') {
    return 'Same-basis rule (C5): the standard quantity is the anhydrous weight but the assay is expressed as the hydrate; the water of crystallisation would not be counted. Use the hydrate weight or an assay on the anhydrous substance.';
  }
  if (expressed === 'hydrate' && correction) {
    return 'Same-basis rule (C5): an assay expressed as the hydrate cannot also be on the anhydrous or dried basis; check the certificate.';
  }
  return undefined;
}

/** C5 Same basis: refuses (with a plain message) when a salt/hydrate factor and an assay/water/LOD correction are not on the same basis. */
export function c5SameBasis(i: C5Input): Outcome {
  return run(() => {
    const problem = sameBasisProblem(i);
    if (problem !== undefined) refuse(problem);
    const shown = `Standard quantity (${i.standardIs}) and assay (${i.basis}, expressed as ${i.assayExpressedAs ?? 'anhydrous substance'}) are on the same basis`;
    return { ok: true, value: new Dec(1), unit: '', shown, check: { pass: true, level: 'pass', rounded: 'same basis', shown } };
  });
}

// ---------------------------------------------------------------- T9 Potency-adjusted quantity
/** A T11 result passed straight into T9 (so the form travels with the quantity). */
export interface FromT11 {
  readonly ok: true;
  readonly value: Dec;
  readonly unit: string;
  readonly form: { readonly name: string; readonly hydrateOrSolvate: boolean };
  readonly factor?: Dec;
}

export interface T9Input {
  /** The standard quantity (at 100 %), or the T11 result it came from. */
  readonly standard: Q | FromT11;
  /** Required when `standard` is not a T11 result: is it the anhydrous weight or the hydrate/solvate weight? */
  readonly standardIs?: 'anhydrous' | 'hydrate or solvate';
  /** Assay from the certificate, in %. */
  readonly assay: Q;
  readonly basis: Basis;
  readonly water?: Q;
  readonly lod?: Q;
  /** Loss on ignition, for an assay on the ignited basis (magnesium oxide, zinc oxide). */
  readonly loi?: Q;
  readonly solvents?: Q;
  readonly assayExpressedAs?: 'anhydrous substance' | 'hydrate';
  /**
   * The assay is a potency stated as the parent drug per mass of material (e.g. "950 µg/mg" azithromycin per mg of
   * dihydrate), or as the element (e.g. "39.6 %" Ca in calcium carbonate). The standard is then the parent or
   * element quantity; a T11 result as the standard is refused (C5).
   */
  readonly potencyAs?: 'parent' | 'element';
  /** 'use' (default): an assay above 100 % lowers the quantity; 'treat as 100': it does not. */
  readonly assayAbove100?: 'use' | 'treat as 100';
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

export interface T9Extra {
  readonly assayAsIs: Dec;
}

function isT11(x: unknown): x is FromT11 {
  return typeof x === 'object' && x !== null && 'form' in x && 'ok' in x;
}

/** T9 Potency-adjusted quantity: standard × 100 ÷ assay as is, the assay converted from its basis with water / LOD / solvents. */
export function t9PotencyAdjusted(i: T9Input): Outcome<T9Extra> {
  return run(() => {
    let std: Parsed;
    let standardIs: 'anhydrous' | 'hydrate or solvate' | undefined = i.standardIs;
    const asParent = i.potencyAs !== undefined;
    if (i.potencyAs !== undefined) {
      const down = isT11(i.standard) && i.standard.factor !== undefined && i.standard.factor.lt(1) && !i.standard.form.hydrateOrSolvate;
      const p = sameBasisProblem({ standardIs: standardIs ?? 'anhydrous', basis: i.basis, potencyAs: i.potencyAs, saltFactorInChain: isT11(i.standard), saltFactorToParent: down });
      if (p !== undefined) refuse(p);
      standardIs = 'anhydrous';
    }
    if (isT11(i.standard)) {
      std = { v: i.standard.value, unit: unitOf(i.standard.unit), text: `${shownNumber(i.standard.value, i.standard.unit)} ${i.standard.unit}` };
      const fromForm = i.standard.form.hydrateOrSolvate ? 'hydrate or solvate' : 'anhydrous';
      if (standardIs !== undefined && standardIs !== fromForm) refuse(`The salt factor (T11) used the ${fromForm} molecular weight, but the standard quantity is said to be ${standardIs}`);
      standardIs = fromForm;
    } else {
      std = parse(i.standard, 'The standard quantity');
    }
    needKind(std, MASS, 'The standard quantity');
    if (standardIs === undefined) refuse('Say whether the standard quantity is the anhydrous weight or the hydrate/solvate weight (same-basis rule C5)');
    const problem = asParent ? undefined : sameBasisProblem({ standardIs, basis: i.basis, ...(i.assayExpressedAs === undefined ? {} : { assayExpressedAs: i.assayExpressedAs }) });
    if (problem !== undefined) refuse(problem);

    const a = percent(i.assay, 'The assay');
    if (!a.v.isPositive() || a.v.isZero()) refuse('The assay must be more than zero');
    const corr = (q: Q | undefined, what: string): { v: Dec; text: string } => {
      if (q === undefined) refuse(`The ${i.basis} assay needs the lot's ${what}`);
      const c = percent(q, `The ${what}`);
      if (c.v.isNegative() || c.v.gte(HUNDRED)) refuse(`The ${what} must be from 0 to less than 100 %`);
      return c;
    };
    let asIs: Dec;
    let asIsLine = '';
    if (i.basis === 'as is') {
      asIs = a.v;
    } else if (i.basis === 'anhydrous' || i.basis === 'dried' || i.basis === 'ignited') {
      const c =
        i.basis === 'anhydrous' ? corr(i.water, 'water content') : i.basis === 'dried' ? corr(i.lod, 'loss on drying') : corr(i.loi, 'loss on ignition');
      asIs = a.v.times(HUNDRED.minus(c.v)).div(HUNDRED);
      asIsLine = `assay as is = ${a.text} × (100 − ${c.text}) ÷ 100 = ${fmt(asIs, 3)} %; `;
    } else {
      const w = corr(i.water, 'water content');
      const s = corr(i.solvents, 'residual solvents');
      if (w.v.plus(s.v).gte(HUNDRED)) refuse('Water plus solvents must be less than 100 %');
      asIs = a.v.times(HUNDRED.minus(w.v).minus(s.v)).div(HUNDRED);
      asIsLine = `assay as is = ${a.text} × (100 − ${w.text} − ${s.text}) ÷ 100 = ${fmt(asIs, 3)} %; `;
    }
    let used = asIs;
    let capNote = '';
    if (asIs.gt(HUNDRED) && i.assayAbove100 === 'treat as 100') {
      used = HUNDRED;
      capNote = ' (assay above 100 % taken as 100 %, as the master says)';
    }
    const u = outUnit(std, i.unit);
    const value = to(std, u).times(HUNDRED).div(used);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    const parentNote = asParent ? ` (potency ${a.text} stated as the ${i.potencyAs === 'element' ? 'element' : 'parent drug'}: ${isT11(i.standard) ? 'the factor ran from the labelled form down to it' : 'no salt factor applied'})` : '';
    const shown = `${asIsLine}${std.text} × 100 ÷ ${fmt(used, 3)} % = ${show(value, u.symbol, dp)}${capNote}${parentNote}`;
    return { ok: true, value, unit: u.symbol, assayAsIs: asIs, shown, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T10 Compensating excipient
export interface T10Input {
  /** The filler(s) that take up the difference. Several fillers share it in `ratio` parts (default: their standard quantities). */
  readonly fillers: readonly { readonly name: string; readonly standard: Q; readonly ratio?: string }[];
  /** The adjusted materials: standard and adjusted quantity of each (T9/T18/T20 results). */
  readonly adjusted: readonly { readonly name: string; readonly standard: Q; readonly adjusted: Q }[];
  readonly unit?: string;
  readonly decimals?: number;
}

export interface T10Extra {
  readonly excess: Dec;
  readonly fillers: readonly { readonly name: string; readonly value: Dec }[];
}

/**
 * T10 Compensating excipient: filler = standard filler − Σ (adjusted − standard), so the batch weight stays
 * the same. Excesses may be + or −. Spread over several fillers in a ratio. Refused if any filler goes negative.
 */
export function t10Compensating(i: T10Input): Outcome<T10Extra> {
  return run(() => {
    if (i.fillers.length === 0) refuse('Name the filler that compensates');
    if (i.adjusted.length === 0) refuse('Name the adjusted material(s)');
    const fill = i.fillers.map((f) => ({ name: f.name, p: parse(f.standard, `The standard quantity of ${f.name}`), ratio: f.ratio }));
    const adj = i.adjusted.map((a) => ({ name: a.name, s: parse(a.standard, `The standard quantity of ${a.name}`), a: parse(a.adjusted, `The adjusted quantity of ${a.name}`) }));
    const all = [...fill.map((f) => f.p), ...adj.flatMap((a) => [a.s, a.a])];
    for (const p of all) needKind(p, MASS, 'Compensation quantities');
    const first = fill[0];
    if (first === undefined) refuse('Name the filler that compensates');
    const u = unitOf(i.unit ?? first.p.unit.symbol);
    const excess = adj.reduce((s, a) => s.plus(to(a.a, u)).minus(to(a.s, u)), ZERO);
    const parts = fill.map((f) => (f.ratio === undefined ? to(f.p, u) : parse(f.ratio, `The ratio for ${f.name}`).v));
    const partSum = parts.reduce((s, x) => s.plus(x), ZERO);
    if (parts.some((x) => x.isNegative()) || partSum.isZero()) refuse('The filler ratio must be positive');
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    const stdTotal = fill.reduce((s, f) => s.plus(to(f.p, u)), ZERO);
    const newTotal = stdTotal.minus(excess);
    const out: { name: string; value: Dec }[] = [];
    let given = ZERO;
    fill.forEach((f, n) => {
      const last = n === fill.length - 1;
      const share = last ? excess.minus(given) : excess.times(parts[n] ?? ZERO).div(partSum);
      given = given.plus(share);
      out.push({ name: f.name, value: to(f.p, u).minus(share) });
    });
    const neg = out.find((f) => f.value.isNegative() && !f.value.isZero());
    const excessLine = adj.map((a) => `(${a.a.text} − ${a.s.text})`).join(' + ');
    if (neg !== undefined) {
      refuse(
        `Not enough ${neg.name} to compensate: the adjusted materials need ${show(excess, u.symbol, dp)} more than standard (${excessLine}), ` +
          `which would leave ${show(neg.value, u.symbol, dp)} of ${neg.name}. The batch weight cannot be kept; raise a deviation`,
      );
    }
    const shown =
      fill.length === 1
        ? `${first.p.text} − [${excessLine}] = ${show(newTotal, u.symbol, dp)} ${first.name}`
        : `excess ${excessLine} = ${show(excess, u.symbol, dp)}, shared ${fill.map((f, n) => `${f.name} ${fmt(parts[n] ?? ZERO, 3)}`).join(' : ')}; ` +
          out.map((f, n) => `${f.name} ${fill[n]?.p.text ?? ''} → ${show(f.value, u.symbol, dp)}`).join('; ');
    return { ok: true, value: newTotal, unit: u.symbol, excess, fillers: out, shown };
  });
}

// ---------------------------------------------------------------- T12 Dry basis
export interface T12Input {
  readonly mode: 'dry to as is' | 'as is to dry';
  readonly quantity: Q;
  readonly lod: Q;
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T12 Quantity from dry basis: dry × 100 ÷ (100 − LOD); reverse: as is × (100 − LOD) ÷ 100. */
export function t12DryBasis(i: T12Input): Outcome {
  return run(() => {
    const q = parse(i.quantity, 'The quantity');
    needKind(q, MASS, 'The quantity');
    const l = percent(i.lod, 'The loss on drying');
    if (l.v.isNegative() || l.v.gte(HUNDRED)) refuse('The loss on drying must be from 0 to less than 100 %');
    const u = outUnit(q, i.unit);
    const value = i.mode === 'dry to as is' ? to(q, u).times(HUNDRED).div(HUNDRED.minus(l.v)) : to(q, u).times(HUNDRED.minus(l.v)).div(HUNDRED);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    const line = i.mode === 'dry to as is' ? `${q.text} × 100 ÷ (100 − ${l.text})` : `${q.text} × (100 − ${l.text}) ÷ 100`;
    return { ok: true, value, unit: u.symbol, shown: `${line} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T15 Re-scale to actual yield
export interface T15Input {
  readonly formulaQuantity: Q;
  readonly actual: Q;
  readonly theoretical: Q;
  /** Optional window on actual ÷ theoretical in %, e.g. { low: "90.0", high: "102.0" }; refused outside. */
  readonly window?: { readonly low?: string; readonly high?: string };
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T15 Re-scale to actual yield: formula quantity × actual intermediate ÷ theoretical intermediate. */
export function t15Rescale(i: T15Input): Outcome {
  return run(() => {
    const f = parse(i.formulaQuantity, 'The formula quantity');
    const a = parse(i.actual, 'The actual intermediate weight');
    const t = parse(i.theoretical, 'The theoretical intermediate weight');
    sameKind([a, t], 'Re-scale');
    if (!t.v.isPositive() || t.v.isZero()) refuse('The theoretical intermediate weight must be more than zero');
    const ratio = to(a, t.unit).div(t.v);
    if (i.window !== undefined) {
      const pct = ratio.times(HUNDRED);
      const lo = i.window.low === undefined ? undefined : new Dec(i.window.low);
      const hi = i.window.high === undefined ? undefined : new Dec(i.window.high);
      const r = pct.toDecimalPlaces(Math.max(...[i.window.low, i.window.high].map((x) => (x === undefined ? 0 : (x.split('.')[1] ?? '').length))), Dec.ROUND_HALF_UP);
      if ((lo !== undefined && r.lt(lo)) || (hi !== undefined && r.gt(hi))) {
        refuse(`The actual intermediate is ${fmt(pct, 1)} % of theoretical, outside the window ${i.window.low ?? ''}-${i.window.high ?? ''} %; do not re-scale, raise a deviation`);
      }
    }
    const u = outUnit(f, i.unit);
    const value = to(f, u).times(ratio);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return { ok: true, value, unit: u.symbol, shown: `${f.text} × ${a.text} ÷ ${t.text} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T16 Overage
export interface T16Input {
  /** The quantity after any potency adjustment (or one portion). */
  readonly quantity: Q;
  readonly overagePercent: Q;
  /** The highest overage the master allows; refused above it. */
  readonly maxOveragePercent?: Q;
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T16 Overage: quantity × (100 + overage %) ÷ 100; the overage amount is kept separate for reconciliation. */
export function t16Overage(i: T16Input): Outcome<{ readonly overage: Dec }> {
  return run(() => {
    const q = parse(i.quantity, 'The quantity');
    if (q.v.isNegative()) refuse('The quantity cannot be negative');
    const ov = percent(i.overagePercent, 'The overage');
    if (ov.v.isNegative()) refuse('An overage cannot be negative');
    if (i.maxOveragePercent !== undefined) {
      const max = percent(i.maxOveragePercent, 'The maximum overage');
      if (ov.v.gt(max.v)) refuse(`The overage ${ov.text} is above the ${max.text} the master allows`);
    }
    const u = outUnit(q, i.unit);
    const base = to(q, u);
    const value = base.times(HUNDRED.plus(ov.v)).div(HUNDRED);
    const overage = value.minus(base);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return {
      ok: true,
      value,
      unit: u.symbol,
      overage,
      shown: `${q.text} × (100 + ${ov.text}) ÷ 100 = ${show(value, u.symbol, dp)} (of which overage ${show(overage, u.symbol, dp)})`,
      ...checkOf(value, u.symbol, i.limit),
    };
  });
}

// ---------------------------------------------------------------- T18 Content-adjusted quantity
export interface T18Input {
  /**
   * What the formula asks for. With formulaQuantityIs 'dry': the pure amount (mass of active/solids/element,
   * or IU / CFU / activity units). With 'wet': the as-supplied mass at the nominal content.
   */
  readonly target: Q;
  /** The lot's content: %, % w/w, IU/g, IU/mg, CFU/g, U/mg, U/g or mg/IU. */
  readonly content: Q;
  /** The master must say whether the formula quantity is wet (as supplied) or dry (pure). */
  readonly formulaQuantityIs: 'dry' | 'wet';
  /** For 'wet': the content the formula quantity was written at. */
  readonly nominalContent?: Q;
  /** Where the content comes from (recorded on the line): the certificate or an in-process result of this batch. */
  readonly contentSource?: 'certificate' | 'in-process result';
  /**
   * What the result is: the content (% w/w, the default) or a relative assay in % of theoretical (F0205: an extrudate
   * assayed at 95.3 % of its theoretical 30 % load is 28.6 % w/w). A % of theoretical needs `nominalContent`, the
   * theoretical content.
   */
  readonly resultType?: 'content' | 'percent of theoretical';
  /**
   * One intermediate carrying a second API in a fixed ratio (F0187 layered particles): the quantity is set on the first
   * API's content; the second API's content gives what it delivers, shown and checked against `limit` (% of its
   * target). Refused when outside.
   */
  readonly second?: { readonly name: string; readonly content: Q; readonly target: Q; readonly limit: Limit };
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

const PER_MASS: Partial<Record<Kind, Kind>> = { 'IU per mass': 'IU', 'CFU per mass': 'CFU', 'activity units per mass': 'activity units' };

/** T18 Content-adjusted quantity (any material): pure quantity × 100 ÷ content %, or units ÷ units per gram. */
export function t18ContentAdjusted(i: T18Input): Outcome<{ readonly second?: { readonly delivered: Dec; readonly percent: Dec; readonly check: Check } }> {
  return run(() => {
    const t = parse(i.target, 'The formula quantity');
    let c = parse(i.content, "The lot's content");
    if (i.resultType === 'percent of theoretical') {
      if (i.nominalContent === undefined || i.formulaQuantityIs !== 'dry') refuse('A result in % of theoretical needs the theoretical content (nominal content) and a pure (dry) formula quantity');
      needKind(c, ['fraction'], 'A result in % of theoretical');
      const n = percent(i.nominalContent, 'The theoretical content');
      const v = to(c, '%').times(n.v).div(HUNDRED);
      c = { v, unit: unitOf('%'), text: `(${c.text} of theoretical × ${n.text} = ${shownNumber(v, '%')} %)` };
    }
    if (!c.v.isPositive() || c.v.isZero()) refuse("The lot's content must be more than zero");
    const src = i.contentSource === undefined ? '' : ` (content from the ${i.contentSource})`;
    let value: Dec;
    let u: Unit;
    let line: string;
    if (i.formulaQuantityIs === 'wet') {
      if (i.nominalContent === undefined) refuse('A wet (as supplied) formula quantity needs the nominal content it was written at');
      needKind(t, MASS, 'A wet formula quantity');
      const n = parse(i.nominalContent, 'The nominal content');
      sameKind([n, c], 'Nominal and lot content');
      u = outUnit(t, i.unit);
      value = to(t, u).times(n.v).div(to(c, n.unit));
      line = `${t.text} × ${n.text} ÷ ${c.text}`;
    } else if (c.unit.kind === 'fraction') {
      if (POTENCY.includes(t.unit.kind)) refuse(`${t.text} cannot be turned into a mass with a % content: an amount in IU, CFU or activity units needs the lot's content per gram (for example IU/g)`);
      needKind(t, MASS, 'The pure quantity');
      const pc = to(c, '%');
      if (pc.gt(HUNDRED)) refuse('A content in % cannot be above 100 %');
      u = outUnit(t, i.unit);
      value = to(t, u).times(HUNDRED).div(pc);
      line = `${t.text} × 100 ÷ ${c.text}`;
    } else if (PER_MASS[c.unit.kind] !== undefined) {
      const want = PER_MASS[c.unit.kind];
      if (t.unit.kind !== want) refuse(`The lot's content is in ${c.unit.symbol}, so the formula quantity must be in ${want === 'activity units' ? 'U' : want}; "${t.text}" is not`);
      const perG = to(c, c.unit.kind === 'IU per mass' ? 'IU/g' : c.unit.kind === 'CFU per mass' ? 'CFU/g' : 'U/g');
      u = unitOf(i.unit ?? 'mg');
      needKind({ v: ZERO, unit: u, text: '' }, MASS, 'The result unit');
      value = to({ v: t.v.div(perG), unit: unitOf('g'), text: '' }, u);
      line = `${t.text} ÷ ${c.text}`;
    } else if (c.unit.kind === 'mass per IU') {
      if (t.unit.kind !== 'IU') refuse(`A content in mg/IU needs the formula quantity in IU; "${t.text}" is not`);
      u = unitOf(i.unit ?? 'mg');
      value = to({ v: t.v.times(c.v), unit: unitOf('mg'), text: '' }, u);
      line = `${t.text} × ${c.text}`;
    } else {
      refuse(`The lot's content "${c.text}" must be a % or a content per mass (IU/g, CFU/g, U/mg) or mg/IU`);
    }
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    let shown = `${line} = ${show(value, u.symbol, dp)}${src}`;
    if (i.second === undefined) return { ok: true, value, unit: u.symbol, shown, ...checkOf(value, u.symbol, i.limit) };
    const s2 = percent(i.second.content, `The content of ${i.second.name}`);
    const t2 = parse(i.second.target, `The target of ${i.second.name}`);
    needKind(t2, MASS, `The target of ${i.second.name}`);
    if (!t2.v.isPositive() || t2.v.isZero()) refuse(`The target of ${i.second.name} must be more than zero`);
    const delivered = to({ v: value, unit: u, text: '' }, t2.unit).times(s2.v).div(HUNDRED);
    const pct = delivered.div(t2.v).times(HUNDRED);
    const check = checkLimit(pct, '%', i.second.limit);
    shown += `; ${i.second.name}: ${show(value, u.symbol, dp)} × ${s2.text} = ${show(delivered, t2.unit.symbol, defaultDecimals(t2.unit.symbol) + 1)} = ${fmt(pct, 1)} % of ${t2.text}`;
    if (!check.pass) refuse(`${shown}: ${i.second.name} is out of its limits (${check.shown}). The quantity is set on one API's content and moves the other: do not use this intermediate lot without QA`);
    return { ok: true, value, unit: u.symbol, shown, second: { delivered, percent: pct, check }, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T19 Split into portions
export interface T19Input {
  readonly total: Q;
  /** Each portion as a % of the total, a fixed quantity, or the remainder (exactly one; default the last without % or fixed). */
  readonly portions: readonly { readonly name: string; readonly percent?: string; readonly fixed?: Q; readonly remainder?: boolean }[];
  readonly unit?: string;
  readonly decimals?: number;
}

/** T19 Split into portions: % or fixed portions, the remainder = what is left; refused if the remainder is negative. */
export function t19Split(i: T19Input): Outcome<{ readonly portions: readonly { readonly name: string; readonly value: Dec }[] }> {
  return run(() => {
    const total = parse(i.total, 'The total');
    if (total.v.isNegative()) refuse('The total cannot be negative');
    const u = outUnit(total, i.unit);
    const tv = to(total, u);
    const rem = i.portions.filter((p) => p.remainder === true || (p.percent === undefined && p.fixed === undefined));
    if (rem.length !== 1) refuse('Exactly one portion must be the remainder ("what is left")');
    const remName = rem[0]?.name ?? '';
    const out: { name: string; value: Dec }[] = [];
    let used = ZERO;
    for (const p of i.portions) {
      if (p.name === remName && (p.remainder === true || (p.percent === undefined && p.fixed === undefined))) {
        out.push({ name: p.name, value: ZERO });
        continue;
      }
      let v: Dec;
      if (p.percent !== undefined) {
        const pc = percent(p.percent, `The % for ${p.name}`).v;
        if (pc.isNegative()) refuse(`The % for ${p.name} cannot be negative`);
        v = tv.times(pc).div(HUNDRED);
      } else {
        const f = parse(p.fixed as Q, `The quantity for ${p.name}`);
        sameKind([f, total], 'Portions');
        v = to(f, u);
        if (v.isNegative()) refuse(`The quantity for ${p.name} cannot be negative`);
      }
      used = used.plus(v);
      out.push({ name: p.name, value: v });
    }
    const remainder = tv.minus(used);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    if (remainder.isNegative() && !remainder.isZero()) {
      refuse(`The portions add up to ${show(used, u.symbol, dp)}, more than the total ${total.text}; the remainder (${remName}) would be ${show(remainder, u.symbol, dp)}`);
    }
    const idx = out.findIndex((p) => p.name === remName);
    out[idx] = { name: remName, value: remainder };
    const sum = out.reduce((s, p) => s.plus(p.value), ZERO);
    const adds = sum.eq(tv);
    const shown = `${total.text} = ${out.map((p) => `${show(p.value, u.symbol, dp)} ${p.name}`).join(' + ')}; the parts ${adds ? 'add up to the total' : 'DO NOT add up'} (remainder: ${remName})`;
    return { ok: true, value: remainder, unit: u.symbol, portions: out, shown, check: { pass: adds, level: adds ? 'pass' : 'fail', rounded: show(sum, u.symbol, dp), shown } };
  });
}

// ---------------------------------------------------------------- T20 Multi-lot quantity
export interface T20Input {
  /** The pure content needed (mass, or IU/CFU/U). Leave out to compute only the pure content of weighed lots. */
  readonly required?: Q;
  /** Lots in the order used. All but the last have a weighed quantity; the last gets the rest. */
  readonly lots: readonly { readonly name: string; readonly weighed?: Q; readonly content: Q }[];
  readonly unit?: string;
  readonly decimals?: number;
}

export interface T20Extra {
  /** Pure content delivered by each lot (the last one: by the quantity computed). */
  readonly pure: readonly { readonly name: string; readonly value: Dec; readonly unit: string }[];
  /** Total material weighed from all lots (feeds T10). */
  readonly totalWeighed: Dec;
}

function pureOf(weighed: Parsed, content: Parsed): { v: Dec; unit: string } {
  if (content.unit.kind === 'fraction') return { v: to(weighed, 'mg').times(to(content, '%')).div(HUNDRED), unit: 'mg' };
  const want = PER_MASS[content.unit.kind];
  if (want === undefined) refuse(`The content "${content.text}" must be a % or a content per mass (IU/g, CFU/g, U/mg)`);
  const perMg = to(content, content.unit.kind === 'IU per mass' ? 'IU/mg' : content.unit.kind === 'CFU per mass' ? 'CFU/mg' : 'U/mg');
  return { v: to(weighed, 'mg').times(perMg), unit: want === 'activity units' ? 'U' : want };
}

/** T20 Multi-lot quantity: pure content of each weighed lot; the rest from the last lot at its own content. */
export function t20MultiLot(i: T20Input): Outcome<T20Extra> {
  return run(() => {
    if (i.lots.length === 0) refuse('Give at least one lot');
    const lots = i.lots.map((l) => ({ name: l.name, w: l.weighed === undefined ? undefined : parse(l.weighed, `The quantity weighed from ${l.name}`), c: parse(l.content, `The content of ${l.name}`) }));
    for (const l of lots) {
      if (!l.c.v.isPositive() || l.c.v.isZero()) refuse(`The content of ${l.name} must be more than zero`);
      if (l.w !== undefined) needKind(l.w, MASS, `The quantity weighed from ${l.name}`);
    }
    const contentKind = lots[0]?.c.unit.kind;
    if (lots.some((l) => l.c.unit.kind !== contentKind)) refuse('All lots must give their content in the same kind of unit');
    const pure: { name: string; value: Dec; unit: string }[] = [];
    let pureUnit = 'mg';
    let delivered = ZERO;
    let weighed = ZERO;
    const fixed = i.required === undefined ? lots : lots.slice(0, -1);
    for (const l of fixed) {
      if (l.w === undefined) refuse(`Give the quantity weighed from ${l.name}`);
      const p = pureOf(l.w, l.c);
      pureUnit = p.unit;
      pure.push({ name: l.name, value: p.v, unit: p.unit });
      delivered = delivered.plus(p.v);
      weighed = weighed.plus(to(l.w, 'mg'));
    }
    const reqP = i.required === undefined ? undefined : parse(i.required, 'The required pure quantity');
    const u = unitOf(i.unit ?? (reqP !== undefined && reqP.unit.kind === 'mass' ? reqP.unit.symbol : 'kg'));
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    if (reqP === undefined) {
      const pu = pureUnit === 'mg' ? u : unitOf(pureUnit);
      const v = pureUnit === 'mg' ? to({ v: delivered, unit: unitOf('mg'), text: '' }, u) : delivered;
      const shown = lots.map((l) => `${l.name}: ${l.w?.text ?? ''} × ${l.c.text}`).join(' + ') + ` = ${show(v, pu.symbol, dp)} pure`;
      return { ok: true, value: v, unit: pu.symbol, pure, totalWeighed: to({ v: weighed, unit: unitOf('mg'), text: '' }, u), shown };
    }
    const req = reqP;
    const last = lots[lots.length - 1];
    if (last === undefined) refuse('Give at least one lot');
    const probe = pureOf({ v: new Dec(1), unit: unitOf('mg'), text: '' }, last.c);
    const reqV = probe.unit === 'mg' ? (needKind(req, MASS, 'The required pure quantity'), to(req, 'mg')) : (needKind(req, POTENCY, 'The required pure quantity'), req.v);
    const rest = reqV.minus(delivered);
    if (rest.isNegative() && !rest.isZero()) {
      refuse(`The lots already weighed give more than the ${req.text} needed; weigh less from ${fixed[fixed.length - 1]?.name ?? 'the first lot'}`);
    }
    const qtyMg = rest.div(probe.v);
    pure.push({ name: last.name, value: rest, unit: probe.unit });
    weighed = weighed.plus(qtyMg);
    const value = to({ v: qtyMg, unit: unitOf('mg'), text: '' }, u);
    const totalWeighed = to({ v: weighed, unit: unitOf('mg'), text: '' }, u);
    const pureShow = (v: Dec): string => (probe.unit === 'mg' ? show(to({ v, unit: unitOf('mg'), text: '' }, u), u.symbol, dp) : `${fmt(v, 0)} ${probe.unit}`);
    const shown =
      fixed.map((l, n) => `${l.name}: ${l.w?.text ?? ''} × ${l.c.text} = ${pureShow(pure[n]?.value ?? ZERO)} pure`).join('; ') +
      `${fixed.length > 0 ? '; ' : ''}rest ${req.text} − ${pureShow(delivered)} = ${pureShow(rest)} from ${last.name} at ${last.c.text}: ${show(value, u.symbol, dp)} to weigh; total weighed ${show(totalWeighed, u.symbol, dp)}`;
    const done: Done & T20Extra = { ok: true, value, unit: u.symbol, pure, totalWeighed, shown };
    return done;
  });
}
