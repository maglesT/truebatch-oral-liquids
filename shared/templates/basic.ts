/**
 * T1 Difference, T2 Total, T3 % of target, T4 Accountability, T5 % change,
 * T6 Ratio and powder indices, T21 Lesser / greater of values.
 */
import { checkOf, defaultDecimals, Dec, fmt, HUNDRED, needKind, parse, refuse, run, sameKind, show, shownNumber, to, unitOf, ZERO, type Outcome, type Q } from './core.js';
import type { Limit } from './rounding.js';
import { differenceUnitOf, type Kind } from './units.js';

// ---------------------------------------------------------------- T1 Difference
export interface T1Input {
  /** First value (gross, before, inlet, target ...). */
  readonly a: Q;
  /** Value taken off (tare, after, exhaust, found ...). */
  readonly b: Q;
  /** Result unit (default: the unit of `a`). */
  readonly unit?: string;
  readonly decimals?: number;
  /** Default false: a negative difference (tare above gross) is refused. */
  readonly allowNegative?: boolean;
  readonly names?: readonly [string, string];
  readonly limit?: Limit;
}

/** T1 Difference: a − b (gross − tare is the common case). Temperatures give a temperature difference. */
export function t1Difference(i: T1Input): Outcome {
  return run(() => {
    const [na, nb] = i.names ?? ['gross', 'tare'];
    const a = parse(i.a, `The ${na}`);
    const b = parse(i.b, `The ${nb}`);
    sameKind([a, b], 'Difference');
    let value: Dec;
    let unit: string;
    if (a.unit.kind === 'temperature') {
      value = a.v.minus(to(b, a.unit));
      unit = differenceUnitOf(a.unit).symbol;
      if (i.unit !== undefined) {
        value = to({ v: value, unit: differenceUnitOf(a.unit), text: '' }, differenceUnitOf(unitOf(i.unit)));
        unit = differenceUnitOf(unitOf(i.unit)).symbol;
      }
    } else {
      const u = unitOf(i.unit ?? a.unit.symbol);
      value = to(a, u).minus(to(b, u));
      unit = u.symbol;
    }
    if (value.isNegative() && !value.isZero() && i.allowNegative !== true) {
      refuse(`The ${nb} (${b.text}) is more than the ${na} (${a.text}); check both readings`);
    }
    const dp = i.decimals ?? Math.max(defaultDecimals(unit), 0);
    return { ok: true, value, unit, shown: `${a.text} − ${b.text} = ${show(value, unit, dp)}`, ...checkOf(value, unit, i.limit) };
  });
}

// ---------------------------------------------------------------- T2 Total
export interface T2Input {
  readonly values: readonly Q[];
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T2 Total: the sum of several values of one kind. Temperatures are never added. */
export function t2Total(i: T2Input): Outcome {
  return run(() => {
    if (i.values.length === 0) refuse('A total needs at least one value');
    const ps = i.values.map((q, n) => parse(q, `Value ${n + 1}`));
    sameKind(ps, 'Total');
    const first = ps[0];
    if (first === undefined) refuse('A total needs at least one value');
    if (first.unit.kind === 'temperature' || first.unit.kind === 'temperature difference') refuse('Temperatures are never added; use the mean (T7) or a difference (T1)');
    if (first.unit.kind === 'fraction') refuse('Percentages are not added; total the quantities they refer to');
    const u = unitOf(i.unit ?? first.unit.symbol);
    const value = ps.reduce((s, p) => s.plus(to(p, u)), ZERO);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return { ok: true, value, unit: u.symbol, shown: `${ps.map((p) => p.text).join(' + ')} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
  });
}

// ---------------------------------------------------------------- T3 % of target
export interface T3Input {
  readonly actual: Q;
  readonly theoretical: Q;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T3 % of target (yield): actual ÷ theoretical × 100. */
export function t3PercentOfTarget(i: T3Input): Outcome {
  return run(() => {
    const a = parse(i.actual, 'The actual quantity');
    const t = parse(i.theoretical, 'The theoretical quantity');
    sameKind([a, t], '% of target');
    if (a.unit.kind === 'temperature') refuse('A % of target is not taken of temperatures');
    if (!t.v.isPositive() || t.v.isZero()) refuse('The theoretical quantity must be more than zero');
    if (a.v.isNegative()) refuse('The actual quantity cannot be negative');
    const value = to(a, t.unit).div(t.v).times(HUNDRED);
    const dp = i.decimals ?? 1;
    return { ok: true, value, unit: '%', shown: `${a.text} ÷ ${t.text} × 100 = ${fmt(value, dp)} %`, ...checkOf(value, '%', i.limit) };
  });
}

// ---------------------------------------------------------------- T4 Accountability
export interface T4Input {
  readonly input: Q;
  /** Output, samples, rejects, waste ... each with a name. */
  readonly parts: readonly { readonly name: string; readonly value: Q }[];
  readonly decimals?: number;
  /** Limit on the accountability %. */
  readonly limit?: Limit;
  /** Limit on the unaccounted quantity (in its own unit, or in % of the input). */
  readonly unaccountedLimit?: Limit;
}

export interface T4Extra {
  readonly unaccounted: Dec;
  readonly unaccountedUnit: string;
  readonly unaccountedPercent: Dec;
  readonly unaccountedCheck?: import('./rounding.js').Check;
}

/** T4 Accountability: (sum of all parts) ÷ input × 100, and unaccounted = input − all parts. */
export function t4Accountability(i: T4Input): Outcome<T4Extra> {
  return run(() => {
    const input = parse(i.input, 'The input quantity');
    if (!input.v.isPositive() || input.v.isZero()) refuse('The input quantity must be more than zero');
    if (i.parts.length === 0) refuse('Give at least one part (output, samples, rejects, waste)');
    const parts = i.parts.map((p) => ({ name: p.name, p: parse(p.value, `The ${p.name} quantity`) }));
    sameKind([input, ...parts.map((x) => x.p)], 'Accountability');
    for (const x of parts) if (x.p.v.isNegative()) refuse(`The ${x.name} quantity cannot be negative`);
    const sum = parts.reduce((s, x) => s.plus(to(x.p, input.unit)), ZERO);
    const value = sum.div(input.v).times(HUNDRED);
    const unaccounted = input.v.minus(sum);
    const unaccountedPercent = unaccounted.div(input.v).times(HUNDRED);
    const u = input.unit.symbol;
    const dp = i.decimals ?? defaultDecimals(u);
    let unaccountedCheck;
    if (i.unaccountedLimit !== undefined) {
      const lu = unitOf(i.unaccountedLimit.unit);
      unaccountedCheck = lu.kind === 'fraction' ? checkOf(unaccountedPercent, '%', i.unaccountedLimit).check : checkOf(unaccounted, u, i.unaccountedLimit).check;
    }
    const shown =
      `(${parts.map((x) => `${x.p.text} ${x.name}`).join(' + ')}) ÷ ${input.text} × 100 = ${fmt(value, 2)} %; ` +
      `unaccounted ${input.text} − ${show(sum, u, dp)} = ${show(unaccounted, u, dp)} (${fmt(unaccountedPercent, 2)} %)`;
    return { ok: true, value, unit: '%', shown, unaccounted, unaccountedUnit: u, unaccountedPercent, ...(unaccountedCheck === undefined ? {} : { unaccountedCheck }), ...checkOf(value, '%', i.limit) };
  });
}

// ---------------------------------------------------------------- T5 % change
export interface T5Input {
  readonly before: Q;
  readonly after: Q;
  /** gain = (after − before) ÷ before × 100; loss = (before − after) ÷ before × 100. */
  readonly mode: 'gain' | 'loss';
  /**
   * The weight the change is expressed on (one setting, the master must choose):
   * 'start' = this layer's own starting weight; 'final' = the weight after this step;
   * or a named earlier stage, e.g. { stage: 'uncoated core', weight: '200.0 mg' }.
   */
  readonly base: 'start' | 'final' | { readonly stage: string; readonly weight: Q };
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T5 % change: weight gain of a coat on its own starting weight, or a loss (friability, LOD by weight). */
export function t5PercentChange(i: T5Input): Outcome {
  return run(() => {
    const b = parse(i.before, 'The weight before');
    const a = parse(i.after, 'The weight after');
    sameKind([a, b], '% change');
    if (b.unit.kind === 'temperature') refuse('A % change is not taken of temperatures');
    if (i.base === undefined || (typeof i.base === 'string' && i.base !== 'start' && i.base !== 'final')) refuse('Say which weight the change is expressed on: the starting weight, the final weight or a named earlier stage');
    const named = typeof i.base === 'object' ? i.base : undefined;
    const base = named !== undefined ? parse(named.weight, `The ${named.stage} weight`) : i.base === 'final' ? a : b;
    sameKind([b, base], '% change');
    const baseName = named !== undefined ? `the ${named.stage} weight` : i.base === 'final' ? 'the final weight' : 'the starting weight';
    if (!base.v.isPositive() || base.v.isZero()) refuse(`${baseName.charAt(0).toUpperCase()}${baseName.slice(1)} must be more than zero`);
    const av = to(a, b.unit);
    const change = i.mode === 'gain' ? av.minus(b.v) : b.v.minus(av);
    const value = change.div(to(base, b.unit)).times(HUNDRED);
    const dp = i.decimals ?? 2;
    const top = i.mode === 'gain' ? `(${a.text} − ${b.text})` : `(${b.text} − ${a.text})`;
    return { ok: true, value, unit: '%', shown: `${top} ÷ ${base.text} × 100 = ${fmt(value, dp)} % ${i.mode} on ${baseName}`, ...checkOf(value, '%', i.limit) };
  });
}

// ---------------------------------------------------------------- T6 Ratio
export interface T6Input {
  /**
   * ratio: a ÷ b; carr: (tapped − bulk) ÷ tapped × 100; hausner: tapped ÷ bulk; log10: log10(a ÷ b);
   * angle of repose (fixed funnel): arctan(height ÷ radius) in degrees, a = cone height, b = radius (or diameter, see bIs).
   * whole containers: a = amount required, b = amount per container; containers = a ÷ b rounded UP, the excess shown.
   */
  readonly mode: 'ratio' | 'carr' | 'hausner' | 'log10' | 'angle of repose' | 'whole containers';
  /** Angle of repose only: b is the cone's radius (default) or its diameter (then tan = 2 × height ÷ diameter). */
  readonly bIs?: 'radius' | 'diameter';
  /** ratio/log10: numerator. carr/hausner: bulk density. */
  readonly a: Q;
  /** ratio/log10: denominator. carr/hausner: tapped density. */
  readonly b: Q;
  /** Result unit for a ratio (e.g. "tablets" for a count by weight, "MPa", "kN/cm²", "g/mL"). */
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/**
 * Quotients of two different kinds that make sense on a batch record. Both values are converted
 * to the listed units first; the result is then in `result`.
 */
const QUOTIENTS: readonly { num: Kind; den: Kind; numU: string; denU: string; result: string }[] = [
  { num: 'force', den: 'area', numU: 'N', denU: 'mm²', result: 'MPa' },
  { num: 'mass', den: 'area', numU: 'mg', denU: 'cm²', result: 'mg/cm²' },
  { num: 'mass', den: 'count', numU: 'mg', denU: 'units', result: 'mg' },
  { num: 'mass', den: 'volume', numU: 'g', denU: 'mL', result: 'g/mL' },
  { num: 'mass', den: 'time', numU: 'kg', denU: 'h', result: 'kg/h' },
  { num: 'volume', den: 'time', numU: 'L', denU: 'h', result: 'L/h' },
  { num: 'count', den: 'time', numU: 'units', denU: 'h', result: 'units/h' },
];

export function t6Ratio(i: T6Input): Outcome<{ readonly excess?: Dec }> {
  return run(() => {
    if (i.mode === 'whole containers') {
      const need = parse(i.a, 'The amount required');
      const per = parse(i.b, 'The amount per container');
      sameKind([need, per], 'Whole containers');
      if (need.v.isNegative() || !per.v.isPositive() || per.v.isZero()) refuse('The amount required cannot be negative, and the amount per container must be more than zero');
      const value = to(need, per.unit).div(per.v).ceil();
      const excess = value.times(per.v).minus(to(need, per.unit));
      const shown = `${need.text} ÷ ${per.text} = ${fmt(to(need, per.unit).div(per.v), 2)}, rounded up to ${value.toFixed(0)} containers; excess ${shownNumber(excess, per.unit.symbol)} ${per.unit.symbol} (weigh a part container, or scale the batch)`;
      return { ok: true, value, unit: 'units', excess, shown, ...checkOf(value, 'units', i.limit) };
    }
    if (i.mode === 'carr' || i.mode === 'hausner') {
      const bulk = parse(i.a, 'The bulk density');
      const tapped = parse(i.b, 'The tapped density');
      needKind(bulk, ['density'], 'The bulk density');
      needKind(tapped, ['density'], 'The tapped density');
      const bv = to(bulk, tapped.unit);
      if (!bv.isPositive() || bv.isZero()) refuse('The bulk density must be more than zero');
      if (tapped.v.lt(bv)) refuse(`The tapped density (${tapped.text}) cannot be lower than the bulk density (${bulk.text}); check the readings`);
      if (i.mode === 'carr') {
        const value = tapped.v.minus(bv).div(tapped.v).times(HUNDRED);
        return { ok: true, value, unit: '%', shown: `Carr index = (${tapped.text} − ${bulk.text}) ÷ ${tapped.text} × 100 = ${fmt(value, i.decimals ?? 1)} %`, ...checkOf(value, '%', i.limit) };
      }
      const value = tapped.v.div(bv);
      return { ok: true, value, unit: '', shown: `Hausner ratio = ${tapped.text} ÷ ${bulk.text} = ${fmt(value, i.decimals ?? 2)}`, ...checkOf(value, '', i.limit) };
    }
    if (i.mode === 'angle of repose') {
      const h = parse(i.a, 'The cone height');
      const r = parse(i.b, i.bIs === 'diameter' ? 'The cone diameter' : 'The cone radius');
      needKind(h, ['length'], 'The cone height');
      needKind(r, ['length'], i.bIs === 'diameter' ? 'The cone diameter' : 'The cone radius');
      if (!h.v.isPositive() || h.v.isZero() || !r.v.isPositive() || r.v.isZero()) refuse('Height and radius (or diameter) must be more than zero');
      const tan = i.bIs === 'diameter' ? to(h, 'mm').times(2).div(to(r, 'mm')) : to(h, 'mm').div(to(r, 'mm'));
      const value = Dec.atan(tan).times(180).div(Dec.acos(-1));
      const line = i.bIs === 'diameter' ? `arctan(2 × ${h.text} ÷ ${r.text})` : `arctan(${h.text} ÷ ${r.text})`;
      return { ok: true, value, unit: '°', shown: `angle of repose = ${line} = ${fmt(value, i.decimals ?? 1)}°`, ...checkOf(value, '°', i.limit) };
    }
    const a = parse(i.a, 'The first value');
    const b = parse(i.b, 'The second value');
    if (b.v.isZero()) refuse('Cannot divide by zero');
    if (a.unit.kind === 'temperature' || b.unit.kind === 'temperature') refuse('A ratio is not taken of temperatures');
    if (i.mode === 'log10') {
      sameKind([a, b], 'Log of a ratio');
      if (!a.v.isPositive() || !b.v.isPositive() || a.v.isZero()) refuse('Both values must be more than zero for a logarithm');
      const value = Dec.log10(to(a, b.unit).div(b.v));
      return { ok: true, value, unit: 'log', shown: `log10(${a.text} ÷ ${b.text}) = ${fmt(value, i.decimals ?? 2)} log`, ...checkOf(value, 'log', i.limit) };
    }
    let value: Dec;
    let unit: string;
    if (a.unit.kind === b.unit.kind) {
      value = to(a, b.unit).div(b.v);
      unit = '';
      if (i.unit !== undefined) {
        const u = unitOf(i.unit);
        if (u.kind !== 'number' && u.kind !== 'count' && u.kind !== 'fraction') refuse(`${a.text} ÷ ${b.text} is a plain number, not ${i.unit}`);
        if (u.kind === 'fraction') value = value.times(HUNDRED);
        unit = u.symbol;
      }
    } else {
      const q = QUOTIENTS.find((x) => x.num === a.unit.kind && x.den === b.unit.kind);
      if (q === undefined) refuse(`${a.text} ÷ ${b.text}: a ${a.unit.kind} divided by a ${b.unit.kind} is not a ratio this template gives`);
      const raw = to(a, q.numU).div(to(b, q.denU));
      const u = unitOf(i.unit ?? q.result);
      value = to({ v: raw, unit: unitOf(q.result), text: '' }, u);
      unit = u.symbol;
    }
    const dp = i.decimals ?? defaultDecimals(unit);
    // A count to the whole item (owner, 17 Nov 2026: no fractional tablets or packs): tablets counted by weight are
    // rounded half up; whole packs (a count ÷ a count) are rounded down, as a part pack is no pack.
    if (unit !== '' && unitOf(unit).kind === 'count' && dp === 0 && !value.isInteger()) {
      const whole = value.toDecimalPlaces(0, a.unit.kind === 'count' ? Dec.ROUND_DOWN : Dec.ROUND_HALF_UP);
      const how = a.unit.kind === 'count' ? 'whole' : 'rounded to whole';
      return { ok: true, value: whole, unit, shown: `${a.text} ÷ ${b.text} = ${shownNumber(value, unit)}, ${how} ${unit} = ${show(whole, unit, 0)}`, ...checkOf(whole, unit, i.limit) };
    }
    return { ok: true, value, unit, shown: `${a.text} ÷ ${b.text}${unit === '%' ? ' × 100' : ''} = ${show(value, unit, dp)}`, ...checkOf(value, unit, i.limit) };
  });
}

// ---------------------------------------------------------------- T21 Lesser / greater
export interface T21Input {
  readonly which: 'lesser' | 'greater';
  readonly values: readonly { readonly name: string; readonly value: Q }[];
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T21 Lesser / greater of values: the smallest (or largest) of several values, and which one it was. */
export function t21LesserGreater(i: T21Input): Outcome<{ readonly from: string }> {
  return run(() => {
    if (i.values.length < 2) refuse('Give at least two values to compare');
    const ps = i.values.map((x) => ({ name: x.name, p: parse(x.value, `The ${x.name} value`) }));
    sameKind(ps.map((x) => x.p), 'Lesser / greater');
    const first = ps[0];
    if (first === undefined) refuse('Give at least two values to compare');
    const u = first.p.unit;
    let best = first;
    for (const x of ps) {
      const c = to(x.p, u).cmp(to(best.p, u));
      if ((i.which === 'lesser' && c < 0) || (i.which === 'greater' && c > 0)) best = x;
    }
    const value = to(best.p, u);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return {
      ok: true,
      value,
      unit: u.symbol,
      from: best.name,
      shown: `The ${i.which} of ${ps.map((x) => `${x.name} ${x.p.text}`).join(', ')} is ${show(value, u.symbol, dp)} (${best.name})`,
      ...checkOf(value, u.symbol, i.limit),
    };
  });
}
