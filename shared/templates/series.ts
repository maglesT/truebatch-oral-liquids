/**
 * T7 Statistics of readings, and the checks on a series: C1 Within limits, C2 Count of readings,
 * C3 All individual values, C4 Observation.
 */
import { checkOf, Dec, decimalsOf, fmt, HUNDRED, parse, parseAny, refuse, run, sameKind, show, to, unitOf, ZERO, type Done, type Outcome, type Parsed, type Q, type ResultValue } from './core.js';
import { checkLimit, roundHalfUp, writtenDecimals, type Check, type Limit } from './rounding.js';
import { differenceUnitOf, type Unit } from './units.js';

/** A series of readings: each with its unit ("750.2 mg"), or plain values with one unit. */
export type Series = { readonly readings: readonly Q[] } | { readonly values: readonly string[]; readonly unit: string };

/** A per-unit value from two readings on the same unit (v2): first − second (e.g. top − bottom wall). */
export interface Pairs {
  readonly pairs: readonly (readonly [Q, Q])[];
}

/**
 * A per-unit value from any number of readings on the same unit:
 * 'first minus rest' (e.g. before − after1 − after2), 'sum', or 'split loss %' =
 * (whole − sum of the parts) ÷ whole × 100 (loss of mass on splitting a scored tablet).
 */
export interface Groups {
  readonly units: readonly (readonly Q[])[];
  readonly combine: 'first minus rest' | 'sum' | 'split loss %';
}

export function readSeries(s: Series | Pairs | Groups, what = 'Reading'): Parsed[] {
  if ('units' in s) {
    return s.units.map((rs, n) => {
      if (rs.length < 2) refuse(`Unit ${n + 1} needs at least two readings`);
      const ps = rs.map((q, k) => parse(q, `${what} ${n + 1}.${k + 1}`));
      sameKind(ps, `Unit ${n + 1}`);
      const first = ps[0] as Parsed;
      if (first.unit.kind === 'temperature') refuse('Temperatures are never added');
      const rest = ps.slice(1).reduce((t, p) => t.plus(to(p, first.unit)), ZERO);
      if (s.combine === 'sum') return { v: first.v.plus(rest), unit: first.unit, text: ps.map((p) => p.text).join(' + ') };
      if (s.combine === 'first minus rest') return { v: first.v.minus(rest), unit: first.unit, text: `${first.text} − (${ps.slice(1).map((p) => p.text).join(' + ')})` };
      if (!first.v.isPositive() || first.v.isZero()) refuse(`Unit ${n + 1}: the whole-tablet weight must be more than zero`);
      if (rest.gt(first.v)) refuse(`Unit ${n + 1}: the parts (${show(rest, first.unit.symbol, 2)}) weigh more than the whole tablet (${first.text}); check the weighings`);
      return { v: first.v.minus(rest).div(first.v).times(HUNDRED), unit: unitOf('%'), text: `(${first.text} − ${ps.slice(1).map((p) => p.text).join(' − ')}) ÷ ${first.text} × 100` };
    });
  }
  if ('pairs' in s) {
    return s.pairs.map(([x, y], n) => {
      const a = parse(x, `${what} ${n + 1} (first)`);
      const b = parse(y, `${what} ${n + 1} (second)`);
      sameKind([a, b], `${what} ${n + 1}`);
      const u = a.unit.kind === 'temperature' ? differenceUnitOf(a.unit) : a.unit;
      const v = a.v.minus(to(b, a.unit));
      return { v, unit: u, text: `(${a.text} − ${b.text})` };
    });
  }
  const ps = 'readings' in s ? s.readings.map((q, n) => parse(q, `${what} ${n + 1}`)) : s.values.map((v, n) => parse({ value: v, unit: s.unit }, `${what} ${n + 1}`));
  sameKind(ps, 'The readings');
  return ps;
}

export interface Stats {
  readonly count: number;
  readonly sum: Dec;
  readonly mean: Dec;
  /** Sample standard deviation (n − 1); undefined for one reading. */
  readonly sd: Dec | undefined;
  /** sd ÷ mean × 100; undefined for one reading or a mean of zero. */
  readonly rsd: Dec | undefined;
  readonly min: Dec;
  readonly max: Dec;
  readonly unit: Unit;
}

/** Plain statistics in the unit of the first reading. */
export function stats(ps: readonly Parsed[]): Stats {
  const first = ps[0];
  if (first === undefined) refuse('There are no readings');
  const u = first.unit;
  const xs = ps.map((p) => to(p, u));
  const n = xs.length;
  const sum = xs.reduce((s, x) => s.plus(x), ZERO);
  const mean = sum.div(n);
  let sd: Dec | undefined;
  let rsd: Dec | undefined;
  if (n >= 2) {
    const ss = xs.reduce((s, x) => s.plus(x.minus(mean).pow(2)), ZERO);
    sd = ss.div(n - 1).sqrt();
    if (!mean.isZero()) rsd = sd.div(mean.abs()).times(HUNDRED);
  }
  const min = Dec.min(...xs);
  const max = Dec.max(...xs);
  return { count: n, sum, mean, sd, rsd, min, max, unit: u };
}

// ---------------------------------------------------------------- T7 Statistics
export type T7Input = (Series | Pairs | Groups) & {
  /** Display decimals for the mean, min, max (default: one more than the readings). */
  readonly decimals?: number;
  /** Limit on the mean. */
  readonly limit?: Limit;
  /** Limit on the % RSD. */
  readonly rsdLimit?: Limit;
};

export interface T7Extra {
  readonly stats: Stats;
  readonly rsdCheck?: Check;
}

/** T7 Statistics of readings: mean (the value), SD, % RSD, min, max, count. */
export function t7Statistics(i: T7Input): Outcome<T7Extra> {
  return run(() => {
    const ps = readSeries(i);
    const s = stats(ps);
    const typed = 'values' in i ? i.values : 'readings' in i ? i.readings.map((q) => (typeof q === 'string' ? q.trim().split(/\s+/)[0] ?? '' : q.value)) : [];
    const dp = i.decimals ?? (typed.length > 0 ? Math.max(...typed.map(decimalsOf)) + 1 : 2);
    const meanUnit = s.unit.symbol;
    const sdUnit = differenceUnitOf(s.unit).symbol;
    const parts = [
      `n = ${s.count}`,
      `mean = ${show(s.mean, meanUnit, dp)}`,
      ...(s.sd === undefined ? [] : [`SD = ${show(s.sd, sdUnit, dp + 1)}`]),
      ...(s.rsd === undefined ? [] : [`RSD = ${fmt(s.rsd, 2)} %`]),
      `min = ${show(s.min, meanUnit, dp - 1 < 0 ? 0 : dp - 1)}`,
      `max = ${show(s.max, meanUnit, dp - 1 < 0 ? 0 : dp - 1)}`,
    ];
    let rsdCheck: Check | undefined;
    if (i.rsdLimit !== undefined) {
      if (s.rsd === undefined) refuse('The % RSD needs at least two readings and a mean other than zero');
      rsdCheck = checkLimit(s.rsd, '%', i.rsdLimit);
    }
    return { ok: true, value: s.mean, unit: meanUnit, stats: s, shown: parts.join('; '), ...(rsdCheck === undefined ? {} : { rsdCheck }), ...checkOf(s.mean, meanUnit, i.limit) };
  });
}

// ---------------------------------------------------------------- C1 Within limits
/**
 * Limits centred on a value computed earlier in the same batch (e.g. the target tablet weight from the blend
 * assay): ± a percentage of it, or ± an absolute amount. The deviation is rounded to the decimals of the
 * ± figure as written, half up, before comparing.
 */
export interface Around {
  readonly centre: Q | ResultValue;
  /** What the centre is, for the worked line, e.g. "target weight from the blend assay". */
  readonly name?: string;
  readonly plusMinusPercent?: string;
  /** Absolute ± in the centre's unit, e.g. "15.0 mg". */
  readonly plusMinus?: Q;
}

export type C1Input = { readonly value: Q | ResultValue; readonly limit: Limit } | { readonly value: Q | ResultValue; readonly around: Around };

/** C1 Within limits: the value against low–high (or one side), with pharmacopoeia rounding and alert/action tiers; or ± around a computed value. */
export function c1WithinLimits(i: C1Input): Outcome<{ readonly deviation?: Dec }> {
  return run(() => {
    const p = parseAny(i.value, 'The value');
    if ('limit' in i) {
      const check = checkLimit(p.v, p.unit, i.limit);
      return { ok: true, value: p.v, unit: p.unit.symbol, check, shown: check.shown };
    }
    const a = i.around;
    const c = parseAny(a.centre, 'The centre value');
    sameKind([p, c], 'Within limits');
    if ((a.plusMinusPercent === undefined) === (a.plusMinus === undefined)) refuse('Give the band either as ± % or as ± an amount (one of them)');
    const dev = to(p, c.unit).minus(c.v);
    const what = a.name ?? 'the value computed earlier';
    let pass: boolean;
    let line: string;
    let deviation: Dec;
    if (a.plusMinusPercent !== undefined) {
      const pct = parse(a.plusMinusPercent, 'The ± %').v;
      if (pct.isNegative()) refuse('The ± % must be positive');
      if (c.v.isZero()) refuse('A ± % band needs a centre other than zero');
      deviation = dev.div(c.v.abs()).times(HUNDRED);
      const dp = writtenDecimals(a.plusMinusPercent);
      const r = roundHalfUp(deviation, dp);
      pass = r.abs().lte(pct);
      line = `${p.text} is ${r.isZero() ? '' : r.isNegative() ? '-' : '+'}${r.abs().toFixed(dp)} % from ${c.text} (${what}); limit ± ${a.plusMinusPercent} %`;
    } else {
      const pm = parse(a.plusMinus as Q, 'The ± amount');
      sameKind([pm, c], 'The ± amount');
      if (pm.v.isNegative()) refuse('The ± amount must be positive');
      const dp = decimalsOf(typeof a.plusMinus === 'string' ? (a.plusMinus.trim().split(/\s+/)[0] ?? '') : (a.plusMinus as { value: string }).value);
      deviation = to({ v: dev, unit: c.unit, text: '' }, pm.unit);
      const r = roundHalfUp(deviation, dp);
      pass = r.abs().lte(pm.v);
      line = `${p.text} is ${r.isZero() ? '' : r.isNegative() ? '-' : '+'}${r.abs().toFixed(dp)} ${pm.unit.symbol} from ${c.text} (${what}); limit ± ${pm.text}`;
    }
    const shown = `${line}: ${pass ? 'within limits' : 'OUT OF LIMITS'}`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: fmt(deviation, 3), shown };
    return { ok: true, value: p.v, unit: p.unit.symbol, deviation, check, shown };
  });
}

// ---------------------------------------------------------------- No further change (for F2 repeat-until rounds)
export type ChangeLimit = { readonly maxChange: Q } | { readonly maxChangePercent: string };

/**
 * "Constant weight / no further change": the reading of this round against the previous round's reading.
 * The change |current − previous| (absolute, or in % of the previous value) is rounded to the decimals of the
 * limit as written, half up, and passes if it is not more than the limit. The round loop itself is the engine's (F2).
 */
export function noFurtherChange(previous: Q | ResultValue, current: Q | ResultValue, limit: ChangeLimit): Outcome<{ readonly change: Dec }> {
  return run(() => {
    const a = parseAny(previous, 'The previous reading');
    const b = parseAny(current, 'The current reading');
    sameKind([a, b], 'No further change');
    const diff = to(b, a.unit).minus(a.v);
    let pass: boolean;
    let change: Dec;
    let line: string;
    if ('maxChangePercent' in limit) {
      const max = parse(limit.maxChangePercent, 'The largest change in %').v;
      if (a.v.isZero()) refuse('A change in % needs a previous reading other than zero');
      change = diff.div(a.v.abs()).times(HUNDRED);
      const dp = writtenDecimals(limit.maxChangePercent);
      const r = roundHalfUp(change.abs(), dp);
      pass = r.lte(max);
      line = `${b.text} − ${a.text} = ${fmt(change, dp + 2)} % of the previous reading; |change| ${r.toFixed(dp)} %, limit ${limit.maxChangePercent} %`;
    } else {
      const max = parse(limit.maxChange, 'The largest change');
      sameKind([max, a], 'The largest change');
      const dp = decimalsOf(typeof limit.maxChange === 'string' ? (limit.maxChange.trim().split(/\s+/)[0] ?? '') : limit.maxChange.value);
      change = to({ v: diff, unit: a.unit.kind === 'temperature' ? differenceUnitOf(a.unit) : a.unit, text: '' }, a.unit.kind === 'temperature' ? differenceUnitOf(max.unit) : max.unit);
      const r = roundHalfUp(change.abs(), dp);
      pass = r.lte(max.v);
      line = `${b.text} − ${a.text}: |change| ${r.toFixed(dp)} ${max.unit.symbol}, limit ${max.text}`;
    }
    const shown = `${line}: ${pass ? 'no further change (stop repeating)' : 'still changing (repeat)'}`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: fmt(change, 4), shown };
    return { ok: true, value: b.v, unit: b.unit.symbol, change, check, shown };
  });
}

// ---------------------------------------------------------------- C2 Count of readings
export interface C2Input {
  /** The readings recorded (only their number matters), or the count itself: as text, or as a counted value (e.g. "4 units"). */
  readonly readings: readonly unknown[] | string | { readonly value: string; readonly unit?: string };
  readonly required: string;
  /** exactly (default) or at least. */
  readonly mode?: 'exactly' | 'at least';
}

/** C2 Count of readings: the number of readings is what the step asks (e.g. 20 tablets). */
export function c2Count(i: C2Input): Outcome {
  return run(() => {
    const n = typeof i.readings === 'string' ? parse(i.readings, 'The count').v
      : Array.isArray(i.readings) ? new Dec(i.readings.length) : parse((i.readings as { value: string }).value, 'The count').v;
    const req = parse(i.required, 'The required count').v;
    if (!n.isInteger() || !req.isInteger() || req.isNegative()) refuse('Counts must be whole numbers');
    const mode = i.mode ?? 'exactly';
    const pass = mode === 'exactly' ? n.eq(req) : n.gte(req);
    const shown = `${n.toString()} readings recorded; ${mode} ${req.toString()} required: ${pass ? 'right number' : 'WRONG NUMBER'}`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: n.toString(), shown };
    return { ok: true, value: n, unit: 'units', check, shown };
  });
}

// ---------------------------------------------------------------- C3 All individual values
/** A band for each unit: absolute limits, or ± % of the series mean / of a target. */
export type Band = { readonly limit: Limit } | { readonly plusMinusPercent: string; readonly of: 'mean' | { readonly target: Q } };

export type C3Input = (Series | Pairs | Groups) & {
  readonly band: Band;
  /** How many units may be outside `band` (default 0). */
  readonly allowedOutside?: number;
  /** Optional outer band that no unit may be outside (e.g. ± 10 % when ± 5 % allows 2 outside). */
  readonly outer?: Band;
  /** What a unit is, in the worked line: "tablets", "locations" (default "units"). */
  readonly noun?: string;
  /** The limit of the mean, when the step has one: a ± % of the mean is shown to its decimals (else 1 decimal). */
  readonly meanLimit?: Limit;
};

export interface UnitResult {
  readonly index: number;
  readonly text: string;
  readonly inBand: boolean;
  readonly inOuter: boolean;
  /** Deviation from the reference in % (relative bands only). */
  readonly deviation?: Dec;
}

function makeTester(band: Band, s: Stats, meanDp: number): { test: (p: Parsed) => { ok: boolean; dev?: Dec }; text: string } {
  if ('limit' in band) {
    const l = band.limit;
    return { test: (p) => ({ ok: checkLimit(p.v, p.unit, l).pass }), text: describeLimit(l) };
  }
  const pct = parse(band.plusMinusPercent, 'The ± % band').v;
  if (pct.isNegative()) refuse('The ± % band must be positive');
  const dp = writtenDecimals(band.plusMinusPercent);
  let ref: Dec;
  let refText: string;
  if (band.of === 'mean') {
    ref = s.mean;
    refText = `the mean ${show(s.mean, s.unit.symbol, meanDp)}`;
  } else {
    const t = parse(band.of.target, 'The target');
    ref = to(t, s.unit);
    refText = `the target ${t.text}`;
  }
  if (ref.isZero()) refuse('A ± % band needs a reference other than zero');
  return {
    test: (p) => {
      const dev = to(p, s.unit).minus(ref).div(ref.abs()).times(HUNDRED);
      return { ok: roundHalfUp(dev.abs(), dp).lte(pct), dev };
    },
    text: `± ${band.plusMinusPercent} % of ${refText}`,
  };
}

function describeLimit(l: Limit): string {
  if (l.low !== undefined && l.high !== undefined) return `${l.low} to ${l.high} ${l.unit}`;
  if (l.low !== undefined) return `not less than ${l.low} ${l.unit}`;
  return `not more than ${l.high ?? ''} ${l.unit}`;
}

/** C3 All individual values: each reading inside its band, with how many may be outside, and none outside the outer band. */
export function c3AllIndividual(i: C3Input): Outcome<{ readonly units: readonly UnitResult[] }> {
  return run(() => {
    const ps = readSeries(i);
    if (ps.length === 0) refuse('There are no readings');
    const s = stats(ps);
    const allowed = i.allowedOutside ?? 0;
    if (!Number.isInteger(allowed) || allowed < 0) refuse('The number allowed outside must be a whole number, 0 or more');
    const ml = i.meanLimit;
    const meanDp = ml === undefined ? 1 : Math.max(...[ml.low, ml.high].filter((x): x is string => typeof x === 'string').map(writtenDecimals), 0);
    const inner = makeTester(i.band, s, meanDp);
    const outer = i.outer === undefined ? undefined : makeTester(i.outer, s, meanDp);
    const noun = i.noun ?? 'units';
    const one = noun.replace(/s$/, '');
    const units: UnitResult[] = ps.map((p, n) => {
      const a = inner.test(p);
      const b = outer === undefined ? { ok: true } : outer.test(p);
      return { index: n + 1, text: p.text, inBand: a.ok, inOuter: b.ok, ...(a.dev === undefined ? {} : { deviation: a.dev }) };
    });
    const outside = units.filter((u) => !u.inBand).length;
    const outsideOuter = units.filter((u) => !u.inOuter).length;
    const pass = outside <= allowed && outsideOuter === 0;
    const shown =
      `${units.length} ${noun}; ${outside} outside ${inner.text} (${allowed} allowed)` +
      (outer === undefined ? '' : `; ${outsideOuter} outside ${outer.text} (none allowed)`) +
      `: ${pass ? 'pass' : 'FAIL'}` +
      (outside > 0 ? ` (outside: ${one} ${units.filter((u) => !u.inBand).map((u) => u.index).join(', ')})` : '');
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: String(outside), shown };
    return { ok: true, value: new Dec(outside), unit: 'units', units, check, shown };
  });
}

// ---------------------------------------------------------------- C4 Observation
export interface C4Input {
  readonly question: string;
  /** One answer per unit, or one for the step. */
  readonly answers: readonly string[];
  /** The answer(s) that pass, e.g. ["yes"]. */
  readonly expected: readonly string[];
  /** The fixed list the answers must come from (default: yes / no). */
  readonly options?: readonly string[];
  /** How many answers may be other than expected (default 0). */
  readonly allowedFailures?: number;
}

/** C4 Observation: yes/no (or from a fixed list) per unit or per step; a failure can trigger F3. */
export function c4Observation(i: C4Input): Outcome<{ readonly triggersF3: boolean }> {
  return run(() => {
    const options = (i.options ?? ['yes', 'no']).map((o) => o.trim().toLowerCase());
    if (i.answers.length === 0) refuse(`No answer was recorded for "${i.question}"`);
    for (const e of i.expected) if (!options.includes(e.trim().toLowerCase())) refuse(`The expected answer "${e}" is not in the list (${options.join(', ')})`);
    const answers = i.answers.map((a) => a.trim().toLowerCase());
    for (const a of answers) if (!options.includes(a)) refuse(`The answer "${a}" is not in the list (${options.join(', ')})`);
    const expected = i.expected.map((e) => e.trim().toLowerCase());
    const failures = answers.filter((a) => !expected.includes(a)).length;
    const allowed = i.allowedFailures ?? 0;
    const pass = failures <= allowed;
    const shown = `${i.question}: ${answers.length === 1 ? answers[0] : `${answers.length - failures} of ${answers.length} as expected (${expected.join(' / ')})`}: ${pass ? 'pass' : 'FAIL'}`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: String(failures), shown };
    const done: Done & { triggersF3: boolean } = { ok: true, value: new Dec(failures), unit: 'units', check, shown, triggersF3: !pass };
    return done;
  });
}

