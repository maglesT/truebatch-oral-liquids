// The sweep: every block of the library (tablets and packing) in a small master with all its settings set, and the
// test masters, worked out with every field filled ("1" for a number, yes, the first option), once with the required
// fields only and once with all, in a first and a second round. A template may refuse what it is given; it must never
// crash on it (a crash is "could not use these inputs": the step could not be signed).
import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock, type Block } from '../shared/blocks/index.js';
import { evaluate, type StepEvent, type Value } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc, type Step } from '../shared/master/schema.js';
import { at, ev, tablet } from './engine-fixture.js';
import { GTIN, pack, packing } from './packing-fixture.js';

const pct = (low: string, high: string) => ({ low, high, unit: '%' });
const minutes = { low: '10', high: '12', unit: 'min' };
const weights = { meanLimit: { low: '95.0', high: '105.0', unit: 'mg' }, weightBand: '5.0', weightOuterBand: '10.0', hardnessLimit: { low: '40', high: '80', unit: 'N' },
  thicknessLimit: { low: '2.8', high: '3.2', unit: 'mm' } };
// Every setting of every block that has settings, optional ones too.
const SETTINGS: Record<string, Step['settings']> = {
  weigh: { target: { formula: 'x', adjusted: true }, tolerance: '0.5' },
  charge: { material: { formula: 'x' } },
  sift: { sieve: '40 mesh (425 µm)' },
  'binder-solution': { binder: { formula: 'x' }, binder2: '0.020 kg', binder3: '0.010 kg', targetSolids: '10 %', tolerance: '1.0', mixTimeLimit: minutes },
  'coating-suspension': { powder: { formula: 'x' }, targetSolids: '12 %', tolerance: '1.0', mixTimeLimit: minutes },
  'dry-mix': { speedLimit: { low: '10', high: '20', unit: 'rpm' }, mixTimeLimit: minutes },
  mix: { speedLimit: { low: '10', high: '20', unit: 'rpm' } },
  granulate: { endPointLimit: { low: '8.0', high: '12.0', unit: 'kW' } },
  dry: { lodLimit: { high: '2.0', unit: '%' } },
  'dry-constant': { maxChange: '0.5 g' },
  lubricate: { lubricant: { formula: 'x' }, granuleWeight: '0.098 kg', theoretical: '0.100 kg', window: pct('90.0', '102.0'), tolerance: '1.0', mixTimeLimit: minutes },
  'sub-batch-combine': { accountabilityLimit: pct('99.0', '100.5') },
  'blend-uniformity': { meanLimit: pct('90.0', '110.0'), rsdLimit: { high: '5.0', unit: '%' }, individualLimit: pct('85.0', '115.0') },
  'density-flow': { carrLimit: { high: '20', unit: '%' }, hausnerLimit: { high: '1.25', unit: '' }, reposeLimit: { high: '40', unit: '°' } },
  'sieve-analysis': { sieve1: '850 µm', sieve2: '425 µm', sieve3: '250 µm', sieve4: '180 µm', sieve5: '150 µm', finesBelow: '150 µm', finesLimit: { high: '20.0', unit: '%' },
    recoveryLimit: pct('98.0', '102.0') },
  'press-setup': { toolingType: '8.0 mm round', pressureLimit: { low: '100', high: '250', unit: 'MPa' }, speedLimit: { low: '10', high: '60', unit: 'rpm' } },
  'compression-release': weights,
  compress: weights,
  friability: { lossLimit: { high: '1.0', unit: '%' } },
  disintegration: { maxTime: '15', temperatureLimit: { low: '35', high: '39', unit: '°C' } },
  'uniformity-by-weight': { coating: 'uncoated', labelClaim: '50 mg' },
  'content-uniformity': { coating: 'uncoated' },
  coat: { coreWeight: { header: 'coreWeight' }, gainLimit: pct('2.8', '3.2') },
  'spray-coat': { coreWeight: { header: 'coreWeight' }, base: 'start', gainLimit: pct('2.8', '3.2'), inletLimit: { low: '50', high: '70', unit: '°C' },
    bedLimit: { low: '35', high: '45', unit: '°C' }, sprayRateLimit: { low: '50', high: '150', unit: 'g/min' } },
  'polish-print': { print: 'Logo in black' },
  check: { what: 'Weight', unit: 'mg', limit: { low: '95', high: '105', unit: 'mg' } },
  'qa-sample': { sampleLimit: { low: '50', high: '60', unit: 'tablets' } },
  'stage-yield': { theoretical: { header: 'coreBatch' }, yieldLimit: pct('97.0', '100.5'), accountabilityLimit: pct('99.0', '100.5') },
  'tablet-reconciliation': { theoretical: { header: 'batchSize' }, meanWeight: '100.0 mg', yieldLimit: pct('97.0', '100.5'), accountabilityLimit: pct('99.0', '100.5') },
  'pack-material-issue': { material: { formula: 'foil' }, unit: 'm' },
  'forming-check': { sealLimit: { low: '160', high: '190', unit: '°C' }, formLimit: { low: '110', high: '140', unit: '°C' } },
  'leak-test': { vacuumUnit: 'mbar', vacuumLimit: { low: '400', high: '600', unit: 'mbar' }, level: 'S-1', aql: '0' },
  'finished-goods': { meanWeight: { header: 'coreWeight' }, yieldLimit: pct('98.0', '100.5'), accountabilityLimit: pct('99.5', '100.5') },
  'printed-reconciliation': { material: { formula: 'foil' }, unit: 'm', issued: '100 m' },
  'serial-reconciliation': { received: '1000 nos' },
};

const item = { itemId: 'eq-1', code: 'EQ-01', name: 'Equipment', version: 1, type: 'balance', room: 'RM-1', area: 'Area' };
/** Every field filled (or the required ones only): "1" in its unit, yes, the first option, a time a few minutes apart. */
function filled(b: Block, settings: Step['settings'], all: boolean): Record<string, Value> {
  let minute = 0;
  const one = (f: Block['fields'][number]): Value => {
    if (f.kind === 'number') {
      const u = f.unit?.startsWith('$') ? settings[f.unit.slice(1)] : f.unit;
      const q = { value: '1', unit: typeof u === 'string' ? u : '' };
      return f.count ? Array.from({ length: f.count }, () => q) : q;
    }
    if (f.kind === 'yes-no') return 'yes';
    if (f.kind === 'choice') return f.options![0]!;
    if (f.kind === 'timer') return `${at(minute += 11).toISOString().slice(0, 19)}Z`;
    if (f.kind === 'machine' || f.kind === 'room') return item;
    if (f.kind === 'bulk') return 'TB260001';
    if (f.kind === 'lot') return 'L-1';
    return f.date ? '2026-11-03' : '1';
  };
  return Object.fromEntries(b.fields.filter((f) => all || !f.optional).map((f) => [f.name, one(f)]));
}

/** The calculations that crashed, as "step calc: message". */
function crashes(doc: MasterDoc, all: boolean): string[] {
  const events: StepEvent[] = [];
  const out: string[] = [];
  for (const [si, s] of doc.stages.entries()) for (const [ti, t] of s.steps.entries()) {
    const b = findBlock(t.block)!;
    const values = filled(b, t.settings, all);
    for (const round of [1, 2]) {
      const key = `${si}.1.${ti}.${round}`;
      const results = evaluate(doc, events, { stage: si, sub: 1, step: ti, round }, values);
      for (const [n, r] of Object.entries(results)) if (!r.ok && /could not use these inputs/.test(r.message)) out.push(`${s.key}/${t.key} ${n}: ${r.message}`);
      events.push(ev('started', key), ev('value', key, { payload: { values, results } }));
    }
  }
  return out;
}

const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '1000', coreWeightMg: '100.0', coatedWeightMg: '103.0', dispensingRooms: ['DSP-01'] };
const formula = [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', mgPerTablet: '100.0', role: 'api', place: 'intragranular',
  adjust: { potency: { basis: 'as is', standardIs: 'anhydrous' }, overage: { percent: '2' } } }];
/** A small master of one block with all its settings set; a packing block after the bulk issue (its batch facts). */
function using(b: Block): MasterDoc {
  const step = (x: Block) => ({ key: x.id, block: { id: x.id, version: x.version }, checker: x.checker, settings: SETTINGS[x.id] ?? {} });
  const bulk = findBlock({ id: 'bulk-issue', version: 1 })!;
  const steps = b.packing && b.id !== bulk.id ? [step(bulk), step(b)] : [step(b)];
  return masterSchema.parse({ header, formula, stages: [{ key: 's', name: 'Stage', kind: 'normal', steps }], ...(b.packing ? { pack: pack({ gtin: GTIN, serialisation: true }) } : {}) });
}

describe('the sweep: no template crashes on any block or test master', () => {
  it.each(BLOCKS.map((b) => [b.id, b] as const))('%s: all its settings set, its fields filled, required only or all, in two rounds', (id, b) => {
    expect(Object.keys(SETTINGS[id] ?? {}).sort()).toEqual(b.settings.map((s) => s.name).sort());
    for (const all of [false, true]) expect(crashes(using(b), all)).toEqual([]);
    // Its limits and targets are of the kinds of the values they check (TB-01).
    expect(masterChecks(using(b)).filter((p) => /every reading would be refused/.test(p.message))).toEqual([]);
  });

  it.each([['tablet', tablet()], ['packing', packing()], ['packing, serialised', packing({ gtin: GTIN, serialisation: true })],
    ['packing, bottles', packing({ type: 'bottle' })]] as const)('the %s test master', (_name, doc) => {
    for (const all of [false, true]) expect(crashes(doc, all)).toEqual([]);
    expect(masterChecks(doc).filter((p) => /every reading would be refused/.test(p.message))).toEqual([]);
  });
});
