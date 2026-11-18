import { describe, expect, it } from 'vitest';
import { t22SieveAnalysis, t23CompactStrength, t24SpecificEnergy, t25AbsoluteHumidity } from '../../shared/templates/physical.js';
import { ok, refused } from './helpers.js';

describe('T22 Sieve analysis', () => {
  // 100.0 g milled ribbon (formulation 3); recovered 99.4 g. Hand check (Python decimal): % retained of 99.4 g:
  // 850 µm 2.113, 500 10.463, 250 30.382, 180 25.151, 125 15.392, 90 8.853, pan 7.646;
  // passing 250 µm = 57.042 %, 180 µm = 31.891 %; d50 linear 180 + (50 − 31.891) ÷ (57.042 − 31.891) × 70 = 230.40 µm;
  // log scale exp(ln180 + f (ln250 − ln180)) = 228.03 µm; fines passing 125 µm = 16.499 %.
  const base = {
    sample: '100.0 g',
    sieves: [['850 µm', '2.1 g'], ['500 µm', '10.4 g'], ['250 µm', '30.2 g'], ['180 µm', '25.0 g'], ['125 µm', '15.3 g'], ['90 µm', '8.8 g']].map(([aperture, retained]) => ({ aperture: aperture ?? '', retained: retained ?? '' })),
    pan: '7.6 g',
  };
  it('T22: per-sieve %, cumulative %, recovery, fines and d50', () => {
    const r = ok(t22SieveAnalysis({ ...base, finesBelow: '125 µm', median: 'linear', recoveryLimit: { low: '98.0', unit: '%' }, finesLimit: { high: '20', unit: '%' } }));
    expect(r.value.toFixed(1)).toBe('99.4');
    expect(r.check?.pass).toBe(true);
    expect(r.fractions.map((f) => f.retainedPercent.toFixed(3))).toEqual(['2.113', '10.463', '30.382', '25.151', '15.392', '8.853']);
    expect(r.fractions.map((f) => f.cumulativeRetained.toFixed(3))).toEqual(['2.113', '12.575', '42.958', '68.109', '83.501', '92.354']);
    expect(r.panPercent.toFixed(3)).toBe('7.646');
    expect(r.fines?.toFixed(3)).toBe('16.499');
    expect(r.finesCheck?.pass).toBe(true);
    expect(r.d50?.toFixed(2)).toBe('230.40');
  });

  it('T22: d50 on a log scale of size', () => {
    expect(ok(t22SieveAnalysis({ ...base, median: 'log' })).d50?.toFixed(2)).toBe('228.03');
  });

  it('T22: recovery below the limit fails the check (95.0 g recovered of 100.0 g against NLT 98.0 %)', () => {
    const r = ok(t22SieveAnalysis({ ...base, pan: '3.2 g', recoveryLimit: { low: '98.0', unit: '%' } })); // 91.8 + 3.2 = 95.0
    expect(r.value.toFixed(1)).toBe('95.0');
    expect(r.check?.pass).toBe(false);
  });

  it.each([
    [{ ...base, sieves: [...base.sieves].reverse() }, /coarsest to the finest/],
    [{ ...base, finesBelow: '100 µm' }, /not one of the sieves/],
    [{ ...base, sieves: [{ aperture: '850 µm', retained: '60 g' }], pan: '40 g', median: 'linear' as const }, /above the sieve range/],
    [{ ...base, sieves: [{ aperture: '90 µm', retained: '10 g' }], pan: '90 g', median: 'linear' as const }, /below the sieve range/],
    [{ ...base, sample: '0 g' }, /more than zero/],
    [{ ...base, pan: '-1 g' }, /cannot be negative/],
  ])('T22: refuses %#', (i, msg) => {
    expect(refused(t22SieveAnalysis(i))).toMatch(msg);
  });
});

describe('T23 Compact strength and solid fraction', () => {
  it.each([
    ['rucaparib slug (formulation 3): 2 × 58.9 N ÷ (π × 25 × 5) = 0.300 MPa (patent about 0.3)', { mode: 'compact' as const, shape: 'flat round' as const, force: '58.9 N', diameter: '25 mm', thickness: '5 mm' }, 3, '0.300'],
    ['tablet 21.2 kp (= 207.901 N), 12 mm × 5.35 mm: 2 × 207.901 ÷ (π × 12 × 5.35) = 2.06 MPa (patent 2.06)', { mode: 'compact' as const, shape: 'flat round' as const, force: '21.2 kp', diameter: '12 mm', thickness: '5.35 mm' }, 2, '2.06'],
    ['convex 10 mm, overall 4.5, wall 3.0 mm, 150 N (Pitt 1988): bracket 2.044, 10 × 150 ÷ (π × 100) ÷ 2.044 = 2.336 MPa', { mode: 'compact' as const, shape: 'convex round' as const, force: '150 N', diameter: '10 mm', thickness: '4.5 mm', wallThickness: '3.0 mm' }, 3, '2.336'],
    ['diameter in cm and force in kN are converted: 0.0589 kN, 2.5 cm, 0.5 cm', { mode: 'compact' as const, shape: 'flat round' as const, force: '0.0589 kN', diameter: '2.5 cm', thickness: '0.5 cm' }, 3, '0.300'],
  ])('T23: %s', (_case, i, d, want) => {
    expect(ok(t23CompactStrength(i)).value.toFixed(d)).toBe(want);
  });

  it('T23: solid fraction of a flat compact: 300 mg, 10 × 3 mm, true density 1.50 g/cm³', () => {
    // volume π × 10² × 3 ÷ 4 = 235.619 mm³ = 0.235619 cm³; apparent 1.27324 g/cm³; SF 0.84883; porosity 15.117 %
    const r = ok(t23CompactStrength({ mode: 'compact', shape: 'flat round', force: '100 N', diameter: '10 mm', thickness: '3 mm', weight: '300 mg', trueDensity: '1.50 g/cm³' }));
    expect(r.apparentDensity?.toFixed(5)).toBe('1.27324');
    expect(r.solidFraction?.toFixed(5)).toBe('0.84883');
    expect(r.porosity?.toFixed(3)).toBe('15.117');
  });

  it('T23: ribbon by envelope density (formulation 7): 1.05 ÷ 1.52 = 0.691, porosity 30.9 %', () => {
    const r = ok(t23CompactStrength({ mode: 'ribbon', envelopeDensity: '1.05 g/cm³', trueDensity: '1.52 g/cm³', limit: { low: '0.65', high: '0.75', unit: '' } }));
    expect(r.value.toFixed(3)).toBe('0.691');
    expect(r.porosity?.toFixed(1)).toBe('30.9');
    expect(r.check?.pass).toBe(true);
  });

  it.each([
    [{ mode: 'compact' as const, shape: 'convex round' as const, force: '150 N', diameter: '10 mm', thickness: '4.5 mm' }, /wall/],
    [{ mode: 'compact' as const, shape: 'convex round' as const, force: '150 N', diameter: '10 mm', thickness: '4.5 mm', wallThickness: '5 mm' }, /not more than the overall/],
    [{ mode: 'compact' as const, shape: 'flat round' as const, force: '150 g', diameter: '10 mm', thickness: '4.5 mm' }, /must be a force/],
    [{ mode: 'compact' as const, shape: 'flat round' as const, force: '150 N', diameter: '0 mm', thickness: '4.5 mm' }, /more than zero/],
    [{ mode: 'compact' as const, shape: 'flat round' as const, force: '150 N', diameter: '10 mm', thickness: '3 mm', weight: '300 mg' }, /both the weight and the true density/],
    [{ mode: 'compact' as const, shape: 'flat round' as const, force: '150 N', diameter: '10 mm', thickness: '3 mm', weight: '400 mg', trueDensity: '1.5 g/cm³' }, /higher than the true density/],
    [{ mode: 'ribbon' as const, envelopeDensity: '1.6 g/cm³', trueDensity: '1.5 g/cm³' }, /cannot be higher/],
  ])('T23: refuses %o', (i, msg) => {
    expect(refused(t23CompactStrength(i))).toMatch(msg);
  });
});

describe('T24 Extruder specific mechanical energy', () => {
  it('T24: 4 kW × 60 % × 200/500 rpm × 0.95 ÷ 2.1 kg/h = 0.434 kWh/kg (lopinavir HME at 2.1 kg/h, formulation 20)', () => {
    // 4 × 0.6 × 0.4 × 0.95 = 0.912; 0.912 ÷ 2.1 = 0.434286
    const r = ok(t24SpecificEnergy({ motorPower: '4 kW', torquePercent: '60 %', screwSpeed: '200 rpm', maxScrewSpeed: '500 rpm', feedRate: '2.1 kg/h', efficiency: '0.95' }));
    expect(r.value.toFixed(6)).toBe('0.434286');
  });

  it('T24: feed rate in g/min is converted: 35 g/min = 2.1 kg/h; efficiency defaults to 1 → 0.457 kWh/kg', () => {
    // 4 × 0.6 × 0.4 ÷ 2.1 = 0.457143
    expect(ok(t24SpecificEnergy({ motorPower: '4000 W', torquePercent: '60', screwSpeed: '200 rpm', maxScrewSpeed: '500 rpm', feedRate: '35 g/min' })).value.toFixed(6)).toBe('0.457143');
  });

  it.each([
    [{ torquePercent: '110 %' }, /0 to 100/],
    [{ screwSpeed: '600 rpm' }, /up to the maximum/],
    [{ feedRate: '0 kg/h' }, /more than zero/],
    [{ efficiency: '1.2' }, /not more than 1/],
  ])('T24: refuses %o', (bad, msg) => {
    expect(refused(t24SpecificEnergy({ motorPower: '4 kW', torquePercent: '60 %', screwSpeed: '200 rpm', maxScrewSpeed: '500 rpm', feedRate: '2.1 kg/h', ...bad }))).toMatch(msg);
  });
});

describe('T25 Absolute humidity', () => {
  it.each([
    // Magnus (WMO): e_s(20 °C) = 23.326 hPa; e = 11.663; x = 621.98 × 11.663 ÷ (1013.25 − 11.663) = 7.243 g/kg; dew point 9.26 °C
    ['50 %RH', '20 °C', '7.24', '9.3'],
    ['40 %RH', '25 °C', '7.86', '10.5'],
    ['40 %RH', '77 °F', '7.86', '10.5'], // 77 °F = 25 °C
  ])('T25: %s at %s → %s g/kg, dew point %s °C', (rh, t, x, dew) => {
    const r = ok(t25AbsoluteHumidity({ relativeHumidity: rh, temperature: t }));
    expect(r.value.toFixed(2)).toBe(x);
    expect(r.dewPoint.toFixed(1)).toBe(dew);
  });

  it('T25: effervescent packing room ≤ 20 g/kg at 18-22 °C (formulation 43): even saturated air at 22 °C holds only 16.62 g/kg', () => {
    const r = ok(t25AbsoluteHumidity({ relativeHumidity: '100 %RH', temperature: '22 °C', limit: { high: '20', unit: 'g/kg' } }));
    expect(r.value.toFixed(2)).toBe('16.62');
    expect(r.check?.pass).toBe(true); // the patent's limit can never fail in that temperature range
  });

  it.each([
    [{ relativeHumidity: '50 %', temperature: '20 °C' }, /must be a relative humidity/],
    [{ relativeHumidity: '120 %RH', temperature: '20 °C' }, /not more than 100/],
    [{ relativeHumidity: '50 %RH', temperature: '70 °C' }, /−45 to 60/],
    [{ relativeHumidity: '50 %RH', temperature: '20 kg' }, /must be a temperature/],
  ])('T25: refuses %o', (i, msg) => {
    expect(refused(t25AbsoluteHumidity(i))).toMatch(msg);
  });
});
