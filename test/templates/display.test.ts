import { describe, expect, it } from 'vitest';
import { Dec } from '../../shared/templates/dec.js';
import { shownNumber } from '../../shared/templates/core.js';
import { checkLimit } from '../../shared/templates/rounding.js';
import { t10Compensating, t16Overage } from '../../shared/templates/dispensing.js';
import { workedExample } from '../../web/src/designer/example.js';
import { tablet } from '../engine-fixture.js';
import { ok } from './helpers.js';

// The display rule of worked lines: full precision inside, readable figures on the screen and in the batch record.
const LONG = '10.255358424776900000000000000000000000000000000001';

describe('worked-line numbers (shownNumber)', () => {
  it.each<[string, string, { written?: string; decimals?: number }, string]>([
    // as written (typed, or a result written out exactly): kept, up to 4 decimals
    ['10.000', 'kg', { written: '10.000' }, '10.000'],
    ['14.0166', 'g', { written: '14.0166' }, '14.0166'],
    ['3e9', 'tablets', { written: '3e9' }, '3e9'],
    // a full-precision result passed on: the unit's display decimals + 1, cut and marked
    [LONG, 'kg', { written: LONG }, '10.2553…'],
    ['98.505123', '%', { written: '98.505123' }, '98.50…'],
    ['756.04848', 'mg', { written: '756.04848' }, '756.048…'],
    ['-1.23456789', 'kg', { written: '-1.23456789' }, '-1.2345…'],
    // exact at the shown decimals: no mark
    ['10.250000', 'kg', { written: '10.250000' }, '10.2500'],
    // a small value keeps 4 significant figures
    ['0.0000123456789', 'kg', { written: '0.0000123456789' }, '0.00001234…'],
    // a result without written text, and a set number of decimals (the rounding line)
    ['10.25', 'kg', {}, '10.2500'],
    ['94.94999999', '%', { decimals: 3 }, '94.949…'],
  ])('shownNumber(%s %s, %o) = %s', (v, unit, o, want) => {
    expect(shownNumber(new Dec(v), unit, o)).toBe(want);
  });

  it('T10: the compensating filler line shows the adjusted quantity at 4 decimals of kg, the value keeps full precision', () => {
    const r = ok(t10Compensating({ fillers: [{ name: 'Lactose', standard: '12.000 kg' }], adjusted: [{ name: 'Examplol', standard: '10.000 kg', adjusted: `${LONG} kg` }] }));
    expect(r.shown).toBe('12.000 kg − [(10.2553… kg − 10.000 kg)] = 11.745 kg Lactose');
    expect(r.value.eq(new Dec('22.000').minus(LONG))).toBe(true);
  });

  it('T16: a full-precision quantity passed on is shown cut, the result at its decimals', () => {
    expect(ok(t16Overage({ quantity: `${LONG} kg`, overagePercent: '2.0' })).shown).toBe('10.2553… kg × (100 + 2.0 %) ÷ 100 = 10.460 kg (of which overage 0.205 kg)');
  });

  it('C1: the value before rounding at the limit is shown with 2 more decimals than the limit (cut), not 12 digits', () => {
    expect(checkLimit(new Dec('99.00990099009901'), '%', { low: '97.0', high: '100.5', unit: '%' }).shown)
      .toBe('99.009… % rounded to 1 decimal (as the limit is written) = 99.0 %; limit 97.0 to 100.5 %: within limits');
  });

  it('C1: when rounding changes nothing the line is plain: the value and its limit (17 Nov 2026 run)', () => {
    expect(checkLimit(new Dec('0'), 'nos', { high: '0', unit: 'nos' }).shown).toBe('0 nos; limit not more than 0 nos: within limits');
    expect(checkLimit(new Dec('6.50'), '', { low: '6.0', high: '7.0', unit: '' }).shown).toBe('6.5; limit 6.0 to 7.0: within limits');
    expect(checkLimit(new Dec('2'), 'nos', { high: '0', unit: 'nos' })).toMatchObject({ pass: false, shown: '2 nos; limit not more than 0 nos: OUT OF LIMITS (above the upper limit)' });
    // A unit changed (g to kg) but nothing rounded: plain too, in the limit's unit.
    expect(checkLimit(new Dec('500'), 'g', { low: '0.4', high: '0.6', unit: 'kg' }).shown).toBe('0.5 kg; limit 0.4 to 0.6 kg: within limits');
  });

  it('no worked line of the fixture master shows a number with more than 4 decimals (all blocks, example values)', () => {
    const d = tablet();
    const long: string[] = [];
    d.stages.forEach((s, si) => s.steps.forEach((_, ti) => {
      for (const r of Object.values(workedExample(d, si, ti).results)) if (r.ok && /\d\.\d{5,}/.test(r.shown)) long.push(r.shown);
    }));
    expect(long).toEqual([]);
  });
});
