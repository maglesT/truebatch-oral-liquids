import { describe, expect, it } from 'vitest';
import { t1Difference, t2Total, t3PercentOfTarget, t4Accountability, t5PercentChange, t6Ratio, t21LesserGreater } from '../../shared/templates/basic.js';
import { ok, refused } from './helpers.js';

describe('T1 Difference', () => {
  it.each([
    // [a, b, unit, expected value at 3 dp, case]
    ['52.400 kg', '2.100 kg', undefined, '50.300', 'gross − tare'],
    ['52.400 kg', '2100 g', undefined, '50.300', 'tare in g, converted (2100 g = 2.100 kg)'],
    ['12.5 kg', '12.5 kg', undefined, '0.000', 'zero net is allowed'],
    ['60 °C', '59.2 °C', undefined, '0.800', 'drying end point: inlet − exhaust gives a difference in Δ°C'],
    ['1000 mL', '685 mL', 'L', '0.315', 'reservoir before − after, in L'],
  ])('T1: %s − %s → %s (%s)', (a, b, unit, want, _case) => {
    void _case;
    const r = ok(t1Difference({ a, b, ...(unit === undefined ? {} : { unit }) }));
    expect(r.value.toFixed(3)).toBe(want);
  });

  it('T1: shows the worked line', () => {
    expect(ok(t1Difference({ a: '52.400 kg', b: '2.100 kg' })).shown).toBe('52.400 kg − 2.100 kg = 50.300 kg');
  });

  it('T1: effervescent drying end point (formulation 43): inlet 60 °C − exhaust 59.4 °C = 0.6 °C ≤ 1 °C', () => {
    const r = ok(t1Difference({ a: '60.0 °C', b: '59.4 °C', names: ['inlet', 'exhaust'], limit: { high: '1.0', unit: '°C' } }));
    expect(r.unit).toBe('Δ°C');
    expect(r.check?.pass).toBe(true);
  });

  it.each([
    [{ a: '2.100 kg', b: '52.400 kg' }, /tare \(52.400 kg\) is more than the gross/],
    [{ a: '52.4 kg', b: '400 IU' }, /never a mass/],
    [{ a: '52.4 kg', b: '2 L' }, /cannot be converted/],
    [{ a: 'abc kg', b: '2 kg' }, /not a number/],
    [{ a: '5 stone', b: '2 kg' }, /not in the unit list/],
  ])('T1: refuses %o', (i, msg) => {
    expect(refused(t1Difference(i))).toMatch(msg);
  });

  it('T1: allows a negative difference when the master says so (target − found)', () => {
    expect(ok(t1Difference({ a: '10.0 mg', b: '10.3 mg', allowNegative: true })).value.toFixed(1)).toBe('-0.3');
  });
});

describe('T2 Total', () => {
  it.each([
    [['12.500 kg', '12.480 kg', '3.020 kg'], undefined, '28.000'], // 12.5 + 12.48 + 3.02 = 28.000
    [['25.000 kg', '500 g', '0.250 kg'], 'kg', '25.750'], // 25 + 0.5 + 0.25
    [['120000 tablets', '120000 tablets'], undefined, '240000.000'], // telmisartan 2 sub-batches (formulation 6)
  ] as [string[], string | undefined, string][])('T2: %o = %s', (values, unit, want) => {
    expect(ok(t2Total({ values, ...(unit === undefined ? {} : { unit }) })).value.toFixed(3)).toBe(want);
  });

  it('T2: shows each value', () => {
    expect(ok(t2Total({ values: ['12.500 kg', '12.480 kg', '3.020 kg'] })).shown).toBe('12.500 kg + 12.480 kg + 3.020 kg = 28.000 kg');
  });

  it('T2: total against the required quantity within the weighing tolerance (C1)', () => {
    // 13.530 kg pantoprazole required ± 0.005 kg: 13.528 passes, 13.524 fails
    expect(ok(t2Total({ values: ['10.000 kg', '3.528 kg'], limit: { low: '13.525', high: '13.535', unit: 'kg' } })).check?.pass).toBe(true);
    expect(ok(t2Total({ values: ['10.000 kg', '3.524 kg'], limit: { low: '13.525', high: '13.535', unit: 'kg' } })).check?.pass).toBe(false);
  });

  it.each([
    [['25 °C', '26 °C'], /never added/],
    [['5 %', '3 %'], /not added/],
    [['10 kg', '400 IU'], /never a mass/],
    [[], /at least one value/],
  ] as [string[], RegExp][])('T2: refuses %o', (values, msg) => {
    expect(refused(t2Total({ values }))).toMatch(msg);
  });
});

describe('T3 % of target (yield)', () => {
  it.each([
    ['50.300 kg', '51.000 kg', '98.6'], // 50.3 ÷ 51 × 100 = 98.627
    ['203.450 kg', '205.800 kg', '98.9'], // imatinib granule yield: 203.45 ÷ 205.8 × 100 = 98.858
    ['294.5 kg', '290 kg', '101.6'], // effervescent granulate (formulation 43): 101.55 → 101.6
    ['727.3 g', '800 g', '90.9'], // round 2 formulation 49: 727.3 ÷ 800 = 90.91 %
    ['4.0 kg', '4000 g', '100.0'], // unit conversion
  ])('T3: %s ÷ %s × 100 = %s %%', (a, t, want) => {
    expect(ok(t3PercentOfTarget({ actual: a, theoretical: t })).value.toFixed(1)).toBe(want);
  });

  it('T3: shows the worked line from the brief', () => {
    expect(ok(t3PercentOfTarget({ actual: '50.300 kg', theoretical: '51.000 kg' })).shown).toBe('50.300 kg ÷ 51.000 kg × 100 = 98.6 %');
  });

  it.each([
    ['50.4645 kg', true], // 50.4645 ÷ 51 = 98.9500 % → 99.0 (half rounds up): pass
    ['50.4644 kg', false], // 98.94980 % → 98.9: fail
    ['50.4765 kg', true], // 98.9735 % → 99.0
  ])('T3: yield at the rounding edge of NLT 99.0 %%: %s → pass %s', (a, pass) => {
    expect(ok(t3PercentOfTarget({ actual: a, theoretical: '51.000 kg', limit: { low: '99.0', unit: '%' } })).check?.pass).toBe(pass);
  });

  it.each([
    [{ actual: '50 kg', theoretical: '0 kg' }, /more than zero/],
    [{ actual: '-1 kg', theoretical: '10 kg' }, /cannot be negative/],
    [{ actual: '50 kg', theoretical: '50 L' }, /cannot be converted/],
    [{ actual: '30 °C', theoretical: '40 °C' }, /temperatures/],
  ])('T3: refuses %o', (i, msg) => {
    expect(refused(t3PercentOfTarget(i))).toMatch(msg);
  });
});

describe('T4 Accountability and unaccounted', () => {
  const parts = [
    { name: 'cores', value: '45.900 kg' },
    { name: 'IPC samples', value: '0.150 kg' },
    { name: 'rejects', value: '0.200 kg' },
    { name: 'dust', value: '0.050 kg' },
  ];
  it('T4: pantoprazole compression reconciliation: (45.9 + 0.15 + 0.2 + 0.05) ÷ 46.5 × 100 = 99.57 %, unaccounted 0.200 kg', () => {
    // Hand check: parts 46.300 kg; 46.3 ÷ 46.5 = 0.995699 → 99.57 %; 46.5 − 46.3 = 0.200 kg = 0.430 %
    const r = ok(t4Accountability({ input: '46.500 kg', parts, limit: { low: '98.0', high: '100.0', unit: '%' }, unaccountedLimit: { high: '1.0', unit: '%' } }));
    expect(r.value.toFixed(2)).toBe('99.57');
    expect(r.unaccounted.toFixed(3)).toBe('0.200');
    expect(r.unaccountedPercent.toFixed(2)).toBe('0.43');
    expect(r.check?.pass).toBe(true);
    expect(r.unaccountedCheck?.pass).toBe(true);
  });

  it('T4: by number of tablets (controlled substance, formulation 40)', () => {
    // 100000 issued; 99210 good + 400 samples + 300 rejects + 90 destroyed = 100000 → 100.00 %, unaccounted 0
    const r = ok(t4Accountability({ input: '100000 tablets', parts: [{ name: 'good', value: '99210 tablets' }, { name: 'samples', value: '400 tablets' }, { name: 'rejects', value: '300 tablets' }, { name: 'destroyed', value: '90 tablets' }], unaccountedLimit: { high: '0', unit: 'tablets' } }));
    expect(r.value.toFixed(2)).toBe('100.00');
    expect(r.unaccounted.isZero()).toBe(true);
    expect(r.unaccountedCheck?.pass).toBe(true);
  });

  it('T4: unaccounted limit in kg: 0.200 kg against NMT 0.150 kg fails', () => {
    expect(ok(t4Accountability({ input: '46.500 kg', parts, unaccountedLimit: { high: '0.150', unit: 'kg' } })).unaccountedCheck?.pass).toBe(false);
  });

  it.each([
    [{ input: '0 kg', parts }, /more than zero/],
    [{ input: '46.5 kg', parts: [] }, /at least one part/],
    [{ input: '46.5 kg', parts: [{ name: 'cores', value: '-1 kg' }] }, /cannot be negative/],
    [{ input: '46.5 kg', parts: [{ name: 'cores', value: '1000 tablets' }] }, /cannot be converted/],
  ])('T4: refuses %o', (i, msg) => {
    expect(refused(t4Accountability(i))).toMatch(msg);
  });
});

describe('T5 % change', () => {
  type Base = 'start' | 'final' | { stage: string; weight: string };
  it.each([
    // pantoprazole (formulation 5): each coat on its own starting weight
    ['155.0 mg', '175.0 mg', 'gain', 'start', '12.90'], // seal coat: 20 ÷ 155 = 12.903 %
    ['175.0 mg', '190.0 mg', 'gain', 'start', '8.57'], // enteric coat on the seal-coated weight: 15 ÷ 175 = 8.571 %
    ['175.0 mg', '190.0 mg', 'gain', { stage: 'core', weight: '155.0 mg' }, '9.68'], // the same coat on the core: 15 ÷ 155 = 9.677 %
    ['6.512 g', '6.471 g', 'loss', 'start', '0.63'], // friability: 0.041 ÷ 6.512 = 0.6296 %
    ['130.0 mg', '135.0 mg', 'gain', 'start', '3.85'], // printed tablets (formulation 41): 5 ÷ 130 = 3.846 %
    ['750.0 mg', '0.768 g', 'gain', 'start', '2.40'], // imatinib film coat 18 ÷ 750, with unit conversion
    ['85.0 mg', '100.0 mg', 'gain', 'final', '15.00'], // round 3: gain on the FINAL weight, 15 ÷ 100
    ['85.0 mg', '100.0 mg', 'gain', 'start', '17.65'], // the same coat on the start: 15 ÷ 85 = 17.647 %
  ] as [string, string, 'gain' | 'loss', Base, string][])('T5: %s → %s (%s, base %o) = %s %%', (before, after, mode, base, want) => {
    expect(ok(t5PercentChange({ before, after, mode, base })).value.toFixed(2)).toBe(want);
  });

  it.each([
    // Ursodeoxycholic acid enteric film, 2-10 % of the UNCOATED tablet (owner's patents). Own example:
    // uncoated core 500.0 mg, seal-coated 520.0 mg, enteric-coated 546.5 mg; enteric coat 26.5 mg.
    [{ stage: 'uncoated core', weight: '500.0 mg' }, '5.3'], // 26.5 ÷ 500.0 = 5.300 %
    ['start' as const, '5.1'], // 26.5 ÷ 520.0 = 5.096 %
    ['final' as const, '4.8'], // 26.5 ÷ 546.5 = 4.849 %
  ] as [Base, string][])('T5: ursodeoxycholic acid enteric coat on base %o = %s %%', (base, want) => {
    const r = ok(t5PercentChange({ before: '520.0 mg', after: '546.5 mg', mode: 'gain', base, decimals: 1 }));
    expect(r.value.toFixed(1)).toBe(want);
  });

  it('T5: the worked line names the base', () => {
    expect(ok(t5PercentChange({ before: '520.0 mg', after: '546.5 mg', mode: 'gain', base: { stage: 'uncoated core', weight: '500.0 mg' } })).shown).toBe(
      '(546.5 mg − 520.0 mg) ÷ 500.0 mg × 100 = 5.30 % gain on the uncoated core weight',
    );
  });

  it.each([
    ['6.471 g', true], // loss 0.6296 % → 0.6
    ['6.450136 g', true], // loss exactly 0.9500 % → 1.0 ≤ 1.0 (half up)
    ['6.44369 g', true], // 1.04899 % → 1.0
    ['6.443624 g', false], // exactly 1.0500 % → 1.1 > 1.0
  ])('T5: friability NMT 1.0 %%: after %s → pass %s', (after, pass) => {
    expect(ok(t5PercentChange({ before: '6.512 g', after, mode: 'loss', base: 'start', limit: { high: '1.0', unit: '%' } })).check?.pass).toBe(pass);
  });

  it.each([
    [{ before: '0 mg', after: '1 mg', mode: 'gain' as const, base: 'start' as const }, /more than zero/],
    [{ before: '25 °C', after: '30 °C', mode: 'gain' as const, base: 'start' as const }, /temperatures/],
    [{ before: '155 mg', after: '1 mL', mode: 'gain' as const, base: 'start' as const }, /cannot be converted/],
    [{ before: '155 mg', after: '175 mg', mode: 'gain' as const } as unknown as Parameters<typeof t5PercentChange>[0], /Say which weight/],
    [{ before: '155 mg', after: '175 mg', mode: 'gain' as const, base: 'core' } as unknown as Parameters<typeof t5PercentChange>[0], /Say which weight/],
    [{ before: '155 mg', after: '175 mg', mode: 'gain' as const, base: { stage: 'core', weight: '0 mg' } }, /The core weight must be more than zero/],
  ])('T5: refuses %o', (i, msg) => {
    expect(refused(t5PercentChange(i))).toMatch(msg);
  });
});

describe('T6 Ratio and powder indices', () => {
  it.each([
    // [mode, a, b, unit, decimals, expected]
    ['carr', '0.500 g/mL', '0.625 g/mL', undefined, 2, '20.00'], // (0.625 − 0.5) ÷ 0.625 × 100
    ['hausner', '0.500 g/mL', '0.625 g/mL', undefined, 2, '1.25'], // 0.625 ÷ 0.5
    ['ratio', '262.500 kg', '750 mg', 'tablets', 0, '350000'], // imatinib theoretical tablets: 262.5 kg ÷ 750 mg
    ['ratio', '680.0 mg', '100 tablets', 'mg', 2, '6.80'], // mini-tablet group weight ÷ 100 (formulation 25)
    ['ratio', '14.5 kg', '287 kg', '%', 2, '5.05'], // water as % of dry mix (formulation 43): 14.5 ÷ 287 × 100 = 5.052
    ['ratio', '3.5 kg/h', '10 kg/h', undefined, 2, '0.35'], // liquid-to-powder ratio (formulation 50)
    ['ratio', '15 kN', '0.785 cm²', 'kN/cm²', 2, '19.11'], // pressure on a punch face: 15 ÷ 0.785 = 19.108 kN/cm²
    ['ratio', '300.0 g', '480.0 mL', 'g/mL', 3, '0.625'], // tapped density: 300 ÷ 480
    ['log10', '5e9 CFU', '4e9 CFU', undefined, 3, '0.097'], // probiotic log reduction (formulation 36): log10(1.25) = 0.09691
  ])('T6: %s %s / %s = %s', (mode, a, b, unit, d, want) => {
    const r = ok(t6Ratio({ mode: mode as 'ratio', a, b, ...(unit === undefined ? {} : { unit }) }));
    expect(r.value.toFixed(d as number)).toBe(want);
  });

  it('T6: log reduction against NMT 0.3 log (probiotic, formulation 36)', () => {
    expect(ok(t6Ratio({ mode: 'log10', a: '5e9 CFU', b: '4e9 CFU', limit: { high: '0.3', unit: 'log' } })).check?.pass).toBe(true);
    // 5e9 → 2e9: log10(2.5) = 0.398 → 0.4 > 0.3
    expect(ok(t6Ratio({ mode: 'log10', a: '5e9 CFU', b: '2e9 CFU', limit: { high: '0.3', unit: 'log' } })).check?.pass).toBe(false);
  });

  it('T6: Carr index shows its formula', () => {
    expect(ok(t6Ratio({ mode: 'carr', a: '0.500 g/mL', b: '0.625 g/mL' })).shown).toBe('Carr index = (0.625 g/mL − 0.500 g/mL) ÷ 0.625 g/mL × 100 = 20.0 %');
  });

  it.each([
    [{ mode: 'carr' as const, a: '0.70 g/mL', b: '0.60 g/mL' }, /cannot be lower than the bulk/],
    [{ mode: 'ratio' as const, a: '10 kg', b: '0 kg' }, /divide by zero/],
    [{ mode: 'ratio' as const, a: '10 kg', b: '5 N' }, /not a ratio this template gives/],
    [{ mode: 'log10' as const, a: '0 CFU', b: '4e9 CFU' }, /more than zero/],
    [{ mode: 'ratio' as const, a: '40 °C', b: '20 °C' }, /temperatures/],
    [{ mode: 'carr' as const, a: '0.5 g', b: '0.6 g' }, /must be a density/],
  ])('T6: refuses %o', (i, msg) => {
    expect(refused(t6Ratio(i))).toMatch(msg);
  });
});

describe('T21 Lesser / greater', () => {
  it('T21: bilayer expected tablets (formulation 6): the smaller layer count', () => {
    // layer 1: 40.5 kg ÷ 270 mg = 150000; layer 2: 33.0 kg ÷ 225 mg = 146666.7, to the whole tablet 146667 → the lesser is layer 2
    const l1 = ok(t6Ratio({ mode: 'ratio', a: '40.5 kg', b: '270 mg', unit: 'tablets' }));
    const l2 = ok(t6Ratio({ mode: 'ratio', a: '33.0 kg', b: '225 mg', unit: 'tablets' }));
    const r = ok(t21LesserGreater({ which: 'lesser', values: [{ name: 'layer 1', value: `${l1.value.toFixed(1)} tablets` }, { name: 'layer 2', value: `${l2.value.toFixed(1)} tablets` }] }));
    expect(r.from).toBe('layer 2');
    expect(r.value.toFixed(1)).toBe('146667.0');
    expect(l2.shown).toBe('33.0 kg ÷ 225 mg = 146666.6…, rounded to whole tablets = 146667 tablets');
  });

  it.each([
    ['greater', [['a', '1.2 kg'], ['b', '1250 g'], ['c', '1.1 kg']], 'b'], // 1250 g = 1.25 kg is the largest
    ['lesser', [['a', '1.2 kg'], ['b', '1250 g'], ['c', '1.1 kg']], 'c'],
  ])('T21: %s of %o is %s', (which, vals, want) => {
    const values = (vals as string[][]).map(([name, value]) => ({ name: name ?? '', value: value ?? '' }));
    expect(ok(t21LesserGreater({ which: which as 'lesser' | 'greater', values })).from).toBe(want);
  });

  it.each([
    [[{ name: 'a', value: '1 kg' }], /at least two/],
    [[{ name: 'a', value: '1 kg' }, { name: 'b', value: '1 L' }], /cannot be converted/],
  ])('T21: refuses %o', (values, msg) => {
    expect(refused(t21LesserGreater({ which: 'lesser', values }))).toMatch(msg);
  });
});
