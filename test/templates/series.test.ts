import { describe, expect, it } from 'vitest';
import { c2Count, c3AllIndividual, c4Observation, t7Statistics } from '../../shared/templates/series.js';
import { ok, refused } from './helpers.js';

// 20 imatinib cores (750 mg target). Hand check (Python decimal): sum 15003.0, mean 750.150 mg,
// SD 1.56121 mg, RSD 0.2081 %, min 747.5, max 753.0; largest deviation from the mean +0.380 % / −0.353 %.
const W20 = '751.2 748.9 750.4 752.0 747.5 749.8 751.6 750.1 748.2 753.0 749.0 750.7 751.9 748.6 750.3 749.5 752.4 747.9 750.8 749.2'.split(' ');

describe('T7 Statistics of readings', () => {
  it('T7: 20 tablet weights: mean, SD, RSD, min, max, count', () => {
    const r = ok(t7Statistics({ values: W20, unit: 'mg' }));
    expect(r.stats.count).toBe(20);
    expect(r.value.toFixed(3)).toBe('750.150');
    expect(r.stats.sd?.toFixed(5)).toBe('1.56121');
    expect(r.stats.rsd?.toFixed(4)).toBe('0.2081');
    expect(r.stats.min.toString()).toBe('747.5');
    expect(r.stats.max.toString()).toBe('753');
    expect(r.shown).toBe('n = 20; mean = 750.15 mg; SD = 1.561 mg; RSD = 0.21 %; min = 747.5 mg; max = 753.0 mg');
  });

  it('T7: mean against limits with rounding at the limit', () => {
    // mean 750.150 against 712.5-787.5 mg (750 ± 5 %): pass; against NMT 750.1 mg: 750.15 → 750.2 > 750.1 fail (half up)
    expect(ok(t7Statistics({ values: W20, unit: 'mg', limit: { low: '712.5', high: '787.5', unit: 'mg' } })).check?.pass).toBe(true);
    expect(ok(t7Statistics({ values: W20, unit: 'mg', limit: { high: '750.1', unit: 'mg' } })).check?.pass).toBe(false);
    expect(ok(t7Statistics({ values: W20, unit: 'mg', limit: { high: '750.2', unit: 'mg' } })).check?.pass).toBe(true);
  });

  it('T7: blend uniformity RSD NMT 5.0 % (levothyroxine, formulation 2)', () => {
    // 10 results: 98, 101, 99, 102, 100, 97, 103, 100, 99, 101 → mean 100.0, SD 1.8257, RSD 1.83 %
    const r = ok(t7Statistics({ values: ['98', '101', '99', '102', '100', '97', '103', '100', '99', '101'], unit: '%', rsdLimit: { high: '5.0', unit: '%' } }));
    expect(r.stats.rsd?.toFixed(4)).toBe('1.8257');
    expect(r.rsdCheck?.pass).toBe(true);
  });

  it('T7: mixed units in a series are converted to the first reading’s unit', () => {
    // 0.7502 g = 750.2 mg; mean of 750.0 and 750.2 = 750.1 mg
    expect(ok(t7Statistics({ readings: ['750.0 mg', '0.7502 g'] })).value.toFixed(1)).toBe('750.1');
  });

  it('T7: per-unit value from two readings on the same unit (formulation 17: top − bottom shell wall)', () => {
    // (1.32 − 1.10) = 0.22, (1.30 − 1.12) = 0.18, (1.35 − 1.09) = 0.26 → mean 0.22 mm
    const r = ok(t7Statistics({ pairs: [['1.32 mm', '1.10 mm'], ['1.30 mm', '1.12 mm'], ['1.35 mm', '1.09 mm']] }));
    expect(r.value.toFixed(2)).toBe('0.22');
  });

  it('T7: temperatures: the mean is a temperature, the SD a temperature difference', () => {
    const r = ok(t7Statistics({ values: ['40.0', '41.0', '42.0'], unit: '°C' }));
    expect(r.value.toFixed(1)).toBe('41.0');
    expect(r.shown).toContain('SD = 1.000 Δ°C');
  });

  it('T7: one reading: no SD', () => {
    const r = ok(t7Statistics({ values: ['750.0'], unit: 'mg' }));
    expect(r.stats.sd).toBeUndefined();
  });

  it.each([
    [{ values: [], unit: 'mg' }, /no readings/],
    [{ readings: ['750 mg', '1 mL'] }, /cannot be converted/],
    [{ values: ['750.0'], unit: 'mg', rsdLimit: { high: '5.0', unit: '%' } }, /at least two readings/],
  ])('T7: refuses %o', (i, msg) => {
    expect(refused(t7Statistics(i))).toMatch(msg);
  });
});

describe('C2 Count of readings', () => {
  it.each([
    [W20, '20', 'exactly', true],
    [W20.slice(0, 19), '20', 'exactly', false],
    [W20, '10', 'at least', true],
    ['800', '800', 'at least', true], // RTRT 800 samples in 40 h (formulation 50)
    ['799', '800', 'at least', false],
    // The count as a number field records it ("4 units"): it used to crash ([DecimalError] Invalid argument: undefined).
    [{ value: '4', unit: 'units' }, '4', 'at least', true],
    [{ value: '3', unit: 'units' }, '4', 'at least', false],
  ] as [string[] | string | { value: string; unit: string }, string, 'exactly' | 'at least', boolean][])('C2: %#: count vs %s (%s) → %s', (readings, required, mode, pass) => {
    expect(ok(c2Count({ readings, required, mode })).check?.pass).toBe(pass);
  });

  it('C2: refuses a count that is not whole', () => {
    expect(refused(c2Count({ readings: '20.5', required: '20' }))).toMatch(/whole numbers/);
  });
});

describe('C3 All individual values', () => {
  it('C3: uniformity of mass, Ph. Eur. ≥ 250 mg band: not more than 2 outside ± 5 %, none outside ± 10 % of the mean', () => {
    // all 20 within ± 0.38 % of the mean → pass
    const r = ok(c3AllIndividual({ values: W20, unit: 'mg', band: { plusMinusPercent: '5', of: 'mean' }, allowedOutside: 2, outer: { plusMinusPercent: '10', of: 'mean' } }));
    expect(r.check?.pass).toBe(true);
    expect(r.value.toString()).toBe('0');
  });

  const w10 = ['100.0', '100.0', '100.0', '100.0', '100.0', '100.0', '100.0', '100.0', '107.0', '93.5'];
  // mean = 1000.5 / 10 = 100.05; 107.0 → +6.947 %; 93.5 → −6.547 %
  it.each([
    [w10, 2, true], // two outside ± 5 %, two allowed
    [w10, 1, false],
    [[...w10.slice(0, 9), '89.0'], 2, false], // mean 99.6; 89.0 is −10.64 % → outside ± 10 %
  ])('C3: %#: ± 5 %% with %s allowed outside', (values, allowed, pass) => {
    expect(ok(c3AllIndividual({ values, unit: 'mg', band: { plusMinusPercent: '5', of: 'mean' }, allowedOutside: allowed, outer: { plusMinusPercent: '10', of: 'mean' } })).check?.pass).toBe(pass);
  });

  it.each([
    ['105.4', true], // +5.4 % of target 100 → rounds to 5 (limit written "5"): inside
    ['105.5', false], // +5.5 % → 6: outside
  ])('C3: rounding of the deviation at the band: %s mg against ± 5 %% of 100 mg', (v, inside) => {
    const r = ok(c3AllIndividual({ values: [v], unit: 'mg', band: { plusMinusPercent: '5', of: { target: '100 mg' } } }));
    expect(r.units[0]?.inBand).toBe(inside);
  });

  it('C3: absolute limits: hardness each 50-100 N (part 2, formulation 8), readings in kp are converted', () => {
    // 5.0 kp = 49.03 N → 49 < 50 fails; 6.0 kp = 58.84 N passes; 10.2 kp = 100.03 N → 100 passes
    const r = ok(c3AllIndividual({ readings: ['5.0 kp', '6.0 kp', '10.2 kp'], band: { limit: { low: '50', high: '100', unit: 'N' } } }));
    expect(r.units.map((u) => u.inBand)).toEqual([false, true, true]);
    expect(r.check?.pass).toBe(false);
  });

  it('C3: per-unit values from two readings (formulation 17): each wall difference NMT 0.30 mm', () => {
    const r = ok(c3AllIndividual({ pairs: [['1.32 mm', '1.10 mm'], ['1.50 mm', '1.12 mm']], band: { limit: { high: '0.30', unit: 'mm' } } }));
    expect(r.units.map((u) => u.inBand)).toEqual([true, false]); // 0.22 and 0.38
  });

  it('C3: refuses a bad band', () => {
    expect(refused(c3AllIndividual({ values: ['1'], unit: 'mg', band: { plusMinusPercent: '-5', of: 'mean' } }))).toMatch(/positive/);
    expect(refused(c3AllIndividual({ values: ['1'], unit: 'mg', band: { plusMinusPercent: '5', of: 'mean' }, allowedOutside: -1 }))).toMatch(/whole number/);
  });
});

describe('C4 Observation', () => {
  it.each([
    [['yes'], ['yes'], undefined, true],
    [['no'], ['yes'], undefined, false],
    [['yes', 'yes', 'yes', 'yes', 'yes', 'yes'], ['yes'], undefined, true], // six tablets intact after acid (formulation 5)
    [['intact', 'intact', 'cracked'], ['intact'], ['intact', 'cracked', 'softened'], false],
    [['Yes ', 'YES'], ['yes'], undefined, true], // case and spaces ignored
  ])('C4: %o expected %o → %s', (answers, expected, options, pass) => {
    const r = ok(c4Observation({ question: 'Sieve intact before and after use', answers, expected, ...(options === undefined ? {} : { options }) }));
    expect(r.check?.pass).toBe(pass);
    expect(r.triggersF3).toBe(!pass);
  });

  it('C4: allowed failures: twins NMT 2 in the sample (formulation 25)', () => {
    expect(ok(c4Observation({ question: 'Twin', answers: ['no', 'no', 'yes', 'no', 'yes'], expected: ['no'], allowedFailures: 2 })).check?.pass).toBe(true);
  });

  it.each([
    [{ question: 'q', answers: ['maybe'], expected: ['yes'] }, /not in the list/],
    [{ question: 'q', answers: [], expected: ['yes'] }, /No answer/],
    [{ question: 'q', answers: ['yes'], expected: ['perhaps'] }, /expected answer "perhaps" is not in the list/],
  ])('C4: refuses %o', (i, msg) => {
    expect(refused(c4Observation(i))).toMatch(msg);
  });
});
