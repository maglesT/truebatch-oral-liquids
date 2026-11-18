import { describe, expect, it } from 'vitest';
import { c7SamplingPlan, codeLetter, plan } from '../../shared/templates/sampling.js';
import { ok, refused } from './helpers.js';

// Expected values read from MIL-STD-105E Table I and Table II-A (single, normal); cross-checked against the
// independent AQLSchemes (CRAN) tables when the library was written.
describe('C7 Sampling plan: code letters (Table I)', () => {
  it.each([
    [8, 'II', 'A'], [9, 'II', 'B'], [50, 'II', 'D'], [51, 'II', 'E'], [1200, 'II', 'J'], [1201, 'II', 'K'],
    [3200, 'II', 'K'], [3201, 'II', 'L'], [35000, 'II', 'M'], [150000, 'II', 'N'], [300000, 'II', 'P'], [500001, 'II', 'Q'],
    [300000, 'I', 'M'], [300000, 'III', 'Q'], [3000, 'S-4', 'G'], [77375, 'S-3', 'G'], [2000000, 'S-1', 'D'],
  ] as [number, 'II', string][])('C7: lot %i, level %s → %s', (n, level, letter) => {
    expect(codeLetter(n, level)).toBe(letter);
  });
});

describe('C7 Sampling plan: Table II-A with arrows', () => {
  it.each([
    ['J', '1.0', 'J', 80, 2], // lot 1200 at AQL 1.0: n 80, Ac 2 / Re 3
    ['P', '0.65', 'P', 800, 10],
    ['P', '2.5', 'N', 500, 21], // arrow up: use N's plan
    ['P', '0.010', 'Q', 1250, 0], // arrow down: use Q's plan
    ['D', '0.65', 'F', 20, 0], // two arrows down
    ['F', '1.0', 'E', 13, 0], // arrow up just below the 0/1 diagonal
    ['G', '1.0', 'H', 50, 1], // arrow down two rows below the diagonal
    ['A', '10', 'C', 5, 1], // top row: arrow down twice
    ['R', '0.015', 'P', 800, 0], // bottom row: arrows up
    ['R', '1.0', 'Q', 1250, 21],
    ['K', '4.0', 'K', 125, 10],
    ['M', '0.040', 'M', 315, 0], // on the 0/1 diagonal
    ['M', '0.065', 'L', 200, 0], // one column right of the diagonal: arrow up
  ])('C7: letter %s at AQL %s → plan of %s: n %i, Ac %i', (letter, aql, used, n, ac) => {
    expect(plan(letter, aql)).toEqual({ letter: used, n, ac, re: ac + 1 });
  });

  it('C7: coated-tablet visual inspection (formulations 41, 42): lot 300000, level II, critical 0 / major 0.65 / minor 2.5', () => {
    const r = ok(c7SamplingPlan({ lotSize: '300000', level: 'II', classes: { critical: '0', major: '0.65', minor: '2.5' } }));
    expect(r.letter).toBe('P');
    expect(r.plans.map((p) => [p.name, p.sampleSize, p.accept, p.reject])).toEqual([
      ['critical', 800, 0, 1],
      ['major', 800, 10, 11],
      ['minor', 500, 21, 22],
    ]);
    expect(r.value.toString()).toBe('800');
    expect(r.check).toBeUndefined(); // no defects recorded yet: a plan only
    expect(r.shown).toContain('zero accepted, plant rule');
  });

  it.each([
    [{ critical: 0, major: 10, minor: 21 }, true],
    [{ critical: 0, major: 11, minor: 3 }, false], // 11 = Re for major
    [{ critical: 1, major: 0, minor: 0 }, false],
  ])('C7: defects found %o → accept %s', (found, pass) => {
    const r = ok(c7SamplingPlan({ lotSize: '300000', level: 'II', classes: { critical: '0', major: '0.65', minor: '2.5' }, found }));
    expect(r.check?.pass).toBe(pass);
  });

  it('C7: small lot: sample size at or above the lot size → inspect all', () => {
    // lot 10, II → B; AQL 0.65 arrows down to F (n 20) ≥ 10 → 100 % inspection of 10 units
    const r = ok(c7SamplingPlan({ lotSize: '10', level: 'II', classes: { major: '0.65' } }));
    expect(r.plans[0]?.hundredPercent).toBe(true);
    expect(r.plans[0]?.sampleSize).toBe(10);
  });

  it.each([
    [{ lotSize: '300000', level: 'II' as const, classes: { major: '0.5' } }, /not a column/],
    [{ lotSize: '300000', level: 'II' as const, classes: { major: '15' } }, /not a column/],
    [{ lotSize: '300000', level: 'IV' as unknown as 'II', classes: { major: '0.65' } }, /not one of/],
    [{ lotSize: '3e5', level: 'II' as const, classes: { major: '0.65' } }, /whole number/],
    [{ lotSize: '1', level: 'II' as const, classes: { major: '0.65' } }, /2 or more/],
    [{ lotSize: '300000', level: 'II' as const, classes: {} }, /at least one defect class/],
    [{ lotSize: '300000', level: 'II' as const, classes: { major: '0.65' }, found: { major: -1 } }, /whole number/],
  ])('C7: refuses %o', (i, msg) => {
    expect(refused(c7SamplingPlan(i))).toMatch(msg);
  });
});
