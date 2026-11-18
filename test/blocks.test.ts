import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { doneProblems, evaluate, openSteps, parseKey, type StepEvent, type Value } from '../shared/engine/index.js';
import { readValue } from '../shared/engine/values.js';
import { masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { at, ev, small, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TB-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

// The standard tablet blocks: each is a description that the format accepts and that a small master can use without
// a master-check problem; the engine runs them like any other block.

const pct = (low: string, high: string) => ({ low, high, unit: '%' });
const minutes = { low: '10', high: '12', unit: 'min' };
const yieldStep = { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: pct('97.0', '100.5') } };

// Each new block with the settings a small master gives it (and its step options).
const NEW: [string, Record<string, unknown>, object?][] = [
  ['sift', { sieve: '40 mesh (425 µm)' }],
  ['binder-solution', { binder: { formula: 'x' }, targetSolids: '10 %', tolerance: '1.0', mixTimeLimit: minutes }],
  ['coating-suspension', { powder: { formula: 'x' }, targetSolids: '12 %', tolerance: '1.0', mixTimeLimit: minutes }],
  ['dry-mix', { mixTimeLimit: minutes }],
  ['lubricate', { lubricant: { formula: 'x' }, granuleWeight: '0.098 kg', theoretical: '0.100 kg', window: pct('90.0', '102.0'), tolerance: '1.0', mixTimeLimit: minutes }],
  ['sub-batch-combine', { accountabilityLimit: pct('99.0', '100.5') }],
  ['blend-uniformity', { meanLimit: pct('90.0', '110.0'), rsdLimit: { high: '5.0', unit: '%' }, individualLimit: pct('85.0', '115.0') }],
  ['density-flow', { carrLimit: { high: '20', unit: '%' }, hausnerLimit: { high: '1.25', unit: '' }, reposeLimit: { high: '40', unit: '°' } }],
  ['sieve-analysis', { sieve1: '850 µm', sieve2: '425 µm', sieve3: '250 µm', sieve4: '180 µm', sieve5: '150 µm', finesBelow: '150 µm', finesLimit: { high: '20.0', unit: '%' } }],
  ['punch-die-check', {}],
  ['press-setup', { toolingType: '8.0 mm round, normal concave, plain', pressureLimit: { low: '100', high: '250', unit: 'MPa' } }],
  ['compression-release', { meanLimit: { low: '95.0', high: '105.0', unit: 'mg' }, weightBand: '7.5', weightOuterBand: '15.0', hardnessLimit: { low: '40', high: '80', unit: 'N' }, thicknessLimit: { low: '2.8', high: '3.2', unit: 'mm' } }],
  ['friability', { lossLimit: { high: '1.0', unit: '%' } }],
  ['disintegration', { maxTime: '15', temperatureLimit: { low: '35', high: '39', unit: '°C' } }],
  ['uniformity-by-weight', { coating: 'film-coated', labelClaim: '50 mg' }],
  ['content-uniformity', { coating: 'sugar-coated' }],
  ['spray-coat', { coreWeight: { header: 'coreWeight' }, base: 'start', gainLimit: pct('2.8', '3.2'), inletLimit: { low: '50', high: '70', unit: '°C' }, bedLimit: { low: '38', high: '45', unit: '°C' } }, { everyMinutes: 15, flow: { kind: 'repeat-until', maxRounds: 20 } }],
  ['polish-print', { print: 'Logo in black' }],
  ['qa-sample', { sampleLimit: { low: '50', high: '60', unit: 'tablets' } }, { flow: { kind: 'qa-hold' } }],
  ['tablet-reconciliation', { theoretical: { header: 'batchSize' }, meanWeight: '100.0 mg', yieldLimit: pct('97.0', '100.5'), accountabilityLimit: pct('99.0', '100.5') }],
];
const using = (id: string, settings: object, options: object = {}): MasterDoc => {
  const b = findBlock({ id, version: 1 })!;
  const step = { key: id, block: { id, version: 1 }, checker: b.checker, settings, ...options };
  return small([{ role: 'Production operator', steps: b.gmp === 'yield' ? [step] : [step, yieldStep] }]);
};

describe('the standard tablet blocks', () => {
  it.each(NEW)('the %s block is a valid description, and a small master using it passes the master check', (id, settings, options) => {
    expect(blockProblems(findBlock({ id, version: 1 })!)).toEqual([]);
    expect(checks(using(id, settings, options)).map((p) => `${p.path}: ${p.message}`)).toEqual([]);
  });

  it('a liquid make-up is worked out in the master check before any batch: 0.100 kg binder at 10 % solids needs 0.900 kg of solvent', () => {
    const doc = using('binder-solution', NEW[1]![1]);
    expect(evaluate(doc, [], { stage: 0, sub: 1, step: 0, round: 1 }, {}).makeUp).toMatchObject({ ok: true, value: '0.9', unit: 'kg' });
  });

  it('a binder solution may dissolve several materials (a binder and polysorbate): their quantities count together in the make-up', () => {
    const doc = using('binder-solution', { ...NEW[1]![1], binder2: '0.020 kg' });
    const r = evaluate(doc, [], { stage: 0, sub: 1, step: 0, round: 1 }, {}).makeUp;
    expect(r).toMatchObject({ ok: true, value: '1.08', unit: 'kg', shown: expect.stringContaining('0.020 kg second material') });
    expect(checks(doc).map((p) => p.message)).toEqual([]);
  });

  it('an overage may be set on any line, not only the API: a coating powder made with 10 % spray loss', () => {
    const doc = using('weigh', { target: { formula: 'x', adjusted: true }, tolerance: '0.5' });
    doc.formula[0]!.adjust = { overage: { percent: '10' } };
    expect(evaluate(doc, [], { stage: 0, sub: 1, step: 0, round: 1 }, {}).target).toMatchObject({ ok: true, value: '0.11', unit: 'kg' });
    expect(checks(doc).map((p) => p.message)).toEqual([]);
  });
});

/** Records a step's values (results from the engine) and signs it done, checked by a second person when it needs it. */
function walk(doc: MasterDoc, events: StepEvent[], key: string, values: Record<string, Value>): StepEvent[] {
  const k = parseKey(key)!;
  const uses: number[] = [];
  const results = evaluate(doc, events, k, values, uses);
  const recorded = [...events, ev('started', key), ev('value', key, { payload: { values, results, uses } })];
  const view = openSteps(doc, recorded, at(10_000)).steps.find((s) => s.id === key)!;
  expect(doneProblems(doc, view, at(10_000)), key).toEqual([]);
  const done = [...recorded, ev('done', key)];
  return doc.stages[k.stage]!.steps[k.step]!.checker ? [...done, ev('checked', key, { person: 2 })] : done;
}
const kg = (value: string) => ({ value, unit: 'kg' });
const n = (value: string, unit: string, count: number) => Array.from({ length: count }, () => ({ value, unit }));

describe('the engine runs the new blocks like any other', () => {
  // Granulation gives 0.098 kg of granules; blending lubricates on that weight; compression checks the tooling
  // before and after, sets up the press, releases it and reconciles the tablets.
  const tooling = { key: 'tooling-before', block: { id: 'punch-die-check', version: 1 }, checker: true, settings: {} };
  const doc = small([
    { key: 'granulation', role: 'Granulation operator', steps: [{ ...yieldStep, settings: { ...yieldStep.settings, accountabilityLimit: pct('99.0', '100.5') } }] },
    { key: 'blending', role: 'Granulation operator', steps: [
      { key: 'lubricate', block: { id: 'lubricate', version: 1 }, checker: true, settings: { ...NEW[4]![1], granuleWeight: { ref: 'granulation/yield/output' } } },
      { key: 'blend', block: { id: 'dry-mix', version: 1 }, checker: false, settings: { mixTimeLimit: { low: '3', high: '5', unit: 'min' } } },
      { ...yieldStep, settings: { ...yieldStep.settings, theoretical: '0.098 kg' } }] },
    { key: 'compression', role: 'Compression operator', steps: [tooling,
      { key: 'press-setup', block: { id: 'press-setup', version: 1 }, checker: true, settings: NEW[10]![1] },
      { key: 'release', block: { id: 'compression-release', version: 1 }, checker: true, settings: NEW[11]![1] },
      { ...tooling, key: 'tooling-after' },
      { key: 'reconcile', block: { id: 'tablet-reconciliation', version: 1 }, checker: true, settings: { ...NEW[19]![1], meanWeight: { ref: 'compression/release/meanWeight' } } }] },
  ]);
  const mixing = (from: string, to: string) => ({ mixStart: `2026-11-15T08:${from}:00Z`, mixEnd: `2026-11-15T08:${to}:00Z` });
  const intact = { tooling: 'TS-08-01', upperPunches: 'yes', lowerPunches: 'yes', dies: 'yes', damaged: { value: '0', unit: 'units' } };

  it('record → done, step by step: lubricant re-scaled to the actual granules, tooling checked before and after, tablets reconciled', () => {
    expect(checks(doc)).toEqual([]);
    let e: StepEvent[] = walk(doc, [], '0.1.0.1', { output: kg('0.098'), samples: kg('0.001'), rejects: kg('0.001') });
    // 0.100 kg lubricant × 0.098 kg ÷ 0.100 kg = 0.098 kg; net 0.5980 − 0.5000 = 0.0980 kg
    const lub = { lot: 'L-1', balance: 'BAL-01', gross: kg('0.5980'), tare: kg('0.5000'), machine: 'BLN-01', ...mixing('00', '11') };
    expect(evaluate(doc, e, parseKey('1.1.0.1')!, lub).rescaled).toMatchObject({ ok: true, value: '0.098', unit: 'kg' });
    e = walk(doc, e, '1.1.0.1', lub);
    e = walk(doc, e, '1.1.1.1', { machine: 'BLN-01', speed: { value: '12', unit: 'rpm' }, ...mixing('12', '16') });
    e = walk(doc, e, '1.1.2.1', { output: kg('0.098'), samples: kg('0'), rejects: kg('0') });
    e = walk(doc, e, '2.1.0.1', intact);
    e = walk(doc, e, '2.1.1.1', { machine: 'TP-01', tooling: 'TS-08-01', rightTooling: 'yes', punchFaceArea: { value: '50.3', unit: 'mm²' },
      force: { value: '8.0', unit: 'kN' }, speed: { value: '30', unit: 'rpm' } });
    e = walk(doc, e, '2.1.2.1', { machine: 'TP-01', allStations: 'yes', weights: n('98.0', 'mg', 20), hardness: n('60', 'N', 10), thickness: n('3.0', 'mm', 10), appearance: 'yes' });
    e = walk(doc, e, '2.1.3.1', intact);
    // 0.09604 kg ÷ 98.0 mg = 980 tablets; rejects 0.00098 kg ÷ 98.0 mg = 10; 980 + 10 + 10 = 1000 of 1000
    const counted = { output: kg('0.09604'), rejectWeight: kg('0.00098'), samples: { value: '10', unit: 'tablets' } };
    expect(evaluate(doc, e, parseKey('2.1.4.1')!, counted).accountability).toMatchObject({ ok: true, value: '100', check: { pass: true } });
    e = walk(doc, e, '2.1.4.1', counted);
    const { stages, steps } = openSteps(doc, e, at(10_000));
    expect(stages.map((s) => s.closed)).toEqual([true, true, true]);
    expect(steps.map((s) => s.state)).toEqual(['checked', 'checked', 'done', 'checked', 'checked', 'checked', 'checked', 'checked', 'checked']);
  });

  it('TB-16 a new batch reads the punches or dies damaged in nos, as the floor reads the typed count (17 Nov 2026 run, F22)', () => {
    const f = findBlock({ id: 'punch-die-check', version: 1 })!.fields.find((x) => x.name === 'damaged')!;
    const damaged = readValue(f, '0', f.unit!) as Value;
    expect(damaged).toEqual({ value: '0', unit: 'nos' });
    const r = evaluate(doc, [], parseKey('2.1.0.1')!, { ...intact, damaged });
    expect(r.damagedCheck).toMatchObject({ ok: true, unit: 'nos', check: { pass: true } });
    // Plain when rounding changes nothing: no "0.00 nos rounded to 0 decimals (as the limit is written) = 0 nos".
    expect((r.damagedCheck as { shown: string }).shown).toBe('0 nos; limit not more than 0 nos: within limits');
    expect(JSON.stringify(r.damagedCheck)).not.toContain('units');
  });

  it('TB-16 punches and dies: a damaged punch after use fails the check, so the step needs a deviation note', () => {
    const after = { ...intact, upperPunches: 'no', damaged: { value: '1', unit: 'units' } };
    const r = evaluate(doc, [], parseKey('2.1.3.1')!, after);
    expect(r.toolingCheck).toMatchObject({ ok: true, check: { pass: false } });
    expect(r.damagedCheck).toMatchObject({ ok: true, check: { pass: false } });
    const one = small([{ steps: [{ ...tooling, settings: {} }] }]);
    const events = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values: after, results: r } })];
    const v = (x: StepEvent[]) => doneProblems(one, openSteps(one, x, at(5)).steps[0]!, at(5));
    expect(v(events)).toEqual(['Out of limits: Punches and dies, Damaged punches and dies. Add a deviation note first.']);
    expect(v([...events, ev('note', '0.1.0.1', { min: 2, payload: { text: 'Upper punch 7 chipped; tooling sent for repair' } })])).toEqual([]);
  });

  it('a staged test: disintegration needs the 12 more tablets only when 1 or 2 of the first 6 fail', () => {
    const d = using('disintegration', NEW[13]![1]);
    const key = { stage: 0, sub: 1, step: 0, round: 1 };
    const times = (s: string) => s.split(' ').map((value) => ({ value, unit: 'min' }));
    expect(evaluate(d, [], key, { times: times('5 6 7 8 9 10') }).stages).toMatchObject({ ok: true, decision: 'pass' });
    expect(evaluate(d, [], key, { times: times('5 6 7 8 9 16') }).stages).toMatchObject({ ok: true, decision: 'next stage', nextStageUnits: 12 });
    expect(evaluate(d, [], key, { times: times('5 6 7 8 9 16'), moreTimes: times('5 6 7 8 9 10 5 6 7 8 9 10') }).stages).toMatchObject({ ok: true, decision: 'pass' });
  });
});
