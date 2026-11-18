import { describe, expect, it } from 'vitest';
import {
  c5SameBasis, t8BatchScaling, t9PotencyAdjusted, t10Compensating, t11SaltFactor, t12DryBasis,
  t15Rescale, t16Overage, t18ContentAdjusted, t19Split, t20MultiLot, type C5Input,
} from '../../shared/templates/dispensing.js';
import { ok, refused } from './helpers.js';

// Molecular weights used below are from standard atomic weights (C 12.011, H 1.008, N 14.007, O 15.999,
// S 32.06, Na 22.990, Ca 40.078) or as quoted in the formulation reports; each hand result is in the comment.

describe('T8 Batch scaling', () => {
  it.each([
    [{ mode: 'per unit' as const, perUnit: '478.000 mg', count: '350000 tablets' }, 'kg', '167.300'], // imatinib: 478 mg × 350000 = 167.3 kg
    [{ mode: 'per unit' as const, perUnit: '0.025 mg', count: '500000', unit: 'g' }, 'g', '12.500'], // levothyroxine 25 µg × 500000 = 12.5 g
    [{ mode: 'per unit' as const, perUnit: '3.4531 mg', count: '2000000 tablets' }, 'kg', '6.906'], // aliskiren mini-tablets: 6.9062 kg
    [{ mode: 'per unit' as const, perUnit: '400 IU', count: '200000 tablets' }, 'IU', '80000000.000'], // vitamin D3: 400 IU × 200000 (stays in IU)
    [{ mode: 'percent' as const, percent: '73.65 %', batch: '210.0 kg' }, 'kg', '154.665'], // rucaparib camsylate 73.65 % × 210 kg
    [{ mode: 'percent' as const, percent: '0.25 %w/w', batch: '210.0 kg' }, 'kg', '0.525'], // Mg stearate 0.25 % × 210 kg
    [{ mode: 'rate x time' as const, rate: '10 kg/h', time: '24 h' }, 'kg', '240.000'], // continuous line (formulation 50): 10 kg/h × 24 h
    [{ mode: 'rate x time' as const, rate: '135000 tablets/h', time: '90 min' }, 'units', '202500.000'], // 135000/h × 1.5 h
    [{ mode: 'rate x time' as const, rate: '500 g/min', time: '2 h' }, 'kg', '60.000'], // 0.5 kg/min × 120 min
  ])('T8: %o = %s %s', (i, unit, want) => {
    const r = ok(t8BatchScaling(i));
    expect(r.unit).toBe(unit);
    expect(r.value.toFixed(3)).toBe(want);
  });

  it('T8: shows the worked line', () => {
    expect(ok(t8BatchScaling({ mode: 'per unit', perUnit: '478.000 mg', count: '350000 tablets' })).shown).toBe('478.000 mg × 350000 tablets = 167.300 kg');
  });

  it.each([
    [{ mode: 'per unit' as const, perUnit: '478 mg', count: '350 kg' }, /number of units must be a count/],
    [{ mode: 'percent' as const, percent: '120 %', batch: '210 kg' }, /between 0 and 100/],
    [{ mode: 'rate x time' as const, rate: '10 kg', time: '24 h' }, /mass, volume or count per time/],
    [{ mode: 'rate x time' as const, rate: '10 kg/h', time: '24 kg' }, /must be a time/],
  ])('T8: refuses %o', (i, msg) => {
    expect(refused(t8BatchScaling(i))).toMatch(msg);
  });
});

describe('T11 Salt / base factor (any two named forms)', () => {
  it.each([
    // [case, quantity, from, to, decimals, expected]
    ['imatinib mesylate 400 mg base (formulation 1): 400 × 589.7 ÷ 493.6 = 477.88', '400 mg', { name: 'imatinib', mw: '493.6' }, { name: 'imatinib mesylate', mw: '589.7' }, 2, '477.88'],
    ['quetiapine hemifumarate, MW per quetiapine (formulation 4): 300 × 441.55 ÷ 383.51 = 345.40', '300 mg', { name: 'quetiapine', mw: '383.51' }, { name: 'quetiapine hemifumarate', mw: '441.55' }, 2, '345.40'],
    ['quetiapine fumarate 2:1 with molecules = 2: 300 × (883.10 ÷ 2) ÷ 383.51 = 345.40', '300 mg', { name: 'quetiapine', mw: '383.51' }, { name: 'quetiapine fumarate (2:1)', mw: '883.10', moleculesPerUnit: 2 }, 2, '345.40'],
    ['aliskiren hemifumarate, 2 aliskiren per salt unit (formulation 25): 3.125 × (1219.6 ÷ 2) ÷ 551.8 = 3.4535', '3.125 mg', { name: 'aliskiren', mw: '551.8' }, { name: 'aliskiren hemifumarate', mw: '1219.6', moleculesPerUnit: 2 }, 3, '3.453'],
    ['calcium to calcium carbonate (formulation 8): 500 × 100.09 ÷ 40.08 = 1248.63', '500 mg', { name: 'calcium', mw: '40.08' }, { name: 'calcium carbonate', mw: '100.09' }, 1, '1248.6'],
    ['rucaparib camsylate (formulation 3): 300 × 555.7 ÷ 323.4 = 515.49', '300 mg', { name: 'rucaparib', mw: '323.4' }, { name: 'rucaparib camsylate', mw: '555.7' }, 1, '515.5'],
    ['salt to other salt, both 2 metoprolol per unit (formulation 15): 200 × (652.8/2) ÷ (684.8/2) = 190.65', '200 mg', { name: 'metoprolol tartrate', mw: '684.8', moleculesPerUnit: 2 }, { name: 'metoprolol succinate', mw: '652.8', moleculesPerUnit: 2 }, 1, '190.7'],
    ['pantoprazole to the anhydrous sodium salt: 40 × 405.4 ÷ 383.4 = 42.295', '40 mg', { name: 'pantoprazole', mw: '383.4' }, { name: 'pantoprazole sodium (anhydrous)', mw: '405.4' }, 3, '42.295'],
    ['alendronic acid to anhydrous sodium alendronate (formulation 8, part 2): 70 × 271.08 ÷ 249.10 = 76.177', '70 mg', { name: 'alendronic acid', mw: '249.10' }, { name: 'sodium alendronate (anhydrous)', mw: '271.08' }, 2, '76.18'],
    ['tramadol HCl to the 1:1 cocrystal (formulation 39): 50 × 681.21 ÷ 299.84 = 113.60', '50 mg', { name: 'tramadol HCl', mw: '299.84' }, { name: 'tramadol-celecoxib cocrystal', mw: '681.21' }, 1, '113.6'],
    ['unit conversion: 400 mg base to kg of salt for 350000 tablets is done by T8; T11 keeps the input unit', '0.4 g', { name: 'imatinib', mw: '493.6' }, { name: 'imatinib mesylate', mw: '589.7' }, 4, '0.4779'],
  ])('T11: %s', (_case, quantity, from, to, d, want) => {
    expect(ok(t11SaltFactor({ quantity, from, to })).value.toFixed(d as number)).toBe(want);
  });

  it('T11: aliskiren: leaving molecules per unit at 1 would give double the dose, so it is refused', () => {
    // 3.125 × 1219.6 ÷ 551.8 = 6.9069 mg would be twice the right 3.4535 mg: 1219.6 ÷ 551.8 = 2.21 ≥ 2
    expect(refused(t11SaltFactor({ quantity: '3.125 mg', from: { name: 'aliskiren', mw: '551.8' }, to: { name: 'aliskiren hemifumarate', mw: '1219.6' } })))
      .toBe('aliskiren hemifumarate is a hemi-salt and its molecular weight 1219.6 is that of the whole formula unit, which carries 2 drug molecules. Set 2 molecules per formula unit, or the dose would be doubled');
    // the reverse direction, and a hemihydrate (water, not drug molecules) is not a hemi-salt
    expect(refused(t11SaltFactor({ quantity: '3.125 mg', from: { name: 'aliskiren hemifumarate', mw: '1219.6' }, to: { name: 'aliskiren', mw: '551.8' } }))).toMatch(/hemi-salt/);
    expect(t11SaltFactor({ quantity: '1 mg', from: { name: 'x', mw: '100' }, to: { name: 'x calcium hemipentahydrate', mw: '250' } }).ok).toBe(true);
    const right = ok(t11SaltFactor({ quantity: '3.125 mg', from: { name: 'aliskiren', mw: '551.8' }, to: { name: 'aliskiren hemifumarate', mw: '1219.6', moleculesPerUnit: 2 } }));
    expect(right.value.toFixed(4)).toBe('3.4535');
    expect(right.shown).toContain('(1219.6 ÷ 2)');
    expect(right.shown).toContain('2 molecules per aliskiren hemifumarate unit');
  });

  it('T11: records whether the MW includes water of crystallisation, for C5', () => {
    const r = ok(t11SaltFactor({ quantity: '40 mg', from: { name: 'pantoprazole', mw: '383.4' }, to: { name: 'pantoprazole sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true } }));
    expect(r.form.hydrateOrSolvate).toBe(true);
    expect(r.value.toFixed(2)).toBe('45.11'); // 40 × 432.4 ÷ 383.4 = 45.112
  });

  it.each([
    [{ quantity: '40 mg', from: { name: 'a', mw: '0' }, to: { name: 'b', mw: '100' } }, /more than zero/],
    [{ quantity: '40 mg', from: { name: 'a', mw: '383.4' }, to: { name: 'b', mw: '405.4', moleculesPerUnit: 1.5 } }, /whole number/],
    [{ quantity: '40 mg', from: { name: 'a', mw: '383.4' }, to: { name: 'b', mw: '405.4', moleculesPerUnit: 0 } }, /whole number/],
    [{ quantity: '40 IU', from: { name: 'a', mw: '383.4' }, to: { name: 'b', mw: '405.4' } }, /must be a mass/],
  ])('T11: refuses %o', (i, msg) => {
    expect(refused(t11SaltFactor(i))).toMatch(msg);
  });
});

describe('T9 Potency-adjusted quantity and C5 same basis', () => {
  const pantoBase = { name: 'pantoprazole', mw: '383.4' };

  it('T9+T11 pantoprazole sesquihydrate, assay 99.0 % anhydrous, water 6.5 % → 45.69 mg; double count refused (formulation 5)', () => {
    // Hand check: anhydrous salt 40 × 405.4 ÷ 383.4 = 42.2953 mg; assay as is 99.0 × (100 − 6.5) ÷ 100 = 92.565 %;
    // 42.2953 × 100 ÷ 92.565 = 45.6925 mg.
    const salt = ok(t11SaltFactor({ quantity: '40 mg', from: pantoBase, to: { name: 'pantoprazole sodium', mw: '405.4' } }));
    const r = ok(t9PotencyAdjusted({ standard: salt, assay: '99.0 %', basis: 'anhydrous', water: '6.5 %' }));
    expect(r.value.toFixed(2)).toBe('45.69');
    expect(r.assayAsIs.toFixed(3)).toBe('92.565');
    // Wrong chain: sesquihydrate MW (45.112 mg) then a water correction would give 45.112 × 100 ÷ 92.565 = 48.74 mg (6.7 % too much).
    const hyd = ok(t11SaltFactor({ quantity: '40 mg', from: pantoBase, to: { name: 'pantoprazole sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true } }));
    const msg = refused(t9PotencyAdjusted({ standard: hyd, assay: '99.0 %', basis: 'anhydrous', water: '6.5 %' }));
    expect(msg).toMatch(/count the water twice/);
    expect(msg).toMatch(/6\.7 %/);
  });

  it('T9: pantoprazole: the hydrate weight with an as-is assay expressed as the anhydrous substance is also refused', () => {
    expect(refused(t9PotencyAdjusted({ standard: '45.1 mg', standardIs: 'hydrate or solvate', assay: '92.565 %', basis: 'as is' }))).toMatch(/counted twice/);
  });

  it('T9: pantoprazole: the hydrate weight with an as-is assay stated as the hydrate is accepted', () => {
    // 45.112 mg × 100 ÷ 98.8 % = 45.66 mg
    expect(ok(t9PotencyAdjusted({ standard: '45.112 mg', standardIs: 'hydrate or solvate', assay: '98.8 %', basis: 'as is', assayExpressedAs: 'hydrate' })).value.toFixed(2)).toBe('45.66');
  });

  it('T9: alendronate (part 2, formulation 8): 76.18 mg anhydrous salt at 100 % and theoretical 16.6 % water → 91.34 mg; trihydrate MW + water refused', () => {
    // 70 × 271.08 ÷ 249.10 = 76.1766; as-is assay 100 × 83.4 ÷ 100 = 83.4 %; 76.1766 ÷ 0.834 = 91.339 mg.
    // (The report says 91.35 mg; with 16.6 % water it is 91.34 mg, with 16.62 % it is 91.36 mg.)
    const salt = ok(t11SaltFactor({ quantity: '70 mg', from: { name: 'alendronic acid', mw: '249.10' }, to: { name: 'sodium alendronate', mw: '271.08' } }));
    expect(ok(t9PotencyAdjusted({ standard: salt, assay: '100.0 %', basis: 'anhydrous', water: '16.6 %' })).value.toFixed(2)).toBe('91.34');
    const tri = ok(t11SaltFactor({ quantity: '70 mg', from: { name: 'alendronic acid', mw: '249.10' }, to: { name: 'sodium alendronate trihydrate', mw: '325.12', hydrateOrSolvate: true } }));
    expect(refused(t9PotencyAdjusted({ standard: tri, assay: '100.0 %', basis: 'anhydrous', water: '16.6 %' }))).toMatch(/Same-basis rule/);
  });

  it.each([
    // [case, input, expected at 3 dp]
    ['levothyroxine 12.5 g, assay 98.0 % anhydrous, water 9.0 % (formulation 2): 12.5 × 100 ÷ 89.18 = 14.017 g', { standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98.0 %', basis: 'anhydrous' as const, water: '9.0 %' }, '14.017'],
    ['imatinib mesylate, dried basis LOD 0.4 %, assay 99.6 %: 167.300 × 100 ÷ 99.2016 = 168.646 kg', { standard: '167.300 kg', standardIs: 'anhydrous' as const, assay: '99.6 %', basis: 'dried' as const, lod: '0.4 %' }, '168.646'],
    ['as is basis: 24.000 kg × 100 ÷ 99.5 = 24.121 kg', { standard: '24.000 kg', standardIs: 'anhydrous' as const, assay: '99.5 %', basis: 'as is' as const }, '24.121'],
    ['ivermectin, anhydrous and solvent-free (formulation 2, round 2): assay 98.5 %, water 0.8 %, solvents 2.4 %: as is 98.5 × 96.8 ÷ 100 = 95.348 %; 1.800 kg × 100 ÷ 95.348 = 1.888 kg', { standard: '1.800 kg', standardIs: 'anhydrous' as const, assay: '98.5 %', basis: 'anhydrous and solvent-free' as const, water: '0.8 %', solvents: '2.4 %' }, '1.888'],
    ['assay above 100 % used: 10.000 kg × 100 ÷ 100.8 = 9.921 kg', { standard: '10.000 kg', standardIs: 'anhydrous' as const, assay: '100.8 %', basis: 'as is' as const }, '9.921'],
    ['assay above 100 % treated as 100 when the master says so: 10.000 kg', { standard: '10.000 kg', standardIs: 'anhydrous' as const, assay: '100.8 %', basis: 'as is' as const, assayAbove100: 'treat as 100' as const }, '10.000'],
  ])('T9: %s', (_case, i, want) => {
    expect(ok(t9PotencyAdjusted(i)).value.toFixed(3)).toBe(want);
  });

  it('T9: ivermectin solvent-free: the worked line shows the as-is assay', () => {
    const r = ok(t9PotencyAdjusted({ standard: '1.800 kg', standardIs: 'anhydrous', assay: '98.5 %', basis: 'anhydrous and solvent-free', water: '0.8 %', solvents: '2.4 %' }));
    expect(r.assayAsIs.toFixed(3)).toBe('95.348');
    expect(r.shown).toBe('assay as is = 98.5 % × (100 − 0.8 % − 2.4 %) ÷ 100 = 95.348 %; 1.800 kg × 100 ÷ 95.348 % = 1.888 kg');
  });

  it.each([
    // "As parent" potency: the salt/ester/hydrate factor is inside the µg/mg figure.
    // Factors from atomic weights: azithromycin C38H72N2O12 748.996, dihydrate 785.026 → 1.0481;
    // cefuroxime C16H16N4O8S 424.384, cefuroxime axetil C20H22N4O10S 510.474 → 1.2029;
    // faropenem C12H15NO5S 285.314, faropenem sodium hemipentahydrate 352.334 → 1.2349.
    ['azithromycin dihydrate (round 3, no. 84), 950 µg/mg as parent: 500 mg × 1000 ÷ 950 = 526.32 mg', '500 mg', '950 µg/mg', { name: 'azithromycin', mw: '748.996' }, { name: 'azithromycin dihydrate', mw: '785.026', hydrateOrSolvate: true }, '526.32', '551.63'],
    ['cefuroxime axetil (round 3, no. 86), 820 µg/mg as parent: 500 mg × 1000 ÷ 820 = 609.76 mg', '500 mg', '820 µg/mg', { name: 'cefuroxime', mw: '424.384' }, { name: 'cefuroxime axetil', mw: '510.474' }, '609.76', '733.45'],
    ['faropenem sodium (round 3, no. 98), 790 µg/mg as parent: 200 mg × 1000 ÷ 790 = 253.16 mg', '200 mg', '790 µg/mg', { name: 'faropenem', mw: '285.314' }, { name: 'faropenem sodium hemipentahydrate', mw: '352.334', hydrateOrSolvate: true }, '253.16', '312.63'],
  ])('T9: %s; chaining T11 is refused (it would give %s → %s mg)', (_case, parent, potency, from, to, right, wouldBe) => {
    expect(ok(t9PotencyAdjusted({ standard: parent, assay: potency, basis: 'as is', potencyAs: 'parent' as const })).value.toFixed(2)).toBe(right);
    const salt = ok(t11SaltFactor({ quantity: parent, from, to }));
    // what the wrong chain would weigh (hand check: parent × factor × 1000 ÷ potency)
    expect(salt.value.times(1000).div(potency.split(' ')[0] ?? '1').toFixed(2)).toBe(wouldBe);
    const msg = refused(t9PotencyAdjusted({ standard: salt, assay: potency, basis: 'as is', potencyAs: 'parent' as const }));
    expect(msg).toMatch(/stated as the parent drug/);
    expect(msg).toMatch(/overstate the dose/);
  });

  it('T9: as parent: amoxicillin trihydrate, potency 865 µg/mg on the anhydrous basis, water 13.0 %', () => {
    // as is 86.5 × 87.0 ÷ 100 = 75.255 %; 875 mg × 100 ÷ 75.255 = 1162.71 mg (formulation 35)
    const r = ok(t9PotencyAdjusted({ standard: '875 mg', assay: '865 µg/mg', basis: 'anhydrous', water: '13.0 %', potencyAs: 'parent' as const }));
    expect(r.value.toFixed(2)).toBe('1162.71');
    expect(r.shown).toContain('stated as the parent drug');
  });

  it('T9: as parent: a hydrate weight as the standard is refused', () => {
    expect(refused(t9PotencyAdjusted({ standard: '524 mg', standardIs: 'hydrate or solvate', assay: '950 µg/mg', basis: 'as is', potencyAs: 'parent' as const }))).toMatch(/must be the parent amount/);
  });

  it.each([
    [{ standard: '12.5 g', assay: '98.0 %', basis: 'anhydrous' as const, water: '9.0 %' }, /Say whether the standard quantity is the anhydrous/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98.0 %', basis: 'anhydrous' as const }, /needs the lot's water content/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '0 %', basis: 'as is' as const }, /more than zero/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98 %', basis: 'dried' as const, lod: '100 %' }, /less than 100/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98 %', basis: 'dried' as const, lod: '-1 %' }, /from 0/],
    [{ standard: '400 IU', standardIs: 'anhydrous' as const, assay: '98 %', basis: 'as is' as const }, /must be a mass/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98 %', basis: 'anhydrous and solvent-free' as const, water: '60 %', solvents: '40 %' }, /less than 100/],
    [{ standard: '12.5 g', standardIs: 'anhydrous' as const, assay: '98 %', basis: 'as is' as const, assayExpressedAs: 'hydrate' as const }, /would not be counted/],
  ])('T9: refuses %o', (i, msg) => {
    expect(refused(t9PotencyAdjusted(i))).toMatch(msg);
  });

  it.each([
    [{ standardIs: 'anhydrous', basis: 'anhydrous' }, true],
    [{ standardIs: 'anhydrous', basis: 'as is' }, true],
    [{ standardIs: 'hydrate or solvate', basis: 'as is', assayExpressedAs: 'hydrate' }, true],
    [{ standardIs: 'hydrate or solvate', basis: 'anhydrous' }, false],
    [{ standardIs: 'hydrate or solvate', basis: 'dried' }, false],
    [{ standardIs: 'hydrate or solvate', basis: 'anhydrous and solvent-free' }, false],
    [{ standardIs: 'hydrate or solvate', basis: 'as is' }, false],
    [{ standardIs: 'anhydrous', basis: 'as is', assayExpressedAs: 'hydrate' }, false],
    [{ standardIs: 'anhydrous', basis: 'as is', potencyAs: 'parent' }, true],
    [{ standardIs: 'anhydrous', basis: 'as is', potencyAs: 'parent', saltFactorInChain: true }, false],
  ] as [C5Input, boolean][])('C5 standalone %o → same basis %s', (i, same) => {
    expect(c5SameBasis(i).ok).toBe(same);
  });
});

describe('T10 Compensating excipient', () => {
  it('T10: levothyroxine (formulation 2): MCC reduced by the extra API, 54.265 kg − (14.0166 − 12.5) g = 54.263483 kg', () => {
    const r = ok(t10Compensating({ fillers: [{ name: 'MCC', standard: '54.265 kg' }], adjusted: [{ name: 'levothyroxine', standard: '12.500 g', adjusted: '14.0166 g' }] }));
    expect(r.value.toFixed(6)).toBe('54.263483');
  });

  it('T10: rucaparib (formulation 3): spread over MCC and dicalcium phosphate 13.23 : 5.63', () => {
    // excess 157.200 − 154.665 = 2.535 kg; MCC share 2.535 × 13.23 ÷ 18.86 = 1.77826 → 26.00474; DCP 11.823 − 0.75674 = 11.06626
    const r = ok(t10Compensating({ fillers: [{ name: 'MCC', standard: '27.783 kg', ratio: '13.23' }, { name: 'DCP', standard: '11.823 kg', ratio: '5.63' }], adjusted: [{ name: 'rucaparib camsylate', standard: '154.665 kg', adjusted: '157.200 kg' }] }));
    expect(r.fillers.map((f) => f.value.toFixed(5))).toEqual(['26.00474', '11.06626']);
    expect(r.value.toFixed(3)).toBe('37.071'); // 39.606 − 2.535
  });

  it('T10: several adjusted materials into one filler, excesses + and − (formulations 7, 9, 34, 35, 38)', () => {
    // valsartan +0.250, HCTZ −0.030, amlodipine +0.012 kg → excess 0.232; MCC 30.000 − 0.232 = 29.768 kg
    const r = ok(t10Compensating({
      fillers: [{ name: 'MCC', standard: '30.000 kg' }],
      adjusted: [
        { name: 'valsartan', standard: '48.000 kg', adjusted: '48.250 kg' },
        { name: 'HCTZ', standard: '3.750 kg', adjusted: '3.720 kg' },
        { name: 'amlodipine besylate', standard: '2.080 kg', adjusted: '2.092 kg' },
      ],
    }));
    expect(r.excess.toFixed(3)).toBe('0.232');
    expect(r.value.toFixed(3)).toBe('29.768');
  });

  it('T10: a filler that ends at exactly zero is allowed', () => {
    expect(ok(t10Compensating({ fillers: [{ name: 'MCC', standard: '3.000 kg' }], adjusted: [{ name: 'valsartan', standard: '24.000 kg', adjusted: '27.000 kg' }] })).value.isZero()).toBe(true);
  });

  it('T10: valsartan (formulation 3): a large correction on a 3 kg filler is refused (negative filler)', () => {
    // 24 kg at 85 % → 28.2353 kg; excess 4.2353 > 3.000 kg MCC
    const msg = refused(t10Compensating({ fillers: [{ name: 'Avicel PH-301', standard: '3.000 kg' }], adjusted: [{ name: 'valsartan', standard: '24.000 kg', adjusted: '28.2353 kg' }] }));
    expect(msg).toMatch(/Not enough Avicel PH-301 to compensate/);
    expect(msg).toMatch(/-1\.235 kg/);
  });

  it.each([
    [{ fillers: [], adjusted: [{ name: 'a', standard: '1 kg', adjusted: '1.1 kg' }] }, /Name the filler/],
    [{ fillers: [{ name: 'MCC', standard: '1 kg' }], adjusted: [] }, /adjusted material/],
    [{ fillers: [{ name: 'MCC', standard: '1 L' }], adjusted: [{ name: 'a', standard: '1 kg', adjusted: '1.1 kg' }] }, /must be a mass/],
  ])('T10: refuses %o', (i, msg) => {
    expect(refused(t10Compensating(i))).toMatch(msg);
  });
});

describe('T12 Quantity from dry basis', () => {
  it.each([
    ['dry to as is', '205.800 kg', '2.0 %', '210.000'], // 205.8 × 100 ÷ 98 = 210.0
    ['as is to dry', '210.000 kg', '2.0 %', '205.800'], // 210 × 98 ÷ 100
    ['dry to as is', '784 mg', '3.0 %', '808.247'], // quetiapine granule at 3 % LOD: 784 ÷ 0.97 = 808.2474
  ])('T12: %s: %s at LOD %s = %s', (mode, quantity, lod, want) => {
    expect(ok(t12DryBasis({ mode: mode as 'dry to as is', quantity, lod })).value.toFixed(3)).toBe(want);
  });

  it.each([['100 %'], ['-0.5 %'], ['5 kg']])('T12: refuses LOD %s', (lod) => {
    expect(t12DryBasis({ mode: 'dry to as is', quantity: '1 kg', lod }).ok).toBe(false);
  });
});

describe('T15 Re-scale to actual yield', () => {
  it('T15: imatinib (formulation 1): Mg stearate 1.960 kg × 203.450 ÷ 205.800 = 1.938 kg', () => {
    // 1.96 × 0.988581 = 1.937619
    expect(ok(t15Rescale({ formulaQuantity: '1.960 kg', actual: '203.450 kg', theoretical: '205.800 kg' })).value.toFixed(5)).toBe('1.93762');
  });

  it.each([
    ['185.000 kg', false], // 185 ÷ 205.8 = 89.893 % → 89.9, below 90.0
    ['185.211 kg', true], // 89.9956 % → 90.0
    ['209.916 kg', true], // exactly 102.0000 %
    ['210.000 kg', true], // 102.0408 % → 102.0
    ['210.020 kg', false], // 102.0505 % → 102.1
  ])('T15: window 90.0-102.0 %%: actual %s → re-scaled %s', (actual, allowed) => {
    expect(t15Rescale({ formulaQuantity: '1.960 kg', actual, theoretical: '205.800 kg', window: { low: '90.0', high: '102.0' } }).ok).toBe(allowed);
  });

  it('T15: outside the window is refused with a plain message', () => {
    // 211 ÷ 205.8 = 102.527 % → 102.5 > 102.0
    expect(refused(t15Rescale({ formulaQuantity: '1.960 kg', actual: '211.000 kg', theoretical: '205.800 kg', window: { low: '90.0', high: '102.0' } }))).toMatch(/102\.5 % of theoretical, outside the window/);
  });
});

describe('T16 Overage', () => {
  it.each([
    ['11.421 kg', '1 %', '11.535210', '0.114210'], // alendronate +1 % (part 2, formulation 8): patent "11.421 kg (+0.114)"
    ['2000 IU', '35 %', '2700.000000', '700.000000'], // vitamin A +35 % (formulation 9), in IU
    ['10 mg', '0 %', '10.000000', '0.000000'],
  ])('T16: %s + %s = %s (overage %s)', (quantity, ov, want, extra) => {
    const r = ok(t16Overage({ quantity, overagePercent: ov }));
    expect(r.value.toFixed(6)).toBe(want);
    expect(r.overage.toFixed(6)).toBe(extra);
  });

  it.each([
    [{ quantity: '10 mg', overagePercent: '-1 %' }, /cannot be negative/],
    [{ quantity: '10 mg', overagePercent: '25 %', maxOveragePercent: '20 %' }, /above the 20 %/],
  ])('T16: refuses %o', (i, msg) => {
    expect(refused(t16Overage(i))).toMatch(msg);
  });
});

describe('T18 Content-adjusted quantity (any material)', () => {
  it.each([
    ['Eudragit L 30 D at 30 % solids (formulation 5): 13.64 mg dry polymer × 100 ÷ 30.0 = 45.467 mg dispersion', { target: '13.64 mg', content: '30.0 %', formulaQuantityIs: 'dry' as const }, 3, '45.467'],
    ['the same per batch: 4.092 kg × 100 ÷ 30.0 = 13.640 kg', { target: '4.092 kg', content: '30.0 %w/w', formulaQuantityIs: 'dry' as const }, 3, '13.640'],
    ['lanthanum by lot (part 2, formulation 9): 75.0 kg La × 100 ÷ 52.4 = 143.130 kg', { target: '75.0 kg', content: '52.4 %', formulaQuantityIs: 'dry' as const }, 3, '143.130'],
    ['vitamin D3 400 IU at 100,000 IU/g (formulation 8): 400 ÷ 100000 g = 4.000 mg', { target: '400 IU', content: '100000 IU/g', formulaQuantityIs: 'dry' as const }, 3, '4.000'],
    ['vitamin A 2700 IU (2000 + 35 %) at 500,000 IU/g (formulation 9): 5.400 mg', { target: '2700 IU', content: '500000 IU/g', formulaQuantityIs: 'dry' as const }, 3, '5.400'],
    ['vitamin E 110 IU × 2.1 mg/IU (formulation 9): 231.000 mg', { target: '110 IU', content: '2.1 mg/IU', formulaQuantityIs: 'dry' as const }, 3, '231.000'],
    ['folic acid 10 % triturate, 0.5 mg (400 µg + 25 %) (formulation 9): 0.5 × 100 ÷ 10 = 5.000 mg', { target: '0.5 mg', content: '10 %', formulaQuantityIs: 'dry' as const }, 3, '5.000'],
    ['probiotic (formulation 36): 9e14 CFU ÷ 3e11 CFU/g = 3000 g = 3.000 kg', { target: '9e14 CFU', content: '3e11 CFU/g', formulaQuantityIs: 'dry' as const, unit: 'kg' }, 3, '3.000'],
    ['pancreatin (formulation 37): 36000 U ÷ 45 U/mg = 800 mg', { target: '36000 U', content: '45 U/mg', formulaQuantityIs: 'dry' as const }, 1, '800.0'],
    ['wet formula quantity: Opaspray 2.57 mg written at 33 % solids, lot at 35 %: 2.57 × 33 ÷ 35 = 2.423 mg (formulation 40)', { target: '2.57 mg', content: '35 %', formulaQuantityIs: 'wet' as const, nominalContent: '33 %' }, 3, '2.423'],
    ['ivacaftor SDD at 80 % (formulation 50): 125 mg ÷ 0.80 = 156.25 mg, content from an in-process result', { target: '125 mg', content: '80.0 %', formulaQuantityIs: 'dry' as const, contentSource: 'in-process result' as const }, 2, '156.25'],
  ])('T18: %s', (_case, i, d, want) => {
    expect(ok(t18ContentAdjusted(i)).value.toFixed(d)).toBe(want);
  });

  it('T18: records the content source on the line', () => {
    expect(ok(t18ContentAdjusted({ target: '125 mg', content: '80.0 %', formulaQuantityIs: 'dry', contentSource: 'in-process result' })).shown).toContain('content from the in-process result');
  });

  it.each([
    // IU / CFU / activity units are never converted to mass with a %
    [{ target: '400 IU', content: '10 %', formulaQuantityIs: 'dry' as const }, /cannot be turned into a mass with a % content/],
    [{ target: '9e14 CFU', content: '3e11 IU/g', formulaQuantityIs: 'dry' as const }, /must be in IU/],
    [{ target: '36000 IU', content: '45 U/mg', formulaQuantityIs: 'dry' as const }, /must be in U/],
    [{ target: '400 IU', content: '100000 IU/g', formulaQuantityIs: 'dry' as const, unit: 'IU' }, /must be a mass/],
    [{ target: '13.64 mg', content: '0 %', formulaQuantityIs: 'dry' as const }, /more than zero/],
    [{ target: '13.64 mg', content: '130 %', formulaQuantityIs: 'dry' as const }, /cannot be above 100/],
    [{ target: '2.57 mg', content: '35 %', formulaQuantityIs: 'wet' as const }, /nominal content/],
    [{ target: '13.64 mg', content: '30 rpm', formulaQuantityIs: 'dry' as const }, /must be a % or a content per mass/],
  ])('T18: refuses %o', (i, msg) => {
    expect(refused(t18ContentAdjusted(i))).toMatch(msg);
  });
});

describe('T19 Split into portions', () => {
  it('T19: crospovidone intra / extra-granular, last = what is left (formulation 5)', () => {
    // 15.000 kg: 60 % intra = 9.000, rest 6.000
    const r = ok(t19Split({ total: '15.000 kg', portions: [{ name: 'intragranular', percent: '60 %' }, { name: 'extragranular' }] }));
    expect(r.portions.map((p) => p.value.toFixed(3))).toEqual(['9.000', '6.000']);
    expect(r.check?.pass).toBe(true);
  });

  it('T19: povidone 45 mg = 20 mg dry + 25 mg for solution (formulation 8), with a fixed part and the remainder', () => {
    const r = ok(t19Split({ total: '9.000 kg', portions: [{ name: 'dry', fixed: '4.000 kg' }, { name: 'solution', remainder: true }] }));
    expect(r.value.toFixed(3)).toBe('5.000');
  });

  it('T19: geometric dilution of MCC after compensation (formulation 2): portions of 12.5 g, 25 g, 50 g, rest', () => {
    // 54263.483 g − 87.5 g = 54175.983 g
    const r = ok(t19Split({ total: '54.263483 kg', unit: 'g', portions: [{ name: 'step 1', fixed: '12.5 g' }, { name: 'step 2', fixed: '25 g' }, { name: 'step 3', fixed: '50 g' }, { name: 'rest' }] }));
    expect(r.value.toFixed(3)).toBe('54175.983');
  });

  it.each([
    [{ total: '10 kg', portions: [{ name: 'a', percent: '70 %' }, { name: 'b', percent: '40 %' }, { name: 'c' }] }, /more than the total/],
    [{ total: '10 kg', portions: [{ name: 'a', percent: '70 %' }, { name: 'b', percent: '30 %' }] }, /Exactly one portion/],
    [{ total: '10 kg', portions: [{ name: 'a' }, { name: 'b' }] }, /Exactly one portion/],
    [{ total: '10 kg', portions: [{ name: 'a', fixed: '2 L' }, { name: 'b' }] }, /cannot be converted/],
  ])('T19: refuses %o', (i, msg) => {
    expect(refused(t19Split(i))).toMatch(msg);
  });
});

describe('T20 Multi-lot quantity', () => {
  it('T20: lanthanum from two lots (part 2, formulation 9): all of lot A, the rest from lot B', () => {
    // lot A 100.0 kg × 52.4 % = 52.40 kg La; rest 75.0 − 52.4 = 22.60 kg La; lot B 22.6 × 100 ÷ 51.9 = 43.54528 kg; total 143.54528 kg
    const r = ok(t20MultiLot({ required: '75.0 kg', lots: [{ name: 'lot A', weighed: '100.0 kg', content: '52.4 %' }, { name: 'lot B', content: '51.9 %' }] }));
    expect(r.value.toFixed(5)).toBe('43.54528');
    expect(r.totalWeighed.toFixed(5)).toBe('143.54528');
    expect(r.pure.map((p) => p.value.div(1e6).toFixed(2))).toEqual(['52.40', '22.60']); // in mg → kg
  });

  it('T20: pancreatin amylase delivered from one lot (formulation 37): 80 kg × 50 U/mg = 4e9 U', () => {
    const r = ok(t20MultiLot({ lots: [{ name: 'lot 1', weighed: '80.000 kg', content: '50 U/mg' }] }));
    expect(r.unit).toBe('U');
    expect(r.value.toString()).toBe('4000000000');
  });

  it('T20: lot A alone gives more than needed: refused', () => {
    expect(refused(t20MultiLot({ required: '50.0 kg', lots: [{ name: 'lot A', weighed: '100.0 kg', content: '52.4 %' }, { name: 'lot B', content: '51.9 %' }] }))).toMatch(/weigh less from lot A/);
  });

  it.each([
    [{ required: '75 kg', lots: [{ name: 'A', weighed: '10 kg', content: '52 %' }, { name: 'B', content: '45 U/mg' }] }, /same kind of unit/],
    [{ required: '75 kg', lots: [{ name: 'A', content: '52 %' }, { name: 'B', content: '51 %' }] }, /Give the quantity weighed from A/],
    [{ required: '75 kg', lots: [{ name: 'A', weighed: '10 kg', content: '0 %' }] }, /more than zero/],
  ])('T20: refuses %o', (i, msg) => {
    expect(refused(t20MultiLot(i))).toMatch(msg);
  });
});
