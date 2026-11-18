/**
 * C6 Staged test: a pharmacopoeia test in stages over two or more sets of results.
 * Rules are paraphrased from the chapters named; no chapter text is copied.
 *
 * - Disintegration (USP <701>, Ph. Eur. 2.9.1): 6 units must all disintegrate within the time. If 1 or 2
 *   fail, 12 more are tested and at least 16 of the 18 must pass. More than 2 failures in the first 6: fail.
 * - Content uniformity (USP <905>, Ph. Eur. 2.9.40): 10 units, then 20 more (see T14).
 * - Dissolution, immediate release (USP <711>, acceptance table 1), Q in % of label claim:
 *   S1 (6): each unit ≥ Q + 5. S2 (6 more, 12): mean ≥ Q and no unit < Q − 15.
 *   S3 (12 more, 24): mean ≥ Q, not more than 2 units < Q − 15, and no unit < Q − 25.
 * - Dissolution, extended release (USP <711>, acceptance table 2), each time point with its range
 *   (the last usually "not less than" only):
 *   L1 (6): every unit inside every range.
 *   L2 (12): the mean inside every range; no unit more than 10 % (of label claim) outside any range.
 *   L3 (24): the mean inside every range; not more than 2 units more than 10 % outside any range;
 *   no unit more than 20 % outside any range.
 * - Delayed release, acid stage (USP <711>, acceptance table 3): A1 (6): no unit above 10 % dissolved.
 *   A2 (12): mean ≤ 10 % and no unit above 25 %. A3 (24): mean ≤ 10 % and no unit above 25 %.
 * - Delayed release, buffer stage (acceptance table 4): as the immediate-release S1–S3 rule (B1–B3).
 * Each value (and mean) is rounded to the decimals of Q or of the limit as written before comparing.
 */
import { Dec, fmt, parse, refuse, run, ZERO, type Outcome } from './core.js';
import { roundHalfUp, writtenDecimals, type Check } from './rounding.js';
import { t14ContentUniformity, type Coating } from './uniformity.js';

/** A unit's result: a plain value ("4.5", "> 15"), or a reading with its unit as a block records it. */
type Item = string | { readonly value: string; readonly unit: string };
type Stages<X> =
  /** `noun`: what a unit is, in the worked line ("tablets"; default "units"). */
  | { readonly test: 'disintegration'; readonly maxTime: string; readonly noun?: string; readonly stages: readonly (readonly X[])[] }
  | { readonly test: 'content uniformity'; readonly coating: Coating; readonly target?: string; readonly stages: readonly (readonly X[])[] }
  | { readonly test: 'dissolution IR' | 'dissolution DR buffer'; readonly Q: string; readonly stages: readonly (readonly X[])[] }
  | { readonly test: 'dissolution DR acid'; readonly max?: string; readonly stages: readonly (readonly X[])[] }
  | {
      readonly test: 'dissolution ER';
      readonly ranges: readonly { readonly time: string; readonly low?: string; readonly high?: string }[];
      /** One array per stage; each unit is one array of values, one per time point. */
      readonly stages: readonly (readonly (readonly string[])[])[];
    };
export type C6Input = Stages<Item>;

export type Decision = 'pass' | 'next stage' | 'fail';

export interface C6Extra {
  readonly decision: Decision;
  readonly stageReached: number;
  /** Units needed at the next stage, when the decision is 'next stage'. */
  readonly nextStageUnits?: number;
}

const nums = (xs: readonly string[], what: string): Dec[] => xs.map((x, n) => parse(x, `${what} ${n + 1}`).v);
const mean = (xs: readonly Dec[]): Dec => xs.reduce((s, x) => s.plus(x), ZERO).div(xs.length);

function needCount(stages: readonly unknown[][] | readonly (readonly unknown[])[], sizes: readonly number[]): void {
  stages.forEach((s, n) => {
    if (s.length !== sizes[n]) refuse(`Stage ${n + 1} needs ${sizes[n] ?? 0} units; ${s.length} were given`);
  });
  if (stages.length === 0) refuse('Give the results of the first stage');
  if (stages.length > sizes.length) refuse(`This test has only ${sizes.length} stages`);
}

function finish(decision: Decision, stage: number, line: string, next?: number): Outcome<C6Extra> {
  return run(() => {
    const check: Check = { pass: decision === 'pass', level: decision === 'pass' ? 'pass' : 'fail', rounded: decision, shown: line };
    return { ok: true, value: new Dec(stage), unit: '', decision, stageReached: stage, ...(next === undefined ? {} : { nextStageUnits: next }), shown: line, check };
  });
}

/** The S1-S3 / B1-B3 rule on cumulative results (rounded to Q's decimals). */
function qRule(Qtext: string, stages: readonly (readonly string[])[], label: string): Outcome<C6Extra> {
  const Q = parse(Qtext, 'Q').v;
  const dp = writtenDecimals(Qtext);
  const r = (x: Dec): Dec => roundHalfUp(x, dp);
  needCount(stages, [6, 6, 12]);
  const all: Dec[] = [];
  for (let st = 0; st < stages.length; st += 1) {
    all.push(...nums(stages[st] ?? [], 'Unit'));
    const m = r(mean(all));
    const S = `${label}${st + 1}`;
    if (st === 0) {
      const ok = all.every((x) => r(x).gte(Q.plus(5)));
      if (ok) return finish('pass', 1, `${S}: all 6 units ≥ Q + 5 = ${fmt(Q.plus(5), dp)} %: PASS`);
      if (stages.length === 1) return finish('next stage', 1, `${S}: not every unit ≥ Q + 5 = ${fmt(Q.plus(5), dp)} %: test 6 more units`, 6);
    } else if (st === 1) {
      const ok = m.gte(Q) && all.every((x) => r(x).gte(Q.minus(15)));
      if (ok) return finish('pass', 2, `${S}: mean of 12 = ${fmt(m, dp)} % ≥ Q = ${Qtext} % and no unit below Q − 15: PASS`);
      if (stages.length === 2) return finish('next stage', 2, `${S}: mean of 12 = ${fmt(m, dp)} %, or a unit below Q − 15: test 12 more units`, 12);
    } else {
      const below15 = all.filter((x) => r(x).lt(Q.minus(15))).length;
      const below25 = all.filter((x) => r(x).lt(Q.minus(25))).length;
      const ok = m.gte(Q) && below15 <= 2 && below25 === 0;
      return finish(ok ? 'pass' : 'fail', 3, `${S}: mean of 24 = ${fmt(m, dp)} % (Q = ${Qtext}); ${below15} units below Q − 15 (2 allowed), ${below25} below Q − 25 (none allowed): ${ok ? 'PASS' : 'FAIL'}`);
    }
  }
  return refuse('No stage was evaluated');
}

/** C6 Staged test. */
export function c6StagedTest(input: C6Input): Outcome<C6Extra> {
  // A reading with its unit counts as its value: the units of the times and contents are the test's own (min, %).
  const i = (input.test === 'dissolution ER' ? input
    : { ...input, stages: input.stages.map((s) => s.map((x) => (typeof x === 'string' ? x : x.value))) }) as Stages<string>;
  const body = (): Outcome<C6Extra> => {
    switch (i.test) {
      case 'disintegration': {
        needCount(i.stages, [6, 12]);
        const max = parse(i.maxTime, 'The time limit').v;
        const dp = writtenDecimals(i.maxTime);
        const fails = (xs: readonly string[]): number =>
          xs.filter((x, n) => {
            const t = x.trim();
            if (t.startsWith('>')) return true; // not disintegrated within the time
            return roundHalfUp(parse(t, `Unit ${n + 1} time`).v, dp).gt(max);
          }).length;
        const f1 = fails(i.stages[0] ?? []);
        const u = i.noun ?? 'units';
        if (f1 === 0) return finish('pass', 1, `All 6 ${u} disintegrated within ${i.maxTime} min: PASS`);
        if (f1 > 2) return finish('fail', 1, `${f1} of 6 ${u} did not disintegrate within ${i.maxTime} min: FAIL`);
        if (i.stages.length === 1) return finish('next stage', 1, `${f1} of 6 ${u} failed: test 12 more ${u}`, 12);
        const f2 = fails(i.stages[1] ?? []);
        const passed = 18 - f1 - f2;
        return finish(passed >= 16 ? 'pass' : 'fail', 2, `${passed} of 18 ${u} disintegrated within ${i.maxTime} min (at least 16 needed): ${passed >= 16 ? 'PASS' : 'FAIL'}`);
      }
      case 'content uniformity': {
        needCount(i.stages, [10, 20]);
        const first = i.stages[0] ?? [];
        const t1 = t14ContentUniformity({ method: 'content uniformity', coating: i.coating, ...(i.target === undefined ? {} : { target: i.target }), results: { values: first, unit: '%' } });
        if (!t1.ok) return t1;
        if (t1.decision === 'pass') return finish('pass', 1, `L1: ${t1.shown}`);
        if (i.stages.length === 1) return finish('next stage', 1, `L1: ${t1.shown}`, 20);
        const t2 = t14ContentUniformity({ method: 'content uniformity', coating: i.coating, ...(i.target === undefined ? {} : { target: i.target }), results: { values: [...first, ...(i.stages[1] ?? [])], unit: '%' } });
        if (!t2.ok) return t2;
        return finish(t2.decision === 'pass' ? 'pass' : 'fail', 2, `L2: ${t2.shown}`);
      }
      case 'dissolution IR':
        return qRule(i.Q, i.stages, 'S');
      case 'dissolution DR buffer':
        return qRule(i.Q, i.stages, 'B');
      case 'dissolution DR acid': {
        needCount(i.stages, [6, 6, 12]);
        const maxT = i.max ?? '10';
        const lim = parse(maxT, 'The acid-stage limit').v;
        const dp = writtenDecimals(maxT);
        const r = (x: Dec): Dec => roundHalfUp(x, dp);
        const all: Dec[] = [];
        for (let st = 0; st < i.stages.length; st += 1) {
          all.push(...nums(i.stages[st] ?? [], 'Unit'));
          const m = r(mean(all));
          if (st === 0) {
            if (all.every((x) => r(x).lte(lim))) return finish('pass', 1, `A1: no unit above ${maxT} % dissolved in acid: PASS`);
            if (i.stages.length === 1) return finish('next stage', 1, `A1: a unit above ${maxT} %: test 6 more units`, 6);
          } else {
            const n = all.length;
            const over25 = all.filter((x) => r(x).gt(25)).length;
            const ok = m.lte(lim) && over25 === 0;
            if (ok) return finish('pass', st + 1, `A${st + 1}: mean of ${n} = ${fmt(m, dp)} % ≤ ${maxT} % and no unit above 25 %: PASS`);
            if (st === 1 && i.stages.length === 2) return finish('next stage', 2, `A2: mean of 12 = ${fmt(m, dp)} % or a unit above 25 %: test 12 more units`, 12);
            if (st === 2) return finish('fail', 3, `A3: mean of 24 = ${fmt(m, dp)} %, ${over25} units above 25 %: FAIL`);
          }
        }
        return refuse('No stage was evaluated');
      }
      case 'dissolution ER': {
        if (i.ranges.length === 0) refuse('Give the time points and their ranges');
        needCount(i.stages as readonly (readonly unknown[])[], [6, 6, 12]);
        const ranges = i.ranges.map((g) => {
          const lo = g.low === undefined ? undefined : parse(g.low, `Low limit at ${g.time}`).v;
          const hi = g.high === undefined ? undefined : parse(g.high, `High limit at ${g.time}`).v;
          if (lo === undefined && hi === undefined) refuse(`Give a range at ${g.time}`);
          return { ...g, lo, hi, dp: Math.max(g.low === undefined ? 0 : writtenDecimals(g.low), g.high === undefined ? 0 : writtenDecimals(g.high)) };
        });
        /** How far outside the range (0 if inside), after rounding. */
        const outBy = (x: Dec, g: (typeof ranges)[number]): Dec => {
          const v = roundHalfUp(x, g.dp);
          if (g.lo !== undefined && v.lt(g.lo)) return g.lo.minus(v);
          if (g.hi !== undefined && v.gt(g.hi)) return v.minus(g.hi);
          return ZERO;
        };
        const units: Dec[][] = [];
        for (let st = 0; st < i.stages.length; st += 1) {
          for (const [n, u] of (i.stages[st] ?? []).entries()) {
            if (u.length !== ranges.length) refuse(`Stage ${st + 1} unit ${n + 1} needs ${ranges.length} results (one per time point)`);
            units.push(nums(u, `Stage ${st + 1} unit ${n + 1} result`));
          }
          const means = ranges.map((_, t) => mean(units.map((u) => u[t] ?? ZERO)));
          const meanOk = ranges.every((g, t) => outBy(means[t] ?? ZERO, g).isZero());
          const countOut = (limit: number): number => units.filter((u) => ranges.some((g, t) => outBy(u[t] ?? ZERO, g).gt(limit))).length;
          if (st === 0) {
            if (countOut(0) === 0) return finish('pass', 1, 'L1: every unit inside every range: PASS');
            if (i.stages.length === 1) return finish('next stage', 1, `L1: ${countOut(0)} units outside a range: test 6 more units`, 6);
          } else if (st === 1) {
            if (meanOk && countOut(10) === 0) return finish('pass', 2, 'L2: mean of 12 inside every range and no unit more than 10 % outside: PASS');
            if (i.stages.length === 2) return finish('next stage', 2, 'L2: not met: test 12 more units', 12);
          } else {
            const ok = meanOk && countOut(10) <= 2 && countOut(20) === 0;
            return finish(ok ? 'pass' : 'fail', 3, `L3: mean of 24 ${meanOk ? 'inside' : 'OUTSIDE'} every range; ${countOut(10)} units more than 10 % outside (2 allowed), ${countOut(20)} more than 20 % outside (none allowed): ${ok ? 'PASS' : 'FAIL'}`);
          }
        }
        return refuse('No stage was evaluated');
      }
      default:
        return refuse('Unknown staged test');
    }
  };
  const out = run(() => {
    const r = body();
    if (!r.ok) refuse(r.message);
    return r;
  });
  return out;
}

