import { describe, expect, it } from 'vitest';
import { i18Density, type I18Input } from '../../shared/templates/fill.js';
import { ok, refused } from './helpers.js';

describe('I18 Volume, mass and fill target by density: convert', () => {
  it.each([
    ['WFI 25.0 L at 1.006 g/mL → 25.150 kg', '25.0 L', '1.006 g/mL', undefined, '25.150', 'kg'],
    ['polysorbate 80 by volume, 150 mL at 1.064 g/mL → 159.600 g (master check 30)', '150 mL', '1.064 g/mL', 'g', '159.600', 'g'],
    ['benzyl benzoate 0.559 kg at 1.118 g/mL → 0.500 L', '0.559 kg', '1.118 g/mL', undefined, '0.500', 'L'],
    ['sesame oil 460.0 g at 920 kg/m³ → 500.000 mL', '460.0 g', '920 kg/m³', 'mL', '500.000', 'mL'],
  ])('I18: %s', (_case, quantity, density, unit, want, wantUnit) => {
    const r = ok(i18Density({ mode: 'convert', quantity, density, ...(unit === undefined ? {} : { unit }) }));
    expect(r.value.toFixed(3)).toBe(want);
    expect(r.unit).toBe(wantUnit);
  });

  it('I18: shows the worked line', () => {
    expect(ok(i18Density({ mode: 'convert', quantity: '25.0 L', density: '1.006 g/mL' })).shown).toBe('25.0 L × 1.006 g/mL = 25.150 kg');
  });
});

describe('I18 Volume, mass and fill target by density: q.s.', () => {
  it.each([
    ['WFI to 100.0 L at 1.006 g/mL with 92.300 kg in the tank → 8.300 kg', { finalVolume: '100.0 L', density: '1.006 g/mL', inVessel: '92.300 kg' }, '8.300', '100.600'],
    ['to a final weight of 50.000 kg with 41.250 kg in the vessel → 8.750 kg', { finalWeight: '50.000 kg', inVessel: '41.250 kg' }, '8.750', '50.000'],
    ['an oily vehicle: 10.0 L at 0.920 g/mL with 3.000 kg of solution → 6.200 kg (master check 26)', { finalVolume: '10.0 L', density: '0.920 g/mL', inVessel: '3.000 kg' }, '6.200', '9.200'],
    ['exactly at the target: nothing to add', { finalWeight: '50.000 kg', inVessel: '50.000 kg' }, '0.000', '50.000'],
  ])('I18: %s', (_case, i, want, target) => {
    const r = ok(i18Density({ mode: 'qs', ...i }));
    expect(r.value.toFixed(3)).toBe(want);
    expect(r.targetWeight?.toFixed(3)).toBe(target);
  });

  it('I18: shows the worked line', () => {
    expect(ok(i18Density({ mode: 'qs', finalVolume: '100.0 L', density: '1.006 g/mL', inVessel: '92.300 kg' })).shown).toBe(
      'vehicle to add = 100.0 L × 1.006 g/mL = 100.600 kg − 92.300 kg = 8.300 kg',
    );
  });
});

describe('I18 Volume, mass and fill target by density: fill target', () => {
  it.each([
    ['10.0 mL nominal + 0.5 mL excess at 1.012 g/mL → 10.5 mL, 10.626 g', '10.0 mL', '0.5 mL', '1.012 g/mL', '10.50', '10.626'],
    ['2.0 mL ampoule + 0.15 mL excess (mobile liquid) at 1.000 g/mL → 2.15 mL, 2.150 g', '2.0 mL', '0.15 mL', '1.000 g/mL', '2.15', '2.150'],
    ['5.0 mL vial + 5 % excess at 1.045 g/mL → 5.25 mL, 5.486 g', '5.0 mL', '5 %', '1.045 g/mL', '5.25', '5.486'],
    ['an emulsion 20.0 mL + 0.9 mL at 0.988 g/mL → 20.90 mL, 20.649 g', '20.0 mL', '0.9 mL', '0.988 g/mL', '20.90', '20.649'],
  ])('I18: %s', (_case, nominalFill, excess, density, vol, weight) => {
    const r = ok(i18Density({ mode: 'fill target', nominalFill, excess, density }));
    expect(r.value.toFixed(2)).toBe(vol);
    expect(r.targetVolume?.toFixed(2)).toBe(vol);
    expect(r.targetWeight?.toFixed(3)).toBe(weight);
    expect(r.unit).toBe('mL');
  });

  it('I18: without a density gives the volume only', () => {
    const r = ok(i18Density({ mode: 'fill target', nominalFill: '10.0 mL', excess: '0.5 mL' }));
    expect(r.value.toFixed(2)).toBe('10.50');
    expect(r.targetWeight).toBeUndefined();
  });

  it('I18: fill weight limits ± 2 % with an alert band ± 1 %, rounded inwards at 3 decimals', () => {
    const r = ok(i18Density({ mode: 'fill target', nominalFill: '10.0 mL', excess: '0.5 mL', density: '1.012 g/mL', weightTolerance: { plusMinus: '2 %', alertPlusMinus: '1 %' } }));
    expect(r.weightLimit).toEqual({ low: '10.414', high: '10.838', unit: 'g', alertLow: '10.520', alertHigh: '10.732' });
    expect(r.nominalWeight?.toFixed(3)).toBe('10.120');
    expect(r.shown).toBe(
      'target fill = 10.0 mL + 0.5 mL = 10.50 mL; target net fill weight = 10.50 mL × 1.012 g/mL = 10.626 g; limits ± 2 %: 10.414 to 10.838 g (alert ± 1 %: 10.520 to 10.732 g)',
    );
  });

  it('I18: fill weight limits as ± an amount: 10.626 g ± 0.200 g → 10.426 to 10.826 g', () => {
    const r = ok(i18Density({ mode: 'fill target', nominalFill: '10.0 mL', excess: '0.5 mL', density: '1.012 g/mL', weightTolerance: { plusMinus: '0.200 g' } }));
    expect(r.weightLimit).toEqual({ low: '10.426', high: '10.826', unit: 'g' });
  });

  it('I18: zero excess is allowed (master check 16 asks for the reason)', () => {
    expect(ok(i18Density({ mode: 'fill target', nominalFill: '100 mL', excess: '0 mL', density: '1.000 g/mL' })).targetWeight?.toFixed(3)).toBe('100.000');
  });
});

describe('I18 refusals', () => {
  it.each<[I18Input, RegExp]>([
    [{ mode: 'convert', quantity: '25.0 L', density: '0 g/mL' }, /density must be more than zero/],
    [{ mode: 'convert', quantity: '25.0 L', density: '-1.0 g/mL' }, /density must be more than zero/],
    [{ mode: 'convert', quantity: '25.0 L', density: '1.006 %' }, /density must be a density/],
    [{ mode: 'convert', quantity: '25.0 °C', density: '1.006 g/mL' }, /quantity must be a volume or a mass/],
    [{ mode: 'convert', quantity: '25.0 L', density: '1.006 g/mL', unit: 'L' }, /result unit must be a mass/],
    [{ mode: 'qs', finalVolume: '100.0 L', density: '1.006 g/mL', inVessel: '101.000 kg' }, /already holds 101.000 kg, more than the final target of 100.600 kg/],
    [{ mode: 'qs', finalVolume: '100.0 L', inVessel: '92.300 kg' }, /needs the density/],
    [{ mode: 'qs', finalVolume: '100.0 L', finalWeight: '100.6 kg', density: '1.006 g/mL', inVessel: '92.300 kg' }, /one of the two/],
    [{ mode: 'qs', inVessel: '92.300 kg' }, /one of the two/],
    [{ mode: 'qs', finalWeight: '100.6 kg', inVessel: '92.3 L' }, /What is in the vessel must be a mass/],
    [{ mode: 'fill target', nominalFill: '10.0 mL', excess: '-0.5 mL', density: '1.012 g/mL' }, /excess cannot be negative/],
    [{ mode: 'fill target', nominalFill: '10.0 g', excess: '0.5 mL' }, /nominal fill must be a volume/],
    [{ mode: 'fill target', nominalFill: '10.0 mL', excess: '0.5 mL', weightTolerance: { plusMinus: '2 %' } }, /tolerance needs the density/],
    [{ mode: 'fill target', nominalFill: '10.0 mL', excess: '0.5 mL', density: '1.012 g/mL', weightTolerance: { plusMinus: '1 %', alertPlusMinus: '2 %' } }, /alert tolerance must not be wider/],
  ])('I18: refuses %o', (i, msg) => {
    expect(refused(i18Density(i))).toMatch(msg);
  });
});
