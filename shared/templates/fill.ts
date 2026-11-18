/**
 * I18 Volume, mass and fill target by density (copied from TrueBatch Injectables, library v1).
 * Three modes: convert (volume ↔ mass), q.s. (vehicle to add up to a final target) and fill target
 * (nominal fill + excess, as a volume and as a net fill weight with its ± limits).
 * The density's temperature is not checked here.
 */
import { checkOf, defaultDecimals, Dec, HUNDRED, needKind, parse, refuse, run, show, to, unitOf, type Outcome, type Parsed, type Q } from './core.js';
import type { Limit } from './rounding.js';

export type I18Input =
  | {
      /** A volume and a density give a mass; a mass and a density give a volume. */
      readonly mode: 'convert';
      readonly quantity: Q;
      readonly density: Q;
      /** Result unit (default kg for a mass, L for a volume). */
      readonly unit?: string;
      readonly decimals?: number;
      readonly limit?: Limit;
    }
  | {
      /** Vehicle to add = final target − what is already in the vessel (net). */
      readonly mode: 'qs';
      /** The final target as a volume (needs the density) or as a weight: one of the two. */
      readonly finalVolume?: Q;
      readonly finalWeight?: Q;
      readonly density?: Q;
      /** What the vessel holds now, as a weight (e.g. the net of the tank). */
      readonly inVessel: Q;
      /** Result unit (default kg). */
      readonly unit?: string;
      readonly decimals?: number;
      readonly limit?: Limit;
    }
  | {
      /** Target fill volume = nominal fill + excess; with a density, the target net fill weight. */
      readonly mode: 'fill target';
      readonly nominalFill: Q;
      /** The fill excess, in mL or in % of the nominal fill (0 is allowed). */
      readonly excess: Q;
      readonly density?: Q;
      /** ± around the target fill weight (in g, mg or %), with an optional narrower alert band. Needs the density. */
      readonly weightTolerance?: { readonly plusMinus: Q; readonly alertPlusMinus?: Q };
      /** Unit of the fill weight (default g). */
      readonly weightUnit?: string;
      /** Decimals of the fill weight and its limits (default 3). */
      readonly weightDecimals?: number;
      readonly decimals?: number;
      readonly limit?: Limit;
    };

export interface I18Extra {
  /** Fill target: the target fill volume (the result) and the nominal fill, in mL. */
  readonly targetVolume?: Dec;
  readonly nominalVolume?: Dec;
  /** Fill target with a density: target and nominal net fill weight (weight unit); q.s.: the final target weight (result unit). */
  readonly targetWeight?: Dec;
  readonly nominalWeight?: Dec;
  readonly weightUnit?: string;
  /** Fill target with a tolerance: the limit for each net fill weight (for C1 or C3), alert band included when given. */
  readonly weightLimit?: Limit;
}

function densityOf(q: Q): Parsed {
  const d = parse(q, 'The density');
  needKind(d, ['density'], 'The density');
  if (!d.v.isPositive() || d.v.isZero()) refuse('The density must be more than zero');
  return d;
}

const g = (v: Dec): Parsed => ({ v, unit: unitOf('g'), text: '' });
const mL = (v: Dec): Parsed => ({ v, unit: unitOf('mL'), text: '' });

/** A ± tolerance around the target weight, in the weight unit. */
function band(q: Q, target: Dec, wu: string, what: string): { v: Dec; text: string } {
  const p = parse(q, what);
  if (p.v.isNegative()) refuse(`${what} cannot be negative`);
  if (p.unit.kind === 'fraction') return { v: target.times(to(p, '%')).div(HUNDRED), text: p.text };
  needKind(p, ['mass', 'fraction'], what);
  return { v: to(p, wu), text: p.text };
}

/** I18 Volume, mass and fill target by density. */
export function i18Density(i: I18Input): Outcome<I18Extra> {
  return run(() => {
    if (i.mode === 'convert') {
      const q = parse(i.quantity, 'The quantity');
      needKind(q, ['volume', 'mass'], 'The quantity');
      if (q.v.isNegative()) refuse('The quantity cannot be negative');
      const d = densityOf(i.density);
      const toMass = q.unit.kind === 'volume';
      const u = unitOf(i.unit ?? (toMass ? 'kg' : 'L'));
      if (u.kind !== (toMass ? 'mass' : 'volume')) refuse(`The result unit must be a ${toMass ? 'mass (kg, g …)' : 'volume (L, mL …)'}; "${u.symbol}" is not`);
      const value = toMass ? to(g(to(q, 'mL').times(to(d, 'g/mL'))), u) : to(mL(to(q, 'g').div(to(d, 'g/mL'))), u);
      const dp = i.decimals ?? defaultDecimals(u.symbol);
      const shown = `${q.text} ${toMass ? '×' : '÷'} ${d.text} = ${show(value, u.symbol, dp)}`;
      return { ok: true, value, unit: u.symbol, shown, ...checkOf(value, u.symbol, i.limit) };
    }

    if (i.mode === 'qs') {
      if ((i.finalVolume === undefined) === (i.finalWeight === undefined)) refuse('Give the final target either as a volume (with the density) or as a weight, one of the two');
      const u = unitOf(i.unit ?? 'kg');
      if (u.kind !== 'mass') refuse(`The result unit must be a mass (kg, g …); "${u.symbol}" is not`);
      const dp = i.decimals ?? defaultDecimals(u.symbol);
      let targetG: Dec;
      let targetText: string;
      if (i.finalVolume !== undefined) {
        const v = parse(i.finalVolume, 'The final volume');
        needKind(v, ['volume'], 'The final volume');
        if (!v.v.isPositive() || v.v.isZero()) refuse('The final volume must be more than zero');
        if (i.density === undefined) refuse('A final volume needs the density of the finished liquid (measured or from the master) to give the target weight');
        const d = densityOf(i.density);
        targetG = to(v, 'mL').times(to(d, 'g/mL'));
        targetText = `${v.text} × ${d.text} = ${show(to(g(targetG), u), u.symbol, dp)}`;
      } else {
        const w = parse(i.finalWeight as Q, 'The final weight');
        needKind(w, ['mass'], 'The final weight');
        if (!w.v.isPositive() || w.v.isZero()) refuse('The final weight must be more than zero');
        targetG = to(w, 'g');
        targetText = w.text;
      }
      const inV = parse(i.inVessel, 'What is in the vessel');
      needKind(inV, ['mass'], 'What is in the vessel');
      if (inV.v.isNegative()) refuse('What is in the vessel cannot be negative; check the gross and tare');
      const addG = targetG.minus(to(inV, 'g'));
      const target = to(g(targetG), u);
      if (addG.isNegative() && !addG.isZero()) {
        refuse(
          `The vessel already holds ${inV.text}, more than the final target of ${show(target, u.symbol, dp)}: nothing can be added to reach it. ` +
            'Check the tare and the reading; if they are right, the batch is over its target and needs a deviation',
        );
      }
      const value = to(g(addG), u);
      const shown = `vehicle to add = ${targetText} − ${inV.text} = ${show(value, u.symbol, dp)}`;
      return { ok: true, value, unit: u.symbol, targetWeight: target, weightUnit: u.symbol, shown, ...checkOf(value, u.symbol, i.limit) };
    }

    // fill target
    const nom = parse(i.nominalFill, 'The nominal fill');
    needKind(nom, ['volume'], 'The nominal fill');
    if (!nom.v.isPositive() || nom.v.isZero()) refuse('The nominal fill must be more than zero');
    const nomMl = to(nom, 'mL');
    const ex = parse(i.excess, 'The fill excess');
    needKind(ex, ['volume', 'fraction'], 'The fill excess');
    if (ex.v.isNegative()) refuse('The fill excess cannot be negative; a fill below the nominal volume is never a target');
    const exMl = ex.unit.kind === 'fraction' ? nomMl.times(to(ex, '%')).div(HUNDRED) : to(ex, 'mL');
    const targetMl = nomMl.plus(exMl);
    const dp = i.decimals ?? defaultDecimals('mL');
    const exText = ex.unit.kind === 'fraction' ? `${ex.text} of ${nom.text} = ${show(exMl, 'mL', dp)}` : ex.text;
    let shown = `target fill = ${nom.text} + ${exText} = ${show(targetMl, 'mL', dp)}`;
    if (i.density === undefined) {
      if (i.weightTolerance !== undefined) refuse('A fill weight tolerance needs the density to give the target fill weight');
      return { ok: true, value: targetMl, unit: 'mL', targetVolume: targetMl, nominalVolume: nomMl, shown, ...checkOf(targetMl, 'mL', i.limit) };
    }
    const d = densityOf(i.density);
    const wu = unitOf(i.weightUnit ?? 'g');
    if (wu.kind !== 'mass') refuse(`The fill weight unit must be a mass (g, mg …); "${wu.symbol}" is not`);
    const wdp = i.weightDecimals ?? 3;
    const targetWeight = to(g(targetMl.times(to(d, 'g/mL'))), wu);
    const nominalWeight = to(g(nomMl.times(to(d, 'g/mL'))), wu);
    shown += `; target net fill weight = ${show(targetMl, 'mL', dp)} × ${d.text} = ${show(targetWeight, wu.symbol, wdp)}`;
    let weightLimit: Limit | undefined;
    if (i.weightTolerance !== undefined) {
      const act = band(i.weightTolerance.plusMinus, targetWeight, wu.symbol, 'The fill weight tolerance');
      const alert = i.weightTolerance.alertPlusMinus === undefined ? undefined : band(i.weightTolerance.alertPlusMinus, targetWeight, wu.symbol, 'The fill weight alert tolerance');
      if (alert !== undefined && alert.v.gt(act.v)) refuse('The alert tolerance must not be wider than the action tolerance');
      // The limits are written at the fill weight's decimals, rounded inwards so that they are never wider than the tolerance.
      const low = (b: Dec): string => targetWeight.minus(b).toFixed(wdp, Dec.ROUND_CEIL);
      const high = (b: Dec): string => targetWeight.plus(b).toFixed(wdp, Dec.ROUND_FLOOR);
      weightLimit = { low: low(act.v), high: high(act.v), unit: wu.symbol, ...(alert === undefined ? {} : { alertLow: low(alert.v), alertHigh: high(alert.v) }) };
      shown += `; limits ± ${act.text}: ${weightLimit.low} to ${weightLimit.high} ${wu.symbol}`;
      if (alert !== undefined) shown += ` (alert ± ${alert.text}: ${weightLimit.alertLow} to ${weightLimit.alertHigh} ${wu.symbol})`;
    }
    return {
      ok: true,
      value: targetMl,
      unit: 'mL',
      targetVolume: targetMl,
      nominalVolume: nomMl,
      targetWeight,
      nominalWeight,
      weightUnit: wu.symbol,
      ...(weightLimit === undefined ? {} : { weightLimit }),
      shown,
      ...checkOf(targetMl, 'mL', i.limit),
    };
  });
}
