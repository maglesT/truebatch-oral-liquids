import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { evaluate, type StepEvent, type Value } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { neededKind } from '../shared/master/kinds.js';
import { durations } from '../shared/engine/values.js';
import { placeChecks } from '../shared/master/places.js';
import { ev, small, unplaced } from './engine-fixture.js';

// The liquids blocks (shared/blocks/liquids.ts): what each works out from recorded values, with the templates.
const q = (value: string, unit: string) => ({ value, unit });
const one = (id: string, settings: object) => {
  const b = findBlock({ id, version: 1 })!;
  return small([{ role: 'Production operator', steps: [{ key: id, block: { id, version: 1 }, checker: b.checker, settings }] }]);
};
const run = (id: string, settings: object, values: Record<string, Value>, events: StepEvent[] = [], round = 1) => evaluate(one(id, settings), events, { stage: 0, sub: 1, step: 0, round }, values);
const tenOf = (value: string, unit: string) => Array.from({ length: 10 }, () => q(value, unit));

describe('the liquids blocks (library sections 5.2-5.4)', () => {
  it('every liquids block is a valid description with no master-check problem in a small master', () => {
    for (const id of ['water', 'dissolve', 'sugar-syrup', 'hydrate', 'ph-adjust', 'make-up', 'make-up-volume', 'filtration', 'phase-prep', 'homogenise', 'size-check',
      'bulk-test', 'bulk-adjust', 'bulk-transfer', 'bulk-yield', 'bulk-yield-weight', 'room-status']) {
      expect(blockProblems(findBlock({ id, version: 1 })!), id).toEqual([]);
    }
  });

  it('TL-01 the bulk correction: its target is a concentration, so a formula line (a batch quantity) is refused and only typed', () => {
    const b = findBlock({ id: 'bulk-adjust', version: 1 })!;
    expect(neededKind(b, 'target')).toBe('mass concentration');
    expect(neededKind(b, 'donor')).toBe('mass concentration');
    expect(neededKind(b, 'largestLimit')).toBe('mass');
    const set = { target: { formula: 'x' }, donor: '0 mg/mL', direction: 'dilute with the vehicle', largestLimit: { high: '5', unit: 'kg' }, tolerance: '1.0' };
    const p = masterChecks(one('bulk-adjust', set)).filter((x) => x.path.endsWith('settings.target'));
    expect(p.map((x) => x.message)).toEqual(['Target concentration: a formula line gives its batch quantity (a mass), but this setting is a concentration. Type the value instead']);
    expect(masterChecks(one('bulk-adjust', { ...set, target: '24.0 mg/mL' })).filter((x) => x.path.includes('settings'))).toEqual([]);
  });

  it('TL-01 a formula line (always kg) on a quantity read in litres is refused; the designer offers no line there', () => {
    const b = findBlock({ id: 'bulk-yield', version: 1 })!;
    expect(neededKind(b, 'theoretical', { unit: 'L' })).toBe('volume');
    const p = masterChecks(one('bulk-yield', { unit: 'L', theoretical: { formula: 'x' } })).filter((x) => x.path.endsWith('settings.theoretical')).map((x) => x.message);
    expect(p).toEqual(['Theoretical quantity: a formula line gives its batch quantity (a mass), but this setting is a volume. Type the value instead']);
  });

  it('a repeat-until step whose C1 stop check reads an optional limit left unset never passes: refused (Tablets rounds 37/37b)', () => {
    const flow = (stop: string) => ({ kind: 'repeat-until', maxRounds: 5, stop });
    const never = (settings: object, stop: string, id = 'water') => {
      const d = one(id, settings);
      (d.stages[0]!.steps[0] as { flow: object }).flow = flow(stop);
      return masterChecks(d).filter((x) => x.message.includes('never passes')).map((x) => x.message);
    };
    expect(never({ water: 'hot' }, 'temperatureCheck')).toEqual(['Temperature stops the rounds, but Temperature limits is not set, so it never passes: set it, or pick the check that stops the rounds under More options']);
    expect(never({ water: 'hot', temperatureLimit: { low: '70', high: '80', unit: '°C' } }, 'temperatureCheck')).toEqual([]);
    // A stop check that is not a C1 runs without an unset optional argument, so it is not refused.
    const notC1 = findBlock({ id: 'ph-adjust', version: 1 })!.calcs.find((c) => c.template !== 'C1')!;
    expect(never({ phLimit: { low: '4.5', high: '5.5', unit: '' } }, notC1.name, 'ph-adjust')).toEqual([]);
  });

  it('an optional mixing or hydration time limit, when set, is a minimum wait (its timer and the demo skip)', () => {
    const st = (settings: object) => ({ key: 's', block: { id: 'sugar-syrup', version: 1 }, checker: false, flow: { kind: 'once' }, settings }) as never;
    const b = findBlock({ id: 'sugar-syrup', version: 1 });
    expect(durations(b, st({ timeLimit: { low: '30', high: '60', unit: 'min' } })).map((d) => [d.calc, d.limit.low])).toEqual([['mixTime', '30']]);
    expect(durations(b, st({}))).toEqual([]);
    expect(durations(findBlock({ id: 'hydrate', version: 1 }), st({ timeLimit: { low: '30', high: '90', unit: 'min' } })).map((d) => d.calc)).toEqual(['hydrationTime']);
  });

  it('TL-01 the make-up by weight (I18): the final volume is a volume and the density a density, so no formula line is offered or taken', () => {
    const b = findBlock({ id: 'make-up', version: 1 })!;
    expect(neededKind(b, 'volume')).toBe('volume');
    expect(neededKind(b, 'density')).toBe('density');
    const set = { volume: { formula: 'x' }, density: { formula: 'x' }, tolerance: '0.5' };
    const p = masterChecks(one('make-up', set)).filter((x) => /settings\.(volume|density)$/.test(x.path)).map((x) => x.message);
    expect(p).toEqual(['Final batch volume: a formula line gives its batch quantity (a mass), but this setting is a volume. Type the value instead',
      'Density at the make-up temperature: a formula line gives its batch quantity (a mass), but this setting is a density. Type the value instead']);
    expect(masterChecks(one('make-up', { volume: { header: 'batchVolume' }, density: '1.250 g/mL', tolerance: '0.5' })).filter((x) => /settings\.(volume|density)$/.test(x.path))).toEqual([]);
  });

  it('TL-10 the holding tank of the bulk transfer is a tank: a stage whose rooms hold only vessels is warned (Phase E)', () => {
    const doc = one('bulk-transfer', { unit: 'L' });
    doc.stages[0]!.roomTypes = ['RM-302'];
    const rooms = [{ code: 'RM-302', area: 'Liquid manufacturing' }, { code: 'RM-312', area: 'Liquid storage' }];
    const vessel = { code: 'EQL-MFV-01', type: 'Manufacturing vessel', room: 'RM-302' };
    const tank = { code: 'EQL-JHT-01', type: 'Jacketed holding tank', room: 'RM-312' };
    const warned = (equipment: object[]) => placeChecks(doc, { equipment, rooms } as never).map((x) => x.message).filter((m) => /holding tank/.test(m));
    expect(warned([vessel, tank])).toEqual(['No holding tank stands in a room this stage allows (RM-302): EQL-JHT-01 stands in RM-312. Allow its room in the stage settings, or engineering moves it in master data']);
    doc.stages[0]!.roomTypes = ['RM-302', 'RM-312'];
    expect(warned([vessel, tank])).toEqual([]);
  });

  it('drying to constant weight: the largest change is a tolerance, typed only (Tablets round 31)', () => {
    const set = (maxChange: object | string) => masterChecks(one('dry-constant', { maxChange })).filter((x) => x.path.endsWith('settings.maxChange')).map((x) => x.message);
    expect(set({ formula: 'x' })).toEqual(['Largest change between rounds is a tolerance: type it (the batch quantity of a formula line is not a tolerance)']);
    expect(set({ header: 'batchSize' })).toEqual(['Largest change between rounds is a tolerance: type it (a header value is not a tolerance)']);
    expect(set('0.5 g')).toEqual([]);
    expect(blockProblems({ ...findBlock({ id: 'dry-constant', version: 1 })!, settings: [{ name: 'maxChange', label: 'x', kind: 'number', notBatch: 'tolerance' }] }))
      .toContain('setting maxChange: only a quantity setting is marked not a batch quantity');
  });

  it('TL-08 make-up by weight: the target batch weight is the volume × the density (I18), the net weight is checked against it', () => {
    const r = run('make-up', { volume: '1000 L', density: '1.250 g/mL', tolerance: '0.5' }, { gross: q('1500.0', 'kg'), tare: q('250.0', 'kg') });
    expect(r.target).toMatchObject({ ok: true, value: '1250', unit: 'kg', shown: '1000 L × 1.250 g/mL = 1250.000 kg' });
    expect(r.net).toMatchObject({ ok: true, value: '1250' });
    expect(r.netCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(run('make-up', { volume: '1000 L', density: '1.250 g/mL', tolerance: '0.5' }, { gross: q('1520.0', 'kg'), tare: q('250.0', 'kg') }).netCheck).toMatchObject({ check: { pass: false } });
  });

  it('TL-18 bulk yield by weight: the net weight in litres by the density (I18), then the yield (T3) and accountability (T4)', () => {
    const r = run('bulk-yield-weight', { density: '1.250 g/mL', theoretical: '1000 L', yieldLimit: { low: '97.0', high: '101.0', unit: '%' } },
      { gross: q('1475.0', 'kg'), tare: q('250.0', 'kg'), samples: q('2.0', 'L'), rejects: q('18.0', 'L') });
    expect(r.output).toMatchObject({ ok: true, value: '980', unit: 'L' });
    expect(r.yield).toMatchObject({ ok: true, value: '98', check: { pass: true } });
    expect(r.accountability).toMatchObject({ ok: true, value: '100' });
  });

  it('TL-P10 a fill round: 10 bottles, the mean and each fill against their limits', () => {
    const settings = { fillUnit: 'g', meanLimit: { low: '61.5', high: '63.5', unit: 'g' }, eachLimit: { low: '60.5', high: '64.5', unit: 'g' } };
    const ok = run('liquid-fill', settings, { fills: tenOf('62.4', 'g'), stirring: 'yes' });
    expect(ok.mean).toMatchObject({ ok: true, check: { pass: true } });
    expect(ok.each).toMatchObject({ ok: true, check: { pass: true } });
    const low = run('liquid-fill', settings, { fills: [...tenOf('62.4', 'g').slice(0, 9), q('59.0', 'g')] });
    expect(low.each).toMatchObject({ ok: true, check: { pass: false } });
    expect(findBlock({ id: 'liquid-fill', version: 1 })!.fields.find((f) => f.name === 'fills')!.count).toBe(10);
  });

  it('the pH is adjusted round by round; the total added runs over the rounds against its maximum ($prev)', () => {
    const settings = { phLimit: { low: '4.5', high: '5.5', unit: 'pH' }, totalLimit: { high: '50', unit: 'mL' } };
    const r1 = run('ph-adjust', settings, { ph: q('3.9', 'pH'), solution: 'sodium hydroxide', added: q('30', 'mL') });
    expect(r1.phCheck).toMatchObject({ check: { pass: false } });
    const events = [ev('started', '0.1.0.1'), ev('value', '0.1.0.1', { payload: { values: { ph: q('3.9', 'pH'), added: q('30', 'mL') }, results: r1 } })];
    const r2 = run('ph-adjust', settings, { ph: q('4.8', 'pH'), solution: 'sodium hydroxide', added: q('25', 'mL') }, events, 2);
    expect(r2.phCheck).toMatchObject({ check: { pass: true } });
    expect(r2.total).toMatchObject({ ok: true, value: '55', check: { pass: false } });
  });

  it('the sugar syrup is checked at its temperature and density; a pH limit is never a plain number', () => {
    const r = run('sugar-syrup', { temperatureLimit: { low: '70', high: '80', unit: '°C' }, densityLimit: { low: '1.30', high: '1.33', unit: 'g/mL' } },
      { temperature: q('75', '°C'), density: q('1.315', 'g/mL'), clear: 'yes' });
    expect([r.temperatureCheck, r.densityCheck, r.clearCheck]).toMatchObject([{ check: { pass: true } }, { check: { pass: true } }, { check: { pass: true } }]);
    const doc = one('ph-adjust', { phLimit: { low: '4.5', high: '5.5', unit: '' } });
    expect(unplaced(masterChecks(doc)).some((p) => p.path.includes('phLimit'))).toBe(true);
  });

  it('TL-10 the bulk transfer: the line connected to this holding tank is a check; a stirred bulk confirms the stirrer', () => {
    const r = run('bulk-transfer', { unit: 'L', quantityLimit: { low: '990', high: '1010', unit: 'L' } }, { connected: 'no', quantity: q('1000', 'L'), stirring: 'yes' });
    expect(r.connectedCheck).toMatchObject({ check: { pass: false } });
    expect(r.quantityCheck).toMatchObject({ check: { pass: true } });
    expect(run('bulk-transfer', { unit: 'L' }, { connected: 'yes', quantity: q('1000', 'L') }).connectedCheck).toMatchObject({ check: { pass: true } });
    expect(run('bulk-transfer', { unit: 'L' }, { connected: 'yes', quantity: q('1000', 'L'), stirring: 'no' }).connectedCheck).toMatchObject({ check: { pass: false } });
  });
});
