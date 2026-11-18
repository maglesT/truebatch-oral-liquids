import { describe, expect, it, vi } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { evaluate } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { small, unplaced } from './engine-fixture.js';
// The shared test master is built from test-only blocks (test/test-blocks.ts).
vi.mock('../shared/blocks/index.js', async (original) => (await import('./test-blocks.js')).withTestBlocks(original as never));
// The problems, without the rooms a stage must name (TL-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

// The TrueBatch Tablets blocks Liquids keeps: each is a description that the format accepts and that a small master can use without
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
  ['sub-batch-combine', { accountabilityLimit: pct('99.0', '100.5') }],
  ['blend-uniformity', { meanLimit: pct('90.0', '110.0'), rsdLimit: { high: '5.0', unit: '%' }, individualLimit: pct('85.0', '115.0') }],
  ['density-flow', { carrLimit: { high: '20', unit: '%' }, hausnerLimit: { high: '1.25', unit: '' }, reposeLimit: { high: '40', unit: '°' } }],
  ['spray-coat', { coreWeight: '100.000 kg', base: 'start', gainLimit: pct('2.8', '3.2'), inletLimit: { low: '50', high: '70', unit: '°C' }, bedLimit: { low: '38', high: '45', unit: '°C' } }, { everyMinutes: 15, flow: { kind: 'repeat-until', maxRounds: 20 } }],
  ['qa-sample', { sampleLimit: { low: '50', high: '60', unit: 'tablets' } }, { flow: { kind: 'qa-hold' } }],
];
const using = (id: string, settings: object, options: object = {}): MasterDoc => {
  const b = findBlock({ id, version: 1 })!;
  const step = { key: id, block: { id, version: 1 }, checker: b.checker, settings, ...options };
  return small([{ role: 'Production operator', steps: b.gmp === 'yield' ? [step] : [step, yieldStep] }]);
};

describe('the Tablets blocks Liquids keeps', () => {
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
