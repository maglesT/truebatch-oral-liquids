import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { convert, findUnit, unit } from '../../shared/templates/units.js';
import { t6Ratio } from '../../shared/templates/basic.js';
import { t8BatchScaling, t9PotencyAdjusted, t11SaltFactor, t18ContentAdjusted } from '../../shared/templates/dispensing.js';
import { ethanolDensity, ethanolWw, t26MixToTarget } from '../../shared/templates/mixing.js';
import { t22MixPsd, t23CompactStrength, t25AbsoluteHumidity } from '../../shared/templates/physical.js';
import { t14Stratified } from '../../shared/templates/uniformity.js';
import { c1WithinLimits } from '../../shared/templates/series.js';
import { ok, refused } from './helpers.js';

// The new settings of the 1,000-formulation test, waves 1-5 (research summary and part files). Hand checks in Python
// decimal (50 digits). Where a source gives no lot data, the lots are marked "illustrative"; the limits and the
// design (ratios, sizes, batch) are the source's.

describe('Units from the formulation test', () => {
  it.each([
    ['F0476 125 US gal of cyclohexane = 473.176 L (231 in³ exactly)', '125', 'US gal', 'L', '473.176473'],
    ['F0476 an imperial gallon is 20 % larger: 4.54609 ÷ 3.785411784 = 1.20095', '1', 'imp gal', 'US gal', '1.20095'],
    ['F0476 600 cfm = 600 × 28.316846592 L/min = 1019.406 m³/h', '600', 'cfm', 'm³/h', '1019.406477312'],
    ['F0039 0.8 N/mm² = 0.8 MPa', '0.8', 'N/mm²', 'MPa', '0.8'],
    ['F0058 1,500 psi = 10.342136 MPa (psi was added in round 3)', '1500', 'psi', 'MPa', '10.342136'],
  ])('units: %s', (_what, v, from, to, want) => {
    const r = convert(new Dec(v), unit(from), unit(to));
    expect(r.toDecimalPlaces(want.split('.')[1]?.length ?? 0).toString()).toBe(new Dec(want).toString());
  });

  it.each([
    ['F0250 Hz is a drive frequency, never rpm directly', 'Hz', 'rpm', /equipment record/],
    ['F0033 g/m³ of air and g/kg of dry air do not convert', 'g/m³', 'g/kg', /use T25/],
    ['F0393 mEq is never a mass', 'mEq', 'mg', /cannot be converted/],
  ])('units: %s', (_what, from, to, msg) => {
    expect(refused(c1WithinLimits({ value: `1 ${from}`, limit: { high: '2', unit: to } }))).toMatch(msg);
  });

  it('units: F0250 chopper 10-12 Hz becomes rpm only through the equipment record factor (illustrative 30 rpm/Hz): 10 × 30 = 300 rpm', () => {
    const r = ok(t8BatchScaling({ mode: 'product', factors: ['10 Hz', '30 rpm/Hz'] }));
    expect([r.value.toString(), r.unit]).toEqual(['300', 'rpm']);
    expect(ok(c1WithinLimits({ value: '11 Hz', limit: { low: '10', high: '12', unit: 'Hz' } })).check?.pass).toBe(true);
    expect(findUnit('US gallon')?.symbol).toBe('US gal');
    expect(findUnit('gal')).toBeUndefined(); // a bare gallon is ambiguous
  });
});

describe('T26 mix to a target: settings from the formulation test', () => {
  it.each([
    // OIML R 22 at 20 °C: 96 % v/v = 93.84 % w/w, 70 % v/v = 62.39 % w/w, absolute ethanol 789.24 kg/m³
    ['96', '93.84'], ['75', '67.82'], ['70', '62.39'], ['30', '24.61'], ['0', '0.00'], ['100', '100.00'],
  ])('T26 ethanol: %s %% v/v = %s %% w/w at 20 °C (alcoholometric formula)', (vv, ww) => {
    expect(ethanolWw(new Dec(vv)).toFixed(2)).toBe(ww);
    expect(ethanolDensity(new Dec(1)).toString()).toBe('789.2391233');
  });

  it('T26 ethanol F0008: 100 kg of 95 % v/v ethanol to 75 % v/v needs 36.254 kg water (straight % v/v mass balance: 26.667 kg, wrong)', () => {
    // 100 × (67.8202 − 92.4076) ÷ (0 − 67.8202) = 36.2539 kg; 36.2539 kg ÷ 998.2012 kg/m³ = 36.32 L
    const r = ok(t26MixToTarget({ mass: '100.0 kg', a: '95 %', b: '0 %', target: '75 %', scale: 'ethanol % v/v' }));
    expect(r.value.toFixed(3)).toBe('36.254');
    expect(r.donorVolume?.toFixed(2)).toBe('36.32');
    expect(r.shown).toContain('36.32 L at 20 °C');
    expect(ok(t26MixToTarget({ mass: '100.0 kg', a: '95 %', b: '0 %', target: '75 %' })).value.toFixed(3)).toBe('26.667');
  });

  it('T26 ethanol F0250: 30 % v/v from 95 % v/v: 100 kg + 275.533 kg water', () => {
    // 100 × (24.6071 − 92.4076) ÷ (0 − 24.6071) = 275.5329
    expect(ok(t26MixToTarget({ mass: '100 kg', a: '95 %', b: '0 %', target: '30 %', scale: 'ethanol % v/v' })).value.toFixed(3)).toBe('275.533');
  });

  it('T26 basis F0027 sotalol 3:1: racemate (50 % d) + d-sotalol HCl (100 % d) to 75 % d, all as a fraction of total sotalol HCl: 100 kg each', () => {
    const basis = (b: string) => ({ a: 'fraction of total sotalol HCl', b, target: 'fraction of total sotalol HCl' });
    const i = { mass: '100 kg', a: '50.0 %', b: '100.0 %', target: '75.0 %', property: 'd-isomer' };
    expect(ok(t26MixToTarget({ ...i, basis: basis('fraction of total sotalol HCl') })).value.toFixed(3)).toBe('100.000'); // 100 × 25 ÷ 25
    expect(refused(t26MixToTarget({ ...i, basis: basis('% w/w of the lot') }))).toMatch(/not on the same basis.*% w\/w of the lot/);
  });

  // F0450 Rhodiola: target 3.0 % rosavin, salidroside at least 1 % (the source's); the two lots are illustrative.
  const rhodiola = (donorSalidroside: string) => t26MixToTarget({ mass: '100 kg', a: '2.60 %', b: '3.40 %', target: '3.0 %', property: 'rosavin',
    others: [{ name: 'salidroside', a: '1.70 %', b: donorSalidroside, limit: { low: '1.0', unit: '%' } }] });
  it('T26 second marker F0450: mixed to 3.0 % rosavin, salidroside of the mix (170 + 50) ÷ 200 = 1.10 % is shown and checked', () => {
    const r = ok(rhodiola('0.50 %'));
    expect(r.value.toFixed(3)).toBe('100.000'); // 100 × 0.4 ÷ 0.4
    expect(r.others?.[0]?.value.toFixed(2)).toBe('1.10');
    expect(r.shown).toContain('salidroside of the mix 1.10 %');
  });
  it('T26 second marker F0450: a donor that pushes salidroside to (170 + 10) ÷ 200 = 0.90 % is refused (0.95 % would round to 1.0 and pass)', () => {
    expect(ok(rhodiola('0.20 %')).others?.[0]?.check.pass).toBe(true);
    expect(refused(rhodiola('0.10 %'))).toMatch(/puts salidroside out of its limits/);
  });

  it.each([
    ['F0418 D90 of two API lots (percentiles do not mix by mass)', { mass: '93.3 kg', a: '50 µm', b: '77 µm', target: '57 µm', property: 'D90' }, /D90 does not mix by mass: a particle size.*T22/],
    ['hardness', { mass: '100 kg', a: '80 N', b: '120 N', target: '100 N', property: 'hardness' }, /a hardness or force/],
    ['pH', { mass: '100 kg', a: '4.5', b: '6.5', target: '5.0', property: 'pH' }, /pH does not mix by mass: a plain number/],
    ['a second marker that is a size', { mass: '100 kg', a: '2.6 %', b: '3.4 %', target: '3.0 %', others: [{ name: 'D50', a: '20 µm', b: '30 µm', limit: { high: '25', unit: 'µm' } }] }, /D50 does not mix by mass/],
  ])('T26 refuses properties that do not mix by mass: %s', (_what, i, msg) => {
    expect(refused(t26MixToTarget(i))).toMatch(msg);
  });
});

describe('T11 and C5: settings from the formulation test', () => {
  const base = { name: 'capmatinib', mw: '412.43' };
  it('T11 typed salt factor F0062: 1.177 fits the anhydrous dihydrochloride (485.35 ÷ 412.43 = 1.1768): 200 mg → 235.36 mg', () => {
    const r = ok(t11SaltFactor({ quantity: '200 mg', from: base, to: { name: 'capmatinib dihydrochloride', mw: '485.35' }, writtenFactor: '1.177' }));
    expect(r.value.toFixed(2)).toBe('235.36');
  });
  it('T11 typed salt factor F0062: 1.177 on the monohydrate weighed (503.37 ÷ 412.43 = 1.2205) is refused (3.5 % too little drug)', () => {
    expect(refused(t11SaltFactor({ quantity: '200 mg', from: base, to: { name: 'capmatinib dihydrochloride monohydrate', mw: '503.37', hydrateOrSolvate: true }, writtenFactor: '1.177' })))
      .toMatch(/1\.177 as written does not match .* \(factor 1\.2205\)/);
    expect(ok(t11SaltFactor({ quantity: '150 mg', from: base, to: { name: 'monohydrate', mw: '503.37' }, writtenFactor: '1.220' })).value.toFixed(2)).toBe('183.07');
  });

  it('T11 mEq F0393: 10 mEq K ÷ 1 = 10 mmol K; ÷ 3 K per unit × 324.41 = 1081.37 mg potassium citrate monohydrate (3,244 mg if read as mmol of salt)', () => {
    const r = ok(t11SaltFactor({ quantity: '10 mEq', from: { name: 'potassium', mw: '39.098', charge: 1 }, to: { name: 'potassium citrate monohydrate', mw: '324.41', moleculesPerUnit: 3 } }));
    expect([r.value.toFixed(2), r.unit]).toEqual(['1081.37', 'mg']);
    expect(r.shown).toContain('10 mEq potassium ÷ 1 (charge) = 10.000 mmol; ÷ 3 per potassium citrate monohydrate unit × 324.41');
  });
  it('T11 mEq F0393: without the ion charge from the material record it is refused', () => {
    expect(refused(t11SaltFactor({ quantity: '10 mEq', from: { name: 'potassium', mw: '39.098' }, to: { name: 'potassium citrate monohydrate', mw: '324.41', moleculesPerUnit: 3 } })))
      .toMatch(/needs the charge of the ion potassium/);
  });

  it('T11 lot-specific average MW F0018: HP-β-CD at 1:6 molar to 10 mg atorvastatin with the lot MW 1396: 10 × 6 × 1396 ÷ 558.64 = 149.94 mg', () => {
    const i = { quantity: '10 mg', from: { name: 'atorvastatin', mw: '558.64', moleculesPerUnit: 6 }, to: { name: 'HP-β-cyclodextrin', mw: '1400', mwFromLot: true } };
    expect(ok(t11SaltFactor({ ...i, lotMw: '1396' })).value.toFixed(2)).toBe('149.94');
    expect(refused(t11SaltFactor(i))).toMatch(/varies by lot: give it from the lot's certificate/);
  });

  it('C5 hydrate-labelled F0088: procaterol HCl hemihydrate label → anhydrous (factor 0.9739) then a water correction is allowed: 25 µg → 25.12 µg', () => {
    // 25 × 335.83 ÷ 344.84 = 24.3468 µg; × 100 ÷ (99.5 × (100 − 2.6) ÷ 100) = 25.1223 µg
    const t11 = ok(t11SaltFactor({ quantity: '25 µg', from: { name: 'procaterol HCl hemihydrate', mw: '344.84', hydrateOrSolvate: true }, to: { name: 'procaterol HCl', mw: '335.83' } }));
    expect(ok(t9PotencyAdjusted({ standard: t11, assay: '99.5 %', basis: 'anhydrous', water: '2.6 %' })).value.toFixed(2)).toBe('25.12');
    // the other way (anhydrous label to the hemihydrate MW, then a water correction) counts the water twice
    const back = ok(t11SaltFactor({ quantity: '25 µg', from: { name: 'procaterol HCl', mw: '335.83' }, to: { name: 'procaterol HCl hemihydrate', mw: '344.84', hydrateOrSolvate: true } }));
    expect(refused(t9PotencyAdjusted({ standard: back, assay: '99.5 %', basis: 'anhydrous', water: '2.6 %' }))).toMatch(/count the water twice/);
  });

  it('C5 salt-labelled, base-assayed F0434: desmopressin acetate 0.2 mg → base (× 0.9468), divided by the peptide content as base 85.0 %: 0.2228 mg', () => {
    const acetate = { name: 'desmopressin acetate', mw: '1129.27' };
    const peptide = { name: 'desmopressin', mw: '1069.22' };
    const down = ok(t11SaltFactor({ quantity: '0.2 mg', from: acetate, to: peptide }));
    const r = ok(t9PotencyAdjusted({ standard: down, assay: '85.0 %', basis: 'as is', potencyAs: 'parent' }));
    expect(r.value.toFixed(4)).toBe('0.2228');
    expect(r.shown).toContain('the factor ran from the labelled form down to it');
    // a factor up to the salt with a potency already as the parent still counts the salt twice
    const up = ok(t11SaltFactor({ quantity: '0.2 mg', from: peptide, to: acetate }));
    expect(refused(t9PotencyAdjusted({ standard: up, assay: '85.0 %', basis: 'as is', potencyAs: 'parent' }))).toMatch(/factor is already inside it/);
  });

  it('C5 solvate F0201: darunavir ethanolate MW (600 mg → 650.47 mg) with a solvent-free assay basis counts the ethanol twice; as is it passes', () => {
    const t11 = ok(t11SaltFactor({ quantity: '600 mg', from: { name: 'darunavir', mw: '547.66' }, to: { name: 'darunavir ethanolate', mw: '593.73', hydrateOrSolvate: true } }));
    expect(t11.value.toFixed(2)).toBe('650.47');
    expect(refused(t9PotencyAdjusted({ standard: t11, assay: '99.0 %', basis: 'anhydrous and solvent-free', water: '0.5 %', solvents: '7.6 %' })))
      .toMatch(/water or solvent twice \(darunavir ethanolate: about 8\.4 % too much API\)/);
    expect(ok(t9PotencyAdjusted({ standard: t11, assay: '99.0 %', basis: 'as is', assayExpressedAs: 'hydrate' })).value.toFixed(2)).toBe('657.04');
  });
});

describe('T18 content-adjusted quantity: settings from the formulation test', () => {
  const layered = (cpm: string) => t18ContentAdjusted({ target: '7.5 mg', content: '6.43 %', formulaQuantityIs: 'dry', contentSource: 'in-process result',
    second: { name: 'chlorphenamine maleate', content: cpm, target: '3 mg', limit: { low: '95.0', high: '105.0', unit: '%' } } });
  it('T18 two APIs F0187: particles set on phenylephrine HCl 6.43 % (116.64 mg); chlorphenamine maleate 2.58 % gives 3.009 mg = 100.3 %', () => {
    // 7.5 × 100 ÷ 6.43 = 116.6407 mg; × 2.58 % = 3.0093 mg; ÷ 3 = 100.31 %
    const r = ok(layered('2.58 %'));
    expect(r.value.toFixed(2)).toBe('116.64');
    expect(r.second?.percent.toFixed(1)).toBe('100.3');
    expect(r.shown).toContain('chlorphenamine maleate: 116.64 mg × 2.58 % = 3.009 mg = 100.3 % of 3 mg');
  });
  it('T18 two APIs F0187: a particle lot at 2.40 % chlorphenamine (93.3 % of its target) is refused', () => {
    expect(refused(layered('2.40 %'))).toMatch(/93\.3 % of 3 mg.*chlorphenamine maleate is out of its limits/);
  });

  it('T18 % of theoretical F0205: extrudate at 95.3 % of its theoretical 30 % load is 28.59 % w/w: 50 mg → 174.89 mg (52.47 mg if read as content)', () => {
    const r = ok(t18ContentAdjusted({ target: '50 mg', content: '95.3 %', formulaQuantityIs: 'dry', nominalContent: '30 %', resultType: 'percent of theoretical', contentSource: 'in-process result' }));
    expect(r.value.toFixed(2)).toBe('174.89');
    expect(ok(t18ContentAdjusted({ target: '50 mg', content: '95.3 %', formulaQuantityIs: 'dry' })).value.toFixed(2)).toBe('52.47');
    expect(refused(t18ContentAdjusted({ target: '50 mg', content: '95.3 %', formulaQuantityIs: 'dry', resultType: 'percent of theoretical' }))).toMatch(/needs the theoretical content/);
  });
});

describe('T6, T23, T25: settings from the formulation test', () => {
  it('T6 whole containers F0087: 75,000 SQ-U × 300,000 units = 2.25e10 U from vials of 1.2e9 U (illustrative): 18.75 → 19 vials, excess 3e8 U', () => {
    const need = ok(t8BatchScaling({ mode: 'per unit', perUnit: '75000 U', count: '300000 units' }));
    const r = ok(t6Ratio({ mode: 'whole containers', a: { value: need.value.toString(), unit: 'U' }, b: '1.2e9 U' }));
    expect([r.value.toString(), r.excess?.toString()]).toEqual(['19', '300000000']);
    expect(r.shown).toContain('rounded up to 19 containers');
    expect(ok(t6Ratio({ mode: 'whole containers', a: '2.4e10 U', b: '1.2e9 U' })).excess?.isZero()).toBe(true);
    expect(refused(t6Ratio({ mode: 'whole containers', a: '2.4e10 U', b: '1.2 kg' }))).toMatch(/cannot be/);
  });

  it.each([
    ['60 N', '0.99', true], // 60 ÷ (13.5 × 4.5) = 0.9877 N/mm²
    ['45 N', '0.74', false], // 45 ÷ 60.75 = 0.7407 N/mm²
  ])('T23 fracture area F0039: %s on a 13.5 × 4.5 mm tablet = %s N/mm² against "over 0.8 N/mm²"', (force, want, pass) => {
    const r = ok(t23CompactStrength({ mode: 'compact', shape: 'fracture area', force, diameter: '13.5 mm', thickness: '4.5 mm', limit: { low: '0.8', lowStrict: true, unit: 'N/mm²' } }));
    expect([r.value.toFixed(2), r.unit, r.check?.pass]).toEqual([want, 'N/mm²', pass]);
  });

  it('T25 per m³ of air F0033: 50 % RH at 20 °C = 11.663 hPa vapour → 8.62 g/m³, inside the inlet-air limit 6-9 g/m³', () => {
    // e = 0.5 × 23.3260 hPa; ρ = 1166.30 Pa × 18.01528 ÷ (8.314462618 × 293.15) = 8.6204 g/m³
    const r = ok(t25AbsoluteHumidity({ relativeHumidity: '50 %RH', temperature: '20 °C', per: 'm³ air', limit: { low: '6', high: '9', unit: 'g/m³' } }));
    expect([r.value.toFixed(2), r.unit, r.check?.pass]).toEqual(['8.62', 'g/m³', true]);
    expect(refused(c1WithinLimits({ value: '8.6 g/m³', limit: { low: '6', high: '9', unit: 'g/kg' } }))).toMatch(/use T25/);
  });
});

describe('T22 mixed-lot particle size (F0418)', () => {
  // Classes and lots are illustrative; the 93.3 : 6.7 mix and the claim limits D0.5 10-30 µm, D0.9 40-70 µm are the source's.
  const sizes = ['10', '20', '40', '60', '80', '100'];
  const table = (u: string[]) => sizes.map((s, n) => ({ size: `${s} µm`, undersize: `${u[n]} %` }));
  const fine = table(['20', '45', '80', '93', '98', '100']);
  const coarse = table(['5', '15', '40', '60', '80', '100']);
  const limits = { 50: { low: '10', high: '30', unit: 'µm' }, 90: { low: '40', high: '70', unit: 'µm' } };
  it('T22 mix F0418: 93.3 kg fine + 6.7 kg coarse: D0.5 = 24.08 µm, D0.9 = 58.83 µm, both inside the claim', () => {
    // undersize of the mix at 20/40/60 µm: 42.99, 77.32, 90.789 %; D50 = 20 + (50 − 42.99) ÷ 34.33 × 20; D90 = 40 + 12.68 ÷ 13.469 × 20
    const r = ok(t22MixPsd({ lots: [{ name: 'lot A', mass: '93.3 kg', table: fine }, { name: 'lot B', mass: '6.7 kg', table: coarse }], percentiles: ['50', '90'], limits }));
    expect(r.percentiles.map((p) => p.size.toFixed(2))).toEqual(['24.08', '58.83']);
    expect(r.check?.pass).toBe(true);
  });
  it('T22 mix F0418: 50 : 50 gives D0.9 = 81.82 µm, outside 40-70 µm (the coarse lot failed on Cmax)', () => {
    const r = ok(t22MixPsd({ lots: [{ name: 'lot A', mass: '50 kg', table: fine }, { name: 'lot B', mass: '50 kg', table: coarse }], percentiles: ['50', '90'], limits }));
    expect(r.percentiles[1]?.size.toFixed(2)).toBe('81.82');
    expect(r.check?.pass).toBe(false);
  });
  it.each([
    [[{ name: 'lot A', mass: '1 kg', table: fine }], /at least two lots/],
    [[{ name: 'lot A', mass: '1 kg', table: fine }, { name: 'lot B', mass: '1 kg', table: coarse.slice(1) }], /not on the same size classes/],
  ])('T22 mix refuses %#', (lots, msg) => {
    expect(refused(t22MixPsd({ lots, percentiles: ['50'] }))).toMatch(msg);
  });
});

describe('T14 stratified content uniformity (Bergum, F0229)', () => {
  // 20 times × 3 tablets as in the source; the Bergum table is illustrative (the master supplies its own from ASTM E2709).
  const bergum = { n: 60, rows: [{ mean: '95.0', maxRsd: '2.5' }, { mean: '100.0', maxRsd: '4.0' }, { mean: '105.0', maxRsd: '2.5' }] };
  const results = (xs: string[]) => ({ values: Array.from({ length: 20 }, () => xs).flat(), unit: '%' });
  it('T14 stratified F0229: 97/99/101 % × 20: mean 99.00 %, RSD 1.7 % against 3.7 % allowed at that mean (2.5 + 0.8 × 1.5): pass', () => {
    const r = ok(t14Stratified({ results: results(['97.0', '99.0', '101.0']), locations: 20, perLocation: 3, bergum }));
    expect([r.mean.toFixed(2), r.value.toFixed(1), r.allowedRsd?.toFixed(1), r.check?.pass]).toEqual(['99.00', '1.7', '3.7', true]);
  });
  it('T14 stratified F0229: 90/99/108 % × 20: RSD 7.5 % (drum-transfer batches failed the Bergum limit): fail', () => {
    expect(ok(t14Stratified({ results: results(['90.0', '99.0', '108.0']), locations: 20, perLocation: 3, bergum })).check?.pass).toBe(false);
  });
  it('T14 stratified: a mean outside the table fails; the wrong count or table is refused', () => {
    expect(ok(t14Stratified({ results: results(['90.0', '90.0', '90.0']), locations: 20, perLocation: 3, bergum })).check?.pass).toBe(false);
    expect(refused(t14Stratified({ results: results(['99.0', '99.0']), locations: 20, perLocation: 3, bergum }))).toMatch(/is 60 results; 40/);
    expect(refused(t14Stratified({ results: results(['99.0', '99.0', '99.0']), locations: 20, perLocation: 3, bergum: { ...bergum, n: 30 } }))).toMatch(/table is for 30/);
  });
});
