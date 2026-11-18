import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { checkLimit, roundHalfUp, writtenDecimals, type Limit } from '../../shared/templates/rounding.js';
import { c1WithinLimits } from '../../shared/templates/series.js';
import { ok, refused } from './helpers.js';

describe('pharmacopoeia rounding at the limit', () => {
  it.each([
    ['95.0', 1],
    ['105', 0],
    ['0.25', 2],
    [' 2.0 ', 1],
  ])('C1: decimals written in "%s" = %i', (t, n) => expect(writtenDecimals(t)).toBe(n));

  it.each([
    ['94.95', 1, '95.0'],
    ['94.94', 1, '94.9'],
    ['-0.05', 1, '-0.1'], // half up = away from zero
    ['2.45', 1, '2.5'],
    ['2.449999', 1, '2.4'],
  ])('C1: round %s to %i decimals = %s', (v, d, want) => expect(roundHalfUp(new Dec(v), d).toFixed(d)).toBe(want));

  const range: Limit = { low: '95.0', high: '105.0', unit: '%' };
  it.each([
    ['94.95', true, 'pass'], // rounds to 95.0: exactly on the limit passes
    ['94.94', false, 'fail'], // rounds to 94.9
    ['105.04', true, 'pass'], // rounds to 105.0
    ['105.05', false, 'fail'], // rounds to 105.1
    ['95.0', true, 'pass'],
    ['100', true, 'pass'],
  ])('C1: %s %% against 95.0-105.0 %%: pass %s', (v, pass, level) => {
    const c = checkLimit(new Dec(v), '%', range);
    expect(c.pass).toBe(pass);
    expect(c.level).toBe(level);
  });

  it.each([
    // one-sided limits
    ['2.04', { high: '2.0', unit: '%' }, true], // LOD NMT 2.0 %: 2.04 → 2.0
    ['2.05', { high: '2.0', unit: '%' }, false], // 2.05 → 2.1
    ['96.95', { low: '97.0', unit: '%' }, true], // yield NLT 97.0 %
    ['96.94', { low: '97.0', unit: '%' }, false],
    ['10.0', { low: '10', lowStrict: true, unit: '' }, false], // pH more than 10: 10.0 → 10 is not more than 10
    ['10.6', { low: '10', lowStrict: true, unit: '' }, true], // rounds to 11
    ['10.4', { low: '10', lowStrict: true, unit: '' }, false], // rounds to 10
  ] as [string, Limit, boolean][])('C1: one-sided: %s against %o: %s', (v, l, pass) => {
    expect(checkLimit(new Dec(v), l.unit === '%' ? '%' : '', l).pass).toBe(pass);
  });

  it('C1: bounds written with different decimals use the finer one', () => {
    // 97-100.0 %: one decimal used, so 96.96 → 97.0 passes, 96.94 → 96.9 fails
    expect(checkLimit(new Dec('96.96'), '%', { low: '97', high: '100.0', unit: '%' }).pass).toBe(true);
    expect(checkLimit(new Dec('96.94'), '%', { low: '97', high: '100.0', unit: '%' }).pass).toBe(false);
  });

  it.each([
    ['98.6', 'pass'],
    ['96.5', 'alert'], // inside 95.0-105.0 but outside the alert band 97.0-103.0
    ['103.04', 'pass'], // 103.0 inside the alert band
    ['103.05', 'alert'], // 103.1
    ['94.0', 'fail'],
  ])('C1: alert/action tiers: %s → %s', (v, level) => {
    const c = checkLimit(new Dec(v), '%', { low: '95.0', high: '105.0', alertLow: '97.0', alertHigh: '103.0', unit: '%' });
    expect(c.level).toBe(level);
    expect(c.pass).toBe(level !== 'fail');
  });

  it('C1: converts the value into the limit unit before rounding', () => {
    // 0.75 kN = 750 N against NLT 750 N; 12.4996 kN = 12499.6 N → 12500 N against 12-18 kN written in N
    expect(checkLimit(new Dec('0.75'), 'kN', { low: '750', unit: 'N' }).pass).toBe(true);
    expect(checkLimit(new Dec('18.0004'), 'kN', { low: '12000', high: '18000', unit: 'N' }).pass).toBe(true); // 18000.4 → 18000
    expect(checkLimit(new Dec('18.0005'), 'kN', { low: '12000', high: '18000', unit: 'N' }).pass).toBe(false); // 18000.5 → 18001
    // 104 °F = 40.0 °C against NMT 40.0 °C
    expect(checkLimit(new Dec('104'), '°F', { high: '40.0', unit: '°C' }).pass).toBe(true);
  });

  it('C1 shows the worked comparison in plain words', () => {
    const r = ok(c1WithinLimits({ value: '94.95 %', limit: range }));
    expect(r.check?.pass).toBe(true);
    expect(r.shown).toContain('= 95.0 %');
    expect(r.shown).toContain('95.0 to 105.0 %');
    expect(r.shown).toContain('within limits');
    const f = ok(c1WithinLimits({ value: '22.6 °C', limit: { high: '25', unit: '°C' } }));
    expect(f.check?.pass).toBe(true); // 22.6 → 23 ≤ 25
    const g = ok(c1WithinLimits({ value: '61 %RH', limit: { high: '60', unit: '%RH' } }));
    expect(g.shown).toContain('OUT OF LIMITS (above the upper limit)');
  });

  it.each([
    [{ low: '105.0', high: '95.0', unit: '%' }, /above the upper limit/],
    [{ unit: '%' }, /needs a lower bound/],
    [{ low: '9.5e1', unit: '%' }, /plain decimal/],
    [{ low: '95.0', high: '105.0', alertLow: '94.0', unit: '%' }, /alert limit must not be below/],
    [{ low: '95.0', unit: 'mg' }, /cannot be converted/],
  ] as [Limit, RegExp][])('C1 refuses a bad limit %o', (l, msg) => {
    expect(refused(c1WithinLimits({ value: '98.0 %', limit: l }))).toMatch(msg);
  });

  it('C1 refuses JavaScript numbers (floating point)', () => {
    expect(refused(c1WithinLimits({ value: { value: 0.1 as unknown as string, unit: '%' }, limit: range }))).toMatch(/not as a JavaScript number/);
  });
});
