import { describe, expect, it } from 'vitest';
import { t17LiquidMakeUp } from '../../shared/templates/liquid.js';
import { ok, refused } from './helpers.js';

describe('T17 Liquid make-up, by weight', () => {
  it.each([
    [
      'film coat premix 6.300 kg + 20 % overage at 15 % solids (formulation 1): solids 7.560, total 50.400, water 42.840 kg',
      { mode: 'w/w' as const, dry: [{ name: 'Opadry yellow', quantity: '5.985 kg' }, { name: 'Opadry red', quantity: '0.315 kg' }], overagePercent: '20 %', targetSolids: '15 %' },
      ['7.560', '50.400', '42.840'],
    ],
    [
      'povidone binder 5.000 kg at 10 % (formulation 8): total 50.000, water 45.000 kg (as the report)',
      { mode: 'w/w' as const, dry: [{ name: 'povidone K30', quantity: '5.000 kg' }], targetSolids: '10 %' },
      ['5.000', '50.000', '45.000'],
    ],
    [
      'Eudragit L 30 D 13.640 kg (30 % solids) + TEC 0.408 kg at 20 % (formulation 5): solids 4.500, total 22.500, water 8.452 kg',
      { mode: 'w/w' as const, dry: [{ name: 'triethyl citrate', quantity: '0.408 kg' }], liquids: [{ name: 'Eudragit L 30 D', quantity: '13.640 kg', solidsPercent: '30 %' }], targetSolids: '20 %' },
      ['4.500', '22.500', '8.452'],
    ],
    [
      'sugar sub-coating syrup, sugar 85.0 + gum arabic 5.0 kg at 66.7 % (formulation 4): total 90 × 100 ÷ 66.7 = 134.933, water 44.933 kg',
      { mode: 'w/w' as const, dry: [{ name: 'sugar', quantity: '85.0 kg' }, { name: 'gum arabic', quantity: '5.0 kg' }], targetSolids: '66.7 %' },
      ['90.000', '134.933', '44.933'],
    ],
    [
      'insulating syrup A, sugar 10 kg at 80 % (formulation 37): total 12.5, water 2.5 kg (patent: 10 kg in 2.5 kg water)',
      { mode: 'w/w' as const, dry: [{ name: 'sugar', quantity: '10 kg' }], targetSolids: '80 %' },
      ['10.000', '12.500', '2.500'],
    ],
    [
      'a liquid ingredient by volume via its density: 10 L dispersion at 1.05 g/mL (10.5 kg, 30 % solids) to 20 %: total 15.75, water 5.25 kg',
      { mode: 'w/w' as const, dry: [], liquids: [{ name: 'dispersion', quantity: '10 L', density: '1.05 g/mL', solidsPercent: '30 %' }], targetSolids: '20 %' },
      ['3.150', '15.750', '5.250'],
    ],
  ])('T17: %s', (_case, i, [solids, total, water]) => {
    const r = ok(t17LiquidMakeUp(i));
    expect(r.totalSolids.toFixed(3)).toBe(solids);
    expect(r.totalLiquid.toFixed(3)).toBe(total);
    expect(r.value.toFixed(3)).toBe(water);
  });

  it('T17: per tablet, in mg (formulation 5): 45.467 mg dispersion + 1.36 mg TEC at 20 % → 28.173 mg water', () => {
    // 15.00 mg solids → 75.00 mg total; 75 − 1.36 − 45.4667 = 28.1733
    const r = ok(t17LiquidMakeUp({ mode: 'w/w', dry: [{ name: 'TEC', quantity: '1.36 mg' }], liquids: [{ name: 'Eudragit L 30 D', quantity: '45.4667 mg', solidsPercent: '30 %' }], targetSolids: '20 %', unit: 'mg' }));
    expect(r.value.toFixed(3)).toBe('28.173');
  });

  it('T17: gives the solvent volume with its density and shows the worked line', () => {
    const r = ok(t17LiquidMakeUp({ mode: 'w/w', dry: [{ name: 'povidone K30', quantity: '5.000 kg' }], targetSolids: '10 %', solventDensity: '0.997 g/mL' }));
    expect(r.solventVolume?.toFixed(3)).toBe('45.135'); // 45.000 kg ÷ 0.997 g/mL = 45.135 L
    expect(r.shown).toBe('solids = (5.000 kg povidone K30) = 5.000 kg; total liquid = 5.000 kg × 100 ÷ 10 % = 50.000 kg; solvent to add = 50.000 kg − 5.000 kg = 45.000 kg (45.14 L at 0.997 g/mL)');
  });

  it('T17: water to add of exactly zero is allowed (dispersion already at the target)', () => {
    expect(ok(t17LiquidMakeUp({ mode: 'w/w', dry: [], liquids: [{ name: 'Eudragit', quantity: '10 kg', solidsPercent: '30 %' }], targetSolids: '30 %' })).value.isZero()).toBe(true);
  });

  it.each([
    [{ mode: 'w/w' as const, dry: [{ name: 'TEC', quantity: '0.408 kg' }], liquids: [{ name: 'Eudragit L 30 D', quantity: '13.640 kg', solidsPercent: '30 %' }], targetSolids: '35 %' }, /already bring more water/],
    [{ mode: 'w/w' as const, dry: [{ name: 'HPMC', quantity: '1 kg' }], targetSolids: '0 %' }, /more than 0/],
    [{ mode: 'w/w' as const, dry: [{ name: 'HPMC', quantity: '1 kg' }], targetSolids: '120 %' }, /not more than 100/],
    [{ mode: 'w/w' as const, dry: [{ name: 'HPMC', quantity: '-1 kg' }], targetSolids: '10 %' }, /cannot be negative/],
    [{ mode: 'w/w' as const, dry: [], liquids: [{ name: 'dispersion', quantity: '10 L', solidsPercent: '30 %' }], targetSolids: '20 %' }, /give its density/],
    [{ mode: 'w/w' as const, dry: [], targetSolids: '20 %' }, /components/],
    [{ mode: 'w/w' as const, dry: [{ name: 'HPMC', quantity: '1 kg' }], targetSolids: '10 %', overagePercent: '-5 %' }, /cannot be negative/],
  ])('T17: refuses %o', (i, msg) => {
    expect(refused(t17LiquidMakeUp(i))).toMatch(msg);
  });
});

describe('T17 Liquid make-up, % w/v to a final volume', () => {
  it.each([
    ['ethylcellulose 10 % w/v made up to 15.2 L (formulation 13): 1.520 kg', [{ name: 'ethylcellulose', concentration: '10 %w/v' }], '15.2 L', '1.520'],
    ['saxagliptin 12.5 g per 1000 mL = 1.25 % w/v in 40 L (formulation 47): 0.500 kg', [{ name: 'saxagliptin', concentration: '12.5 g/L' }], '40 L', '0.500'],
    ['Eudragit E100 40 % w/v in methylene chloride, 5 L (formulation 44): 2.000 kg', [{ name: 'Eudragit E100', concentration: '40 %w/v' }], '5 L', '2.000'],
    ['two solutes: SLS 2.5 % + PVP 10 % w/v to 20 L (formulation 50): 0.5 + 2.0 = 2.500 kg', [{ name: 'SLS', concentration: '2.5 %w/v' }, { name: 'PVP K30', concentration: '10 %w/v' }], '20 L', '2.500'],
  ])('T17: %s', (_case, solutes, finalVolume, want) => {
    expect(ok(t17LiquidMakeUp({ mode: 'w/v', solutes, finalVolume })).value.toFixed(3)).toBe(want);
  });

  it('T17: with overage on the volume: 15.2 L + 10 % = 16.72 L → 1.672 kg', () => {
    const r = ok(t17LiquidMakeUp({ mode: 'w/v', solutes: [{ name: 'ethylcellulose', concentration: '10 %w/v' }], finalVolume: '15.2 L', overagePercent: '10 %' }));
    expect(r.value.toFixed(3)).toBe('1.672');
    expect(r.totalLiquid.toFixed(2)).toBe('16.72');
  });

  it.each([
    [{ mode: 'w/v' as const, solutes: [{ name: 'EC', concentration: '10 %' }], finalVolume: '15 L' }, /must be a mass concentration/],
    [{ mode: 'w/v' as const, solutes: [{ name: 'EC', concentration: '10 %w/v' }], finalVolume: '15 kg' }, /must be a volume/],
    [{ mode: 'w/v' as const, solutes: [{ name: 'EC', concentration: '10 %w/v' }], finalVolume: '0 L' }, /more than zero/],
  ])('T17: refuses %o', (i, msg) => {
    expect(refused(t17LiquidMakeUp(i))).toMatch(msg);
  });
});
