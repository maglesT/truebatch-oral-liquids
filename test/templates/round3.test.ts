import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { convert, unit } from '../../shared/templates/units.js';
import { t6Ratio } from '../../shared/templates/basic.js';
import { t8BatchScaling, t9PotencyAdjusted, t11SaltFactor } from '../../shared/templates/dispensing.js';
import { t26MixToTarget } from '../../shared/templates/mixing.js';
import { c1WithinLimits, c3AllIndividual, noFurtherChange, t7Statistics } from '../../shared/templates/series.js';
import { ok, refused } from './helpers.js';

// Round 3 of the formulation test and the owner's 15 patents. Hand checks in Python decimal.

describe('T26 Mix to a target', () => {
  it.each([
    ['fines below 125 µm', '200.0 kg', '28.0 %', '12.0 %', '20.0 %', '200.000'], // 200 × (20 − 28) ÷ (12 − 20) = 200
    ['LOD', '150.0 kg', '3.2 %', '1.0 %', '2.0 %', '180.000'], // 150 × (2.0 − 3.2) ÷ (1.0 − 2.0) = 180
    ['assay', '100.0 kg', '96.0 %', '103.0 %', '99.0 %', '75.000'], // 100 × 3 ÷ 4 = 75; check (9600 + 7725) ÷ 175 = 99.0
    ['assay, mass in g', '2500 g', '96.0 %', '103.0 %', '99.0 %', '1875.00'], // same ratio, unit kept
  ])('T26: %s: %s at %s + donor at %s to %s → %s', (property, mass, a, b, target, want) => {
    const r = ok(t26MixToTarget({ mass, a, b, target, property }));
    expect(r.value.toFixed(r.unit === 'kg' ? 3 : 2)).toBe(want);
  });

  it('T26: total mass and worked line', () => {
    const r = ok(t26MixToTarget({ mass: '100.0 kg', a: '96.0 %', b: '103.0 %', target: '99.0 %', property: 'assay' }));
    expect(r.totalMass.toFixed(3)).toBe('175.000');
    expect(r.shown).toContain('100.0 kg × (99.0 % − 96.0 %) ÷ (103.0 % − 99.0 %) = 75.000 kg of the donor lot');
  });

  it('T26: main lot already at the target → add nothing', () => {
    expect(ok(t26MixToTarget({ mass: '100 kg', a: '99.0 %', b: '103.0 %', target: '99.0 %' })).value.isZero()).toBe(true);
  });

  it.each([
    [{ mass: '100 kg', a: '96.0 %', b: '97.0 %', target: '99.0 %' }, /not on the far side.*Choose a donor above 99.0 %/],
    [{ mass: '200 kg', a: '28 %', b: '30 %', target: '20 %' }, /Choose a donor below 20 %/],
    [{ mass: '100 kg', a: '96.0 %', b: '99.0 %', target: '99.0 %' }, /not on the far side/], // donor at the target never reaches it
    [{ mass: '100 kg', a: '40 °C', b: '60 °C', target: '50 °C' }, /Temperatures/],
    [{ mass: '100 L', a: '96 %', b: '103 %', target: '99 %' }, /must be a mass/],
    [{ mass: '100 kg', a: '96 %', b: '103 mg', target: '99 %' }, /cannot be converted/],
  ])('T26: refuses %o', (i, msg) => {
    expect(refused(t26MixToTarget(i))).toMatch(msg);
  });
});

describe('C1 limits centred on a value computed earlier', () => {
  // Target tablet weight from the blend assay: 750 mg × 100 ÷ 99.2 % = 756.0484 mg (a T9-style result).
  const target = { ok: true as const, value: new Dec(750).times(100).div('99.2'), unit: 'mg' };
  it.each([
    ['790.0 mg', '5', true], // +4.4907 % → 4 ≤ 5
    ['795.0 mg', '5', true], // +5.1520 % → 5 (limit written "5": no decimals)
    ['795.0 mg', '5.0', false], // +5.1520 % → 5.2 > 5.0
    ['718.3 mg', '5.0', true], // −4.9928 % → 5.0
    ['718.2 mg', '5.0', true], // −5.0061 % → 5.0
    ['717.8 mg', '5.0', false], // −5.0590 % → 5.1
  ])('C1: %s against ± %s %% of the computed target', (value, pct, pass) => {
    const r = ok(c1WithinLimits({ value, around: { centre: target, name: 'target weight from the blend assay', plusMinusPercent: pct } }));
    expect(r.check?.pass).toBe(pass);
  });

  it.each([
    ['771.0 mg', true], // +14.9516 mg → 15.0 ≤ 15.0
    ['771.1 mg', false], // +15.0516 mg → 15.1
    ['0.7410 g', true], // −15.0484 mg → 15.0 (unit converted)
  ])('C1: %s against ± 15.0 mg of the computed target', (value, pass) => {
    expect(ok(c1WithinLimits({ value, around: { centre: target, plusMinus: '15.0 mg' } })).check?.pass).toBe(pass);
  });

  it('C1: the worked line names the centre', () => {
    const r = ok(c1WithinLimits({ value: '790.0 mg', around: { centre: target, name: 'target weight from the blend assay', plusMinusPercent: '5.0' } }));
    expect(r.shown).toBe('790.0 mg is +4.5 % from 756.048… mg (target weight from the blend assay); limit ± 5.0 %: within limits');
  });

  it.each([
    [{ value: '790 mg', around: { centre: target } }, /either as ± % or as ± an amount/],
    [{ value: '790 mg', around: { centre: target, plusMinusPercent: '5', plusMinus: '15 mg' } }, /either as ± % or as ± an amount/],
    [{ value: '790 mL', around: { centre: target, plusMinusPercent: '5' } }, /cannot be converted/],
    [{ value: '790 mg', around: { centre: '0 mg', plusMinusPercent: '5' } }, /centre other than zero/],
  ])('C1: refuses %o', (i, msg) => {
    expect(refused(c1WithinLimits(i))).toMatch(msg);
  });
});

describe('T9 ignited basis (loss on ignition)', () => {
  it.each([
    ['magnesium oxide, 98.5 % ignited, LOI 6.0 %: as is 92.590 %; 50.000 kg × 100 ÷ 92.59 = 54.002 kg', '50.000 kg', '98.5 %', '6.0 %', '54.00151'],
    ['zinc oxide, 99.8 % ignited, LOI 0.5 %: as is 99.301 %; 4.500 kg × 100 ÷ 99.301 = 4.532 kg', '4.500 kg', '99.8 %', '0.5 %', '4.53168'],
  ])('T9: %s', (_case, standard, assay, loi, want) => {
    const r = ok(t9PotencyAdjusted({ standard, standardIs: 'anhydrous', assay, basis: 'ignited', loi }));
    expect(r.value.toFixed(5)).toBe(want);
    expect(r.shown).toContain(`(100 − ${loi})`);
  });

  it('T9: the ignited basis needs the loss on ignition', () => {
    expect(refused(t9PotencyAdjusted({ standard: '50 kg', standardIs: 'anhydrous', assay: '98.5 %', basis: 'ignited' }))).toMatch(/loss on ignition/);
  });
});

describe('C5 potency stated as the element (T9)', () => {
  it.each([
    // Calcium carbonate with "39.6 % Ca" on the certificate: 500 mg Ca × 100 ÷ 39.6 = 1262.63 mg.
    // Chaining T11 (CaCO3 100.0869 ÷ Ca 40.078 = 2.4973) would give 1248.65 × 100 ÷ 39.6 = 3153.16 mg.
    ['calcium carbonate', '500 mg', '39.6 %', { name: 'calcium', mw: '40.078' }, { name: 'calcium carbonate', mw: '100.0869' }, '1262.63'],
    // Zinc sulfate monohydrate with "35.8 % Zn": 20 mg Zn × 100 ÷ 35.8 = 55.87 mg. ZnSO4·H2O 179.451 ÷ Zn 65.38 = 2.7447;
    // the chain would give 54.89 × 100 ÷ 35.8 = 153.34 mg.
    ['zinc sulfate monohydrate', '20 mg', '35.8 %', { name: 'zinc', mw: '65.38' }, { name: 'zinc sulfate monohydrate', mw: '179.451', hydrateOrSolvate: true }, '55.87'],
  ])('C5: %s, potency as element; the salt factor in the same chain is refused', (_m, element, potency, from, toForm, right) => {
    expect(ok(t9PotencyAdjusted({ standard: element, assay: potency, basis: 'as is', potencyAs: 'element' })).value.toFixed(2)).toBe(right);
    const salt = ok(t11SaltFactor({ quantity: element, from, to: toForm }));
    const msg = refused(t9PotencyAdjusted({ standard: salt, assay: potency, basis: 'as is', potencyAs: 'element' }));
    expect(msg).toMatch(/stated as the element/);
    expect(msg).toMatch(/overstate the dose/);
  });

  it('C5: as element, a compound weight as the standard is refused', () => {
    expect(refused(t9PotencyAdjusted({ standard: '1250 mg', standardIs: 'hydrate or solvate', assay: '39.6 %', basis: 'as is', potencyAs: 'element' }))).toMatch(/must be the element amount/);
  });
});

describe('F2 helper: noFurtherChange (constant weight)', () => {
  it.each([
    ['25.4321 g', '25.4318 g', { maxChange: '0.5 mg' }, true], // 0.3 mg ≤ 0.5 mg
    ['25.4321 g', '25.4312 g', { maxChange: '0.5 mg' }, false], // 0.9 mg
    ['25.4321 g', '25.43255 g', { maxChange: '0.5 mg' }, true], // +0.45 mg → 0.5 (half up) ≤ 0.5
    ['100.0 mg', '99.8 mg', { maxChangePercent: '0.5' }, true], // 0.2 %
    ['100.0 mg', '99.46 mg', { maxChangePercent: '0.5' }, true], // 0.54 % → 0.5
    ['100.0 mg', '99.45 mg', { maxChangePercent: '0.5' }, false], // 0.55 % → 0.6
    ['60.0 °C', '59.6 °C', { maxChange: '0.5 °C' }, true], // a temperature change is a difference
  ] as [string, string, { maxChange: string } | { maxChangePercent: string }, boolean][])('F2 noFurtherChange: %s → %s, %o → %s', (prev, cur, limit, pass) => {
    expect(ok(noFurtherChange(prev, cur, limit)).check?.pass).toBe(pass);
  });

  it('F2 noFurtherChange: refuses readings of different kinds and a % change from zero', () => {
    expect(refused(noFurtherChange('25 g', '25 mL', { maxChange: '0.5 mg' }))).toMatch(/cannot be converted/);
    expect(refused(noFurtherChange('0 g', '1 g', { maxChangePercent: '0.5' }))).toMatch(/other than zero/);
  });
});

describe('T6 angle of repose', () => {
  it.each([
    ['2.5 cm', '4.0 cm', 'radius', '32.01'], // arctan(0.625) = 32.0054°
    ['2.5 cm', '8.0 cm', 'diameter', '32.01'], // arctan(2 × 2.5 ÷ 8.0) = the same
    ['30 mm', '5.0 cm', 'radius', '30.96'], // tan = 0.6 (formulation 43): 30.9638°
  ])('T6: height %s, %s (%s) → %s°', (a, b, bIs, want) => {
    expect(ok(t6Ratio({ mode: 'angle of repose', a, b, bIs: bIs as 'radius' | 'diameter' })).value.toFixed(2)).toBe(want);
  });

  it('T6: angle of repose against NMT 35° and its worked line', () => {
    const r = ok(t6Ratio({ mode: 'angle of repose', a: '2.5 cm', b: '4.0 cm', limit: { high: '35', unit: '°' } }));
    expect(r.check?.pass).toBe(true);
    expect(r.shown).toBe('angle of repose = arctan(2.5 cm ÷ 4.0 cm) = 32.0°');
  });

  it('T6: refuses a height that is not a length', () => {
    expect(refused(t6Ratio({ mode: 'angle of repose', a: '2.5 g', b: '4.0 cm' }))).toMatch(/must be a length/);
  });
});

describe('Per-area dosing (T8 per area, T6 reverse)', () => {
  it('T8: 4.0 mg/cm² × 2.85 cm² × 300000 tablets = 3.420 kg', () => {
    expect(ok(t8BatchScaling({ mode: 'per area', perArea: '4.0 mg/cm²', area: '2.85 cm²', count: '300000 tablets' })).value.toFixed(3)).toBe('3.420');
  });

  it('T8: area in mm² and target in g/m² are converted: 40 g/m² = 4.0 mg/cm²; 285 mm² = 2.85 cm²', () => {
    expect(ok(t8BatchScaling({ mode: 'per area', perArea: '40 g/m²', area: '285 mm²', count: '300000' })).value.toFixed(3)).toBe('3.420');
  });

  it('T6: reverse: 4.5 kg coat ÷ 300000 tablets = 15.0 mg; 15.0 mg ÷ 3.2 cm² = 4.6875 mg/cm²', () => {
    const per = ok(t6Ratio({ mode: 'ratio', a: '4.5 kg', b: '300000 tablets' }));
    expect(per.value.toFixed(2)).toBe('15.00');
    const r = ok(t6Ratio({ mode: 'ratio', a: `${per.value.toString()} mg`, b: '3.2 cm²' }));
    expect(r.unit).toBe('mg/cm²');
    expect(r.value.toFixed(4)).toBe('4.6875');
  });

  it('T8: refuses an area that is not an area', () => {
    expect(refused(t8BatchScaling({ mode: 'per area', perArea: '4.0 mg/cm²', area: '2.85 cm', count: '300000' }))).toMatch(/must be an area/);
  });
});

describe('Per-unit value from any number of readings (splitting test)', () => {
  // Loss of mass on splitting (FDA scored-tablet guidance; NMT 3.0 % is a typical setting only):
  // (400.0 − 199.2 − 199.6) ÷ 400.0 = 0.300 %; (401.2 − 198.0 − 199.5) ÷ 401.2 = 0.9222 %; (398.0 − 190.0 − 195.0) ÷ 398.0 = 3.2663 %.
  const units = [['400.0 mg', '199.2 mg', '199.6 mg'], ['401.2 mg', '198.0 mg', '199.5 mg'], ['398.0 mg', '190.0 mg', '195.0 mg']];
  it('C3: per tablet, NMT 3.0 %: the third tablet (3.3 %) fails', () => {
    const r = ok(c3AllIndividual({ units, combine: 'split loss %', band: { limit: { high: '3.0', unit: '%' } } }));
    expect(r.units.map((u) => u.inBand)).toEqual([true, true, false]);
    expect(r.check?.pass).toBe(false);
  });

  it('T7: mean loss over the series = 1.496 %', () => {
    expect(ok(t7Statistics({ units, combine: 'split loss %' })).value.toFixed(3)).toBe('1.496');
  });

  it.each([
    ['sum', [['199.2 mg', '199.6 mg', '0.4 mg']], '399.200'], // parts plus dust
    ['first minus rest', [['400.0 mg', '199.2 mg', '199.6 mg']], '1.200'], // mass lost in mg
  ])('T7: combine %s', (combine, us, want) => {
    expect(ok(t7Statistics({ units: us, combine: combine as 'sum' })).value.toFixed(3)).toBe(want);
  });

  it('C3: refuses parts heavier than the whole tablet', () => {
    expect(refused(c3AllIndividual({ units: [['400.0 mg', '201.0 mg', '200.0 mg']], combine: 'split loss %', band: { limit: { high: '3.0', unit: '%' } } }))).toMatch(/weigh more than the whole/);
  });
});

describe('T8 product of recorded values', () => {
  it.each([
    [['17.5 mm', '7.2 mm', '6.1 mm'], 'mL', 4, '0.7686'], // 768.6 mm³ = 0.7686 mL (tablet envelope volume)
    [['17.5 mm', '7.2 mm', '6.1 mm'], undefined, 1, '768.6'], // in mm³
    [['1.0 cm', '5 mm'], 'cm²', 2, '0.50'], // 10 × 5 = 50 mm² = 0.50 cm²
    [['2', '3', '5 mg'], undefined, 1, '30.0'], // plain numbers times one quantity
  ])('T8: product of %o = %s %s', (factors, unitWanted, d, want) => {
    expect(ok(t8BatchScaling({ mode: 'product', factors, ...(unitWanted === undefined ? {} : { unit: unitWanted }) })).value.toFixed(d as number)).toBe(want);
  });

  it.each([
    [['5 mm'], /two or three/],
    [['5 mm', '3 mg'], /all lengths/],
    [['5 mm', '-3 mm'], /cannot be negative/],
  ])('T8: product refuses %o', (factors, msg) => {
    expect(refused(t8BatchScaling({ mode: 'product', factors }))).toMatch(msg);
  });
});

describe('Units added in round 3', () => {
  it('Units: 60 rpm = 120π rad/min = 376.991 rad/min, and back', () => {
    expect(convert(new Dec(60), unit('rpm'), unit('rad/min')).toFixed(3)).toBe('376.991');
    expect(convert(new Dec('376.99111843'), unit('rad/min'), unit('rpm')).toFixed(3)).toBe('60.000');
  });

  it('Units: 1 kgf = 1 kp = 9.80665 N; kgf/cm² = 98066.5 Pa', () => {
    expect(convert(new Dec(1), unit('kgf'), unit('N')).toString()).toBe('9.80665');
    expect(convert(new Dec('12'), unit('kgf'), unit('kp')).toString()).toBe('12');
    expect(convert(new Dec(1), unit('kgf/cm²'), unit('Pa')).toString()).toBe('98066.5');
  });

  it('Units: Strong-Cobb units never convert (published factors disagree)', () => {
    expect(() => convert(new Dec(10), unit('SCU'), unit('kp'))).toThrow(/Strong-Cobb units \(SCU\) are not converted/);
    expect(refused(c1WithinLimits({ value: '8 SCU', limit: { low: '5', unit: 'kp' } }))).toMatch(/Strong-Cobb/);
    expect(ok(c1WithinLimits({ value: '8 SCU', limit: { low: '5', high: '12', unit: 'SCU' } })).check?.pass).toBe(true);
  });
});
