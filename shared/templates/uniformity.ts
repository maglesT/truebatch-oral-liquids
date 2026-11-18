/**
 * T14 Content uniformity acceptance value (USP <905> / Ph. Eur. 2.9.40, uniformity of dosage units).
 * The method is written from the chapters' published rules, paraphrased; no chapter text is copied.
 *
 * Acceptance value AV = |M − X̄| + k·s, with X̄ the mean and s the sample SD of the individual contents
 * (in % of label claim), k = 2.4 for 10 units and 2.0 for 30 units. The reference value M depends on T,
 * the target content per unit at manufacture (100.0 unless the master justifies another):
 *   T ≤ 101.5:  M = 98.5 if X̄ < 98.5;  M = X̄ if 98.5 ≤ X̄ ≤ 101.5;  M = 101.5 if X̄ > 101.5.
 *   T > 101.5:  M = 98.5 if X̄ < 98.5;  M = X̄ if 98.5 ≤ X̄ ≤ T;      M = T if X̄ > T.
 * Stage 1 (10 units): pass if AV ≤ L1 (15.0). Otherwise test 20 more.
 * Stage 2 (all 30 units): pass if AV ≤ L1 and no unit is below (1 − 0.01·L2)·M or above (1 + 0.01·L2)·M, L2 = 25.0.
 *
 * Weight-variation option: each unit's content is estimated as its weight × the assay ÷ the mean weight.
 * Allowed only for uncoated and film-coated tablets with at least 25 mg of the drug making up at least 25 %
 * of the unit weight. Refused for sugar-coated and other coated tablets (a safety rule), and when the master
 * sets "individual results only" (drug in the coat, pellet tablets).
 *
 * Large-sample option (Ph. Eur. 2.9.47, many units, e.g. real-time release): the same AV with the k for that
 * sample size and the number of units allowed outside the 0.75M–1.25M band both taken from the chapter's
 * table by the master; this library does not hold that table.
 */
import { Dec, fmt, HUNDRED, needKind, parse, percent, refuse, run, show, to, unitOf, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check } from './rounding.js';
import { readSeries, stats, type Series } from './series.js';

export type Coating = 'uncoated' | 'film-coated' | 'sugar-coated' | 'other coated';

export type T14Input = {
  readonly coating: Coating;
  /** Target content per unit T in % of label claim (default "100.0"). */
  readonly target?: string;
  readonly L1?: string;
  readonly L2?: string;
  /** Drug in the coat, pellet tablets: only measured individual contents may be used. */
  readonly individualResultsOnly?: boolean;
} & (
  | { readonly method: 'content uniformity'; readonly results: Series }
  | { readonly method: 'weight variation'; readonly weights: Series; readonly assay: Q; readonly labelClaim: Q }
  | { readonly method: 'large sample'; readonly results: Series; readonly k: string; readonly allowedOutsideL2: number }
);

export interface T14Extra {
  readonly n: number;
  readonly mean: Dec;
  readonly sd: Dec;
  readonly M: Dec;
  readonly k: Dec;
  /** pass; 'test 20 more' after a failed first stage of 10; fail. */
  readonly decision: 'pass' | 'test 20 more' | 'fail';
  readonly contents: readonly Dec[];
  readonly outsideL2: number;
}

/** The reference value M (see the file comment). */
export function referenceValue(mean: Dec, T: Dec): Dec {
  const lo = new Dec('98.5');
  const hi = new Dec('101.5');
  if (mean.lt(lo)) return lo;
  if (T.lte(hi)) return mean.gt(hi) ? hi : mean;
  return mean.gt(T) ? T : mean;
}

function contentsFrom(ps: readonly Parsed[]): Dec[] {
  return ps.map((p) => {
    if (p.unit.kind === 'number') return p.v;
    needKind(p, ['fraction'], 'Each individual content (in % of label claim)');
    return to(p, '%');
  });
}

/** T14 Content uniformity acceptance value. */
export function t14ContentUniformity(i: T14Input): Outcome<T14Extra> {
  return run(() => {
    const T = parse(i.target ?? '100.0', 'The target content T').v;
    const L1text = i.L1 ?? '15.0';
    const L2 = parse(i.L2 ?? '25.0', 'L2').v;
    let contents: Dec[];
    let how: string;
    if (i.method === 'weight variation') {
      if (i.individualResultsOnly === true) refuse('This product is set to "individual results only" (drug in the coat or pellets): the weight-variation method cannot be used; test content uniformity on individual units');
      if (i.coating === 'sugar-coated' || i.coating === 'other coated') {
        refuse(`The weight-variation method is not allowed for ${i.coating} tablets: only uncoated and film-coated tablets may use it. Test content uniformity on individual units`);
      }
      const ws = readSeries(i.weights, 'Weight');
      for (const w of ws) needKind(w, ['mass'], 'Each unit weight');
      const s = stats(ws);
      const assay = percent(i.assay, 'The assay');
      const claim = parse(i.labelClaim, 'The label claim');
      needKind(claim, ['mass'], 'The label claim');
      const claimMg = to(claim, 'mg');
      const meanMg = to({ v: s.mean, unit: s.unit, text: '' }, 'mg');
      if (claimMg.lt(25) || claimMg.div(meanMg).times(HUNDRED).lt(25)) {
        refuse(`The weight-variation method needs at least 25 mg of drug making up at least 25 % of the unit weight; here ${claim.text} in ${fmt(meanMg, 1)} mg (${fmt(claimMg.div(meanMg).times(HUNDRED), 1)} %). Test content uniformity on individual units`);
      }
      contents = ws.map((w) => to(w, s.unit).times(assay.v).div(s.mean));
      how = `contents estimated as weight × ${assay.text} ÷ mean weight ${show(s.mean, s.unit.symbol, 2)}; `;
    } else {
      contents = contentsFrom(readSeries(i.results, 'Result'));
      how = '';
    }
    const n = contents.length;
    let k: Dec;
    if (i.method === 'large sample') {
      if (n <= 30) refuse('The large-sample option is for more than 30 units; use 10 or 30 units otherwise');
      k = parse(i.k, 'k for this sample size').v;
      if (!k.isPositive()) refuse('k must be more than zero');
    } else {
      if (n !== 10 && n !== 30) refuse(`Content uniformity uses 10 units (first stage) or 30 units (both stages); ${n} were given`);
      k = new Dec(n === 10 ? '2.4' : '2.0');
    }
    const s = stats(contents.map((v) => ({ v, unit: unitOf('%'), text: '' })));
    const sd = s.sd ?? new Dec(0);
    const M = referenceValue(s.mean, T);
    const AV = M.minus(s.mean).abs().plus(k.times(sd));
    const avCheck: Check = checkLimit(AV, '', { high: L1text, unit: '' });
    const lowB = M.times(HUNDRED.minus(L2)).div(HUNDRED);
    const highB = M.times(HUNDRED.plus(L2)).div(HUNDRED);
    const outsideL2 = contents.filter((c) => c.lt(lowB) || c.gt(highB)).length;
    let decision: T14Extra['decision'];
    if (i.method === 'large sample') decision = avCheck.pass && outsideL2 <= i.allowedOutsideL2 ? 'pass' : 'fail';
    else if (n === 10) decision = avCheck.pass ? 'pass' : 'test 20 more';
    else decision = avCheck.pass && outsideL2 === 0 ? 'pass' : 'fail';
    const shown =
      `${how}n = ${n}, mean X̄ = ${fmt(s.mean, 2)} %, s = ${fmt(sd, 3)}, M = ${fmt(M, 2)} % (T = ${T.toString()}); ` +
      `AV = |${fmt(M, 2)} − ${fmt(s.mean, 2)}| + ${k.toString()} × ${fmt(sd, 3)} = ${fmt(AV, 1)}; L1 = ${L1text}` +
      (n === 10 && i.method !== 'large sample' ? '' : `; units outside ${fmt(lowB, 1)}-${fmt(highB, 1)} %: ${outsideL2}`) +
      `: ${decision === 'pass' ? 'PASS' : decision === 'fail' ? 'FAIL' : 'not passed at stage 1, test 20 more units'}`;
    const check: Check = { pass: decision === 'pass', level: decision === 'pass' ? 'pass' : 'fail', rounded: fmt(AV, 1), shown };
    return { ok: true, value: AV, unit: '', n, mean: s.mean, sd, M, k, decision, contents, outsideL2, shown, check };
  });
}

// ---------------------------------------------------------------- T14 stratified (Bergum, ASTM E2709) (F0229)
export interface T14StratifiedInput {
  /** All individual contents in % of label claim, e.g. 3 tablets at each of 20 times (60 results). */
  readonly results: Series;
  readonly locations: number;
  readonly perLocation: number;
  /**
   * The acceptance table the master takes from Bergum's method (ASTM E2709) for this sample size, confidence and
   * coverage: the largest RSD allowed at each sample mean. The library does not compute it (as for the large sample).
   */
  readonly bergum: { readonly n: number; readonly rows: readonly { readonly mean: string; readonly maxRsd: string }[] };
}

/** Stratified content uniformity: the RSD of all results against the RSD the Bergum table allows at their mean. */
export function t14Stratified(i: T14StratifiedInput): Outcome<{ readonly mean: Dec; readonly allowedRsd?: Dec }> {
  return run(() => {
    const ps = readSeries(i.results, 'Result');
    const n = ps.length;
    if (n !== i.locations * i.perLocation) refuse(`${i.locations} locations × ${i.perLocation} units is ${i.locations * i.perLocation} results; ${n} were given`);
    if (n !== i.bergum.n) refuse(`The Bergum table is for ${i.bergum.n} results, not ${n}: use the table for this sample size`);
    const rows = i.bergum.rows.map((r) => ({ m: new Dec(r.mean), r: new Dec(r.maxRsd), dp: r.maxRsd.split('.')[1]?.length ?? 0 }));
    if (rows.length < 2 || rows.some((r, k) => k > 0 && !r.m.gt(rows[k - 1]!.m))) refuse('The Bergum table needs at least two rows with the mean rising');
    const s = stats(contentsFrom(ps).map((v) => ({ v, unit: unitOf('%'), text: '' })));
    const rsd = (s.sd ?? new Dec(0)).div(s.mean).times(HUNDRED);
    const k = rows.findIndex((r) => r.m.gte(s.mean));
    let allowed: Dec | undefined;
    if (k === 0 && rows[0]!.m.eq(s.mean)) allowed = rows[0]!.r;
    else if (k > 0) {
      const lo = rows[k - 1]!;
      const hi = rows[k]!;
      allowed = lo.r.plus(s.mean.minus(lo.m).div(hi.m.minus(lo.m)).times(hi.r.minus(lo.r)));
    }
    const dp = rows[0]!.dp;
    const pass = allowed !== undefined && rsd.toDecimalPlaces(dp, Dec.ROUND_HALF_UP).lte(allowed.toDecimalPlaces(dp, Dec.ROUND_HALF_UP));
    const shown = `${i.locations} × ${i.perLocation} = ${n} results: mean ${fmt(s.mean, 2)} %, RSD ${fmt(rsd, dp)} %; ` +
      (allowed === undefined ? `the mean is outside the Bergum table (${rows[0]!.m.toString()}–${rows[rows.length - 1]!.m.toString()} %): FAIL`
        : `largest RSD allowed at this mean ${fmt(allowed, dp)} %: ${pass ? 'PASS' : 'FAIL'}`);
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: `${fmt(rsd, dp)} %`, shown };
    return { ok: true, value: rsd, unit: '%', mean: s.mean, ...(allowed ? { allowedRsd: allowed } : {}), shown, check };
  });
}
