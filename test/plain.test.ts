import { describe, expect, it } from 'vitest';
import { headline } from '../shared/engine/plain.js';
import { store, type Stored } from '../shared/engine/values.js';
import { t17LiquidMakeUp } from '../shared/templates/liquid.js';
import { c1WithinLimits, c3AllIndividual } from '../shared/templates/series.js';
import { c6StagedTest } from '../shared/templates/staged.js';

// The headline of a result says the calc's own value (owner's confirmation run, 17 Nov 2026), rounded as its worked
// line rounds it; counts are named (tablets, locations), not "units".

describe('headline', () => {
  it('a worked line of several parts: the part that comes to the value, not the first part', () => {
    const r = store(t17LiquidMakeUp({ mode: 'w/w', dry: [{ name: 'binder', quantity: '0.750 kg' }], targetSolids: '10 %', unit: 'kg' }));
    expect(r.ok && r.shown).toContain('solvent to add = 7.500 kg − 0.750 kg = 6.750 kg');
    expect(headline(r)).toBe('6.750 kg');
  });

  it('a difference from a target: the figure of the worked line, to the decimals of the ± limit', () => {
    const near = store(c1WithinLimits({ value: '24.9950 kg', around: { centre: '25.0000 kg', name: 'target', plusMinusPercent: '0.5' } }));
    expect(near.ok && near.shown).toContain('24.9950 kg is 0.0 % from 25.0000 kg');
    expect(headline(near)).toBe('0.0 %');
    const over = store(c1WithinLimits({ value: '6.76 kg', around: { centre: '6.7500 kg', name: 'solvent to add', plusMinusPercent: '2.0' } }));
    expect(over.ok && over.shown).toContain('6.76 kg is +0.1 % from 6.7500 kg');
    expect(headline(over)).toBe('+0.1 %');
    const under = store(c1WithinLimits({ value: '9.5 mg', around: { centre: '10.0 mg', plusMinus: '1.0 mg' } }));
    expect(headline(under)).toBe('-0.5 mg');
  });

  it('a stored line of before (a rounded-away minus) reads without a sign', () => {
    const before = { ok: true, value: '24.995', unit: 'kg', deviation: '-0.02', shown: '24.9950 kg is 0.0 % from 25.0000 kg (target); limit ± 0.5 %: within limits',
      check: { pass: true, level: 'pass', rounded: '-0.020', shown: '' } } as Stored;
    expect(headline(before)).toBe('0.0 %');
  });
});

describe('count words and the mean', () => {
  const weights = ['600.1', '600.2', '600.3', '600.4', '600.3', '600.47'].map((v) => ({ value: v, unit: 'mg' }));
  it('C3: the units named, the mean to the decimals of its limit (else 1 decimal)', () => {
    const r = c3AllIndividual({ readings: weights, band: { plusMinusPercent: '5.0', of: 'mean' }, noun: 'tablets' });
    expect(r.ok && r.shown).toMatch(/^6 tablets; 0 outside ± 5\.0 % of the mean 600\.3 mg/);
    const two = c3AllIndividual({ readings: weights, band: { plusMinusPercent: '5.0', of: 'mean' }, meanLimit: { low: '570.00', high: '630.00', unit: 'mg' } });
    expect(two.ok && two.shown).toMatch(/^6 units; .* the mean 600\.30 mg/);
    const out = c3AllIndividual({ readings: [...weights, { value: '700', unit: 'mg' }], band: { plusMinusPercent: '5.0', of: 'mean' }, noun: 'tablets' });
    expect(out.ok && out.shown).toContain('(outside: tablet 7)');
  });

  it('C6 disintegration: the tablets named', () => {
    const r = c6StagedTest({ test: 'disintegration', maxTime: '15', noun: 'tablets', stages: [['5', '6', '7', '8', '9', '10']] });
    expect(r.ok && r.shown).toBe('All 6 tablets disintegrated within 15 min: PASS');
  });
});
