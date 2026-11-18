import { describe, expect, it } from 'vitest';
import { referenceValue, t14ContentUniformity } from '../../shared/templates/uniformity.js';
import { Dec } from '../../shared/templates/dec.js';
import { ok, refused } from './helpers.js';

// Every AV below was recomputed by hand in Python decimal: mean, sample SD (n − 1), M, AV = |M − X̄| + k·s.
const ten = (a: string): string[] => [...Array(5).fill(new Dec(100).plus(a).toFixed(2)), ...Array(5).fill(new Dec(100).minus(a).toFixed(2))] as string[];

describe('T14 Content uniformity acceptance value', () => {
  it.each([
    ['normal batch, 10 units', '98.0 99.5 101.2 100.4 97.8 102.1 99.0 100.7 98.9 100.3', '100.0', '99.79', '99.79', '3.3'], // s 1.39240, AV 2.4 × 1.3924 = 3.342
    ['mean below 98.5 → M = 98.5', '96.0 97.5 96.8 97.2 98.0 96.5 97.9 97.1 96.6 96.4', '100.0', '97.00', '98.50', '3.1'], // |98.5 − 97.0| + 2.4 × 0.65997 = 3.084
    ['mean above 101.5, T = 100 → M = 101.5', '102.0 103.1 101.9 102.6 102.4 103.0 101.8 102.2 102.7 102.3', '100.0', '102.40', '101.50', '2.0'], // 0.9 + 2.4 × 0.44721 = 1.973
    ['T = 102.0 (> 101.5), mean 102.4 above T → M = T', '102.0 103.1 101.9 102.6 102.4 103.0 101.8 102.2 102.7 102.3', '102.0', '102.40', '102.00', '1.5'], // 0.4 + 1.0733 = 1.473
    ['T = 103.0, mean 102.4 between 98.5 and T → M = mean', '102.0 103.1 101.9 102.6 102.4 103.0 101.8 102.2 102.7 102.3', '103.0', '102.40', '102.40', '1.1'], // 0 + 1.0733
  ])('T14: %s', (_case, values, target, mean, M, av) => {
    const r = ok(t14ContentUniformity({ method: 'content uniformity', coating: 'uncoated', target, results: { values: values.split(' '), unit: '%' } }));
    expect(r.mean.toFixed(2)).toBe(mean);
    expect(r.M.toFixed(2)).toBe(M);
    expect(r.value.toFixed(1)).toBe(av);
    expect(r.decision).toBe('pass');
  });

  it.each([
    ['5.94', '15.0', 'pass'], // s = 5.94 × √(10/9) = 6.26131; AV = 15.0271 → 15.0 ≤ 15.0
    ['5.95', '15.1', 'test 20 more'], // s = 6.27185; AV = 15.0524 → 15.1 > 15.0
  ])('T14: rounding at L1: ± %s around 100 → AV %s → %s', (a, av, decision) => {
    const r = ok(t14ContentUniformity({ method: 'content uniformity', coating: 'film-coated', results: { values: ten(a), unit: '%' } }));
    expect(r.value.toFixed(1)).toBe(av);
    expect(r.decision).toBe(decision);
  });

  it('T14: 30 units: AV 9.5 but one unit at 74.0 % is below 0.75 M = 74.35 % → fail (L2 individual check)', () => {
    // 29 × 100.0 + 74.0: mean 99.1333, s 4.74693, M = mean, AV = 2.0 × 4.74693 = 9.494
    const r = ok(t14ContentUniformity({ method: 'content uniformity', coating: 'uncoated', results: { values: [...Array(29).fill('100.0'), '74.0'] as string[], unit: '%' } }));
    expect(r.value.toFixed(1)).toBe('9.5');
    expect(r.outsideL2).toBe(1);
    expect(r.decision).toBe('fail');
  });

  it('T14: 30 units all inside 0.75M-1.25M and AV 2.2 → pass (k = 2.0)', () => {
    const values = [...Array(14).fill(['99.0', '101.0']).flat(), '98.0', '102.0'] as string[];
    const r = ok(t14ContentUniformity({ method: 'content uniformity', coating: 'uncoated', results: { values, unit: '%' } }));
    expect(r.k.toString()).toBe('2');
    expect(r.value.toFixed(2)).toBe('2.23'); // s = 1.11417, AV 2.22834
    expect(r.decision).toBe('pass');
  });

  it('T14: weight variation: calcium carbonate 1250 mg chewable (formulation 8), assay 99.2 %', () => {
    // mean weight 2500.0 mg; content_i = w_i × 99.2 ÷ 2500; mean 99.2, s 0.74775, M 99.2, AV 1.795
    const r = ok(t14ContentUniformity({ method: 'weight variation', coating: 'uncoated', weights: { values: '2490 2512 2505 2478 2521 2499 2486 2530 2508 2471'.split(' '), unit: 'mg' }, assay: '99.2 %', labelClaim: '1250 mg' }));
    expect(r.contents.map((c) => c.toFixed(3)).slice(0, 3)).toEqual(['98.803', '99.676', '99.398']);
    expect(r.value.toFixed(3)).toBe('1.795');
    expect(r.decision).toBe('pass');
  });

  it('T14: weight variation: rucaparib 300 mg in a 700 mg film-coated tablet (formulation 3), assay 98.6 %', () => {
    // mean weight 700.30 mg; contents mean 98.6, s 0.24701, M 98.6, AV 0.593
    const r = ok(t14ContentUniformity({ method: 'weight variation', coating: 'film-coated', weights: { values: '702.1 698.4 701.0 699.5 703.2 697.8 700.6 699.9 701.8 698.7'.split(' '), unit: 'mg' }, assay: '98.6 %', labelClaim: '300 mg' }));
    expect(r.value.toFixed(3)).toBe('0.593');
  });

  it.each([
    ['sugar-coated', '60 mg', /not allowed for sugar-coated tablets/], // quinolinone sugar-coated (formulation 4, round 2)
    ['other coated', '300 mg', /not allowed for other coated tablets/], // e.g. compression-coated
  ])('T14: weight variation refused for %s tablets', (coating, claim, msg) => {
    expect(refused(t14ContentUniformity({ method: 'weight variation', coating: coating as 'sugar-coated', weights: { values: ['280', '281'], unit: 'mg' }, assay: '99 %', labelClaim: claim }))).toMatch(msg);
  });

  it('T14: weight variation refused below 25 mg / 25 % (levothyroxine 25 µg, formulation 2)', () => {
    expect(refused(t14ContentUniformity({ method: 'weight variation', coating: 'uncoated', weights: { values: Array(10).fill('145.0') as string[], unit: 'mg' }, assay: '99 %', labelClaim: '25 µg' }))).toMatch(/at least 25 mg/);
  });

  it('T14: weight variation refused at 30 mg in a 200 mg tablet (15 %)', () => {
    expect(refused(t14ContentUniformity({ method: 'weight variation', coating: 'uncoated', weights: { values: Array(10).fill('200.0') as string[], unit: 'mg' }, assay: '99 %', labelClaim: '30 mg' }))).toMatch(/15\.0 %/);
  });

  it('T14: weight variation refused for "individual results only" (drug in the coat, formulation 47)', () => {
    expect(refused(t14ContentUniformity({ method: 'weight variation', coating: 'film-coated', individualResultsOnly: true, weights: { values: Array(10).fill('300') as string[], unit: 'mg' }, assay: '99 %', labelClaim: '100 mg' }))).toMatch(/individual results only/);
  });

  it('T14: large-sample option (formulation 50): k and the number allowed outside come from the master', () => {
    // 40 units ± 1.0 around 100: s = √(40 × 1 ÷ 39) = 1.01274; with k = 2.2 (master's figure) AV = 2.228
    const values = Array(20).fill(['99.0', '101.0']).flat() as string[];
    const r = ok(t14ContentUniformity({ method: 'large sample', coating: 'film-coated', results: { values, unit: '%' }, k: '2.2', allowedOutsideL2: 0 }));
    expect(r.value.toFixed(3)).toBe('2.228');
    expect(r.decision).toBe('pass');
  });

  it.each([
    [{ method: 'content uniformity' as const, coating: 'uncoated' as const, results: { values: Array(12).fill('100') as string[], unit: '%' } }, /10 units .* or 30 units/],
    [{ method: 'large sample' as const, coating: 'uncoated' as const, results: { values: Array(30).fill('100') as string[], unit: '%' }, k: '2.0', allowedOutsideL2: 0 }, /more than 30 units/],
    [{ method: 'content uniformity' as const, coating: 'uncoated' as const, results: { values: Array(10).fill('100') as string[], unit: 'mg' } }, /% of label claim/],
  ])('T14: refuses %o', (i, msg) => {
    expect(refused(t14ContentUniformity(i))).toMatch(msg);
  });

  it.each([
    ['97.0', '100.0', '98.5'],
    ['98.5', '100.0', '98.5'],
    ['101.5', '100.0', '101.5'],
    ['101.6', '100.0', '101.5'],
    ['101.6', '102.0', '101.6'],
    ['102.1', '102.0', '102.0'],
  ])('T14: reference value M for mean %s and T %s = %s', (m, t, want) => {
    expect(referenceValue(new Dec(m), new Dec(t)).toFixed(1)).toBe(want);
  });
});
