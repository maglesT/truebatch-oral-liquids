import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { convert, findUnit, unit } from '../../shared/templates/units.js';
import { Refused } from '../../shared/templates/refuse.js';

const c = (v: string, from: string, to: string): string => convert(new Dec(v), unit(from), unit(to)).toSignificantDigits(15).toString();

describe('units: same-kind conversion', () => {
  // Every expected value is the definition of the unit (hand check in the comment).
  it.each([
    ['1', 'kg', 'g', '1000'],
    ['250', 'mg', 'g', '0.25'],
    ['12.5', 'g', 'kg', '0.0125'],
    ['25', 'µg', 'mg', '0.025'],
    ['1.5', 'L', 'mL', '1500'],
    ['500', 'µL', 'mL', '0.5'],
    ['0.85', 'mm', 'µm', '850'],
    ['1.2', 'cm', 'mm', '12'],
    ['90', 'min', 'h', '1.5'],
    ['2', 'h', 's', '7200'],
    ['1', 'kp', 'N', '9.80665'], // 1 kp = 9.80665 N exactly
    ['21.2', 'kp', 'N', '207.90098'], // 21.2 × 9.80665
    ['15', 'kN', 'N', '15000'],
    ['1', 'bar', 'kPa', '100'],
    ['50', 'mbar', 'Pa', '5000'],
    ['760', 'mmHg', 'Pa', '101325.0144354'], // 760 × 133.322387415 = 101325.01443540
    ['1', 'psi', 'Pa', '6894.75729316836'], // 0.45359237 × 9.80665 ÷ 0.0254²
    ['2.0', 'kgf/cm²', 'bar', '1.96133'], // 2 × 98066.5 Pa
    ['50', 'kN/cm²', 'MPa', '500'], // 1 kN/cm² = 10 MPa
    ['1', '%', 'ppm', '10000'],
    ['5000', 'ppm', '%', '0.5'],
    ['10', '%w/v', 'mg/mL', '100'], // 10 g/100 mL
    ['1', 'kg/L', 'g/mL', '1'],
    ['30', 'kg/h', 'g/min', '500'],
    ['1', 'L/min', 'm³/h', '0.06'],
    ['2', 'kW', 'W', '2000'],
    ['1', 'kWh/kg', 'kJ/kg', '3600'],
    ['100000', 'IU/g', 'IU/mg', '100'],
    ['45', 'U/mg', 'U/g', '45000'],
  ])('Units: %s %s = %s %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it.each([
    ['25', '°C', 'K', '298.15'],
    ['0', '°C', '°F', '32'],
    ['100', '°C', '°F', '212'],
    ['104', '°F', '°C', '40'], // (104 − 32) × 5/9 = 40
    ['-40', '°F', '°C', '-40'],
    ['10', 'Δ°C', 'Δ°F', '18'], // a difference has no offset
  ])('Units: temperature with offsets: %s %s = %s %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it('Units: a temperature difference compared with a limit written in °C uses the difference unit', () => {
    expect(c('1.5', 'Δ°C', '°C')).toBe('1.5');
    expect(c('9', 'Δ°F', '°C')).toBe('5');
  });

  it.each([
    ['400', 'IU', 'mg', /potency in IU, CFU or activity units is never a mass/],
    ['3', 'CFU', 'g', /never a mass/],
    ['36000', 'U', 'mg', /never a mass/],
    ['400', 'IU', 'U', /never a mass/],
    ['45', '%RH', 'g/kg', /T25/],
    ['8', 'g/kg', '%RH', /T25/],
    ['5', '%w/w', '%w/v', /cannot be converted/],
    ['1', 'kg', 'L', /cannot be converted/],
    ['25', '°C', 'Δ°C', /temperature reading/],
  ])('Units: refused: %s %s to %s', (v, from, to, msg) => {
    expect(() => convert(new Dec(v), unit(from), unit(to))).toThrow(Refused);
    expect(() => convert(new Dec(v), unit(from), unit(to))).toThrow(msg);
  });

  it.each([['mcg', 'µg'], ['ml', 'mL'], ['kP', 'kp'], ['% w/w', '%w/w'], ['cfu/g', 'CFU/g'], ['kg/cm²', 'kgf/cm²']])('Units: alias %s is %s', (a, s) => {
    expect(findUnit(a)?.symbol).toBe(s);
  });

  it('Units: an unknown unit is not found', () => {
    expect(findUnit('furlong')).toBeUndefined();
  });
});

describe('units: the liquids units (library section 3)', () => {
  it.each([
    ['120', 'mg/5 mL', 'mg/mL', '24'], // 120 mg in 5 mL = 24 mg/mL
    ['2.4', '%w/v', 'mg/mL', '24'], // 2.4 g per 100 mL
    ['400', 'µg/mL', 'mg/mL', '0.4'],
    ['1.2', 'N·m', 'N·cm', '120'],
    ['60', 'bottles/min', 'units/h', '3600'],
    ['1500', 'cP', 'mPa·s', '1500'],
  ])('%s %s is %s %s', (v, from, to, want) => {
    expect(c(v, from, to)).toBe(want);
  });

  it('an alcohol strength in % v/v, a viscosity, a torque, IU per mL or per drop never convert to another kind', () => {
    for (const [a, b] of [['%v/v', '%w/w'], ['%v/v', '%w/v'], ['mPa·s', 'Pa'], ['N·m', 'N'], ['IU/mL', 'mg/mL'], ['IU/drop', 'IU/mL'], ['drops', 'mL']] as const) {
      expect(() => convert(new Dec(1), unit(a), unit(b)), `${a} → ${b}`).toThrow(Refused);
    }
  });

  it('the usual spellings are read: % v/v, cP, mcg/mL, bottle, drop, Nm', () => {
    expect(['% v/v', 'cP', 'mcg/mL', 'bottle', 'drop', 'Nm', 'mg/5mL'].map((s) => findUnit(s)?.symbol)).toEqual(['%v/v', 'mPa·s', 'µg/mL', 'bottles', 'drops', 'N·m', 'mg/5 mL']);
  });
});
