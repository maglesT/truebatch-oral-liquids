import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import type { EventKind, Payload, StepEvent, StepKey } from '../shared/engine/index.js';

// An invented film-coated tablet, 100 mg of an invented API, batch of 100 000 tablets (core 250.0 mg, coated
// 257.5 mg). Core: 100.0 + 120.0 + 10.0 + 17.5 + 2.5 = 250.0 mg; the granulation water is a solvent.
export const tablet = (): MasterDoc => masterSchema.parse({
  header: { productItemId: 'prd-1', productCode: 'PRD-001', productName: 'Examplol 100 mg film-coated tablets', batchSize: '100000', coreWeightMg: '250.0', coatedWeightMg: '257.5', dispensingRooms: ['DSP-01'] },
  formula: [
    { key: 'api', materialItemId: 'mat-api', code: 'MAT-001', name: 'Examplol', mgPerTablet: '100.0', role: 'api', place: 'intragranular', adjust: { potency: { basis: 'dried', standardIs: 'anhydrous' } } },
    { key: 'lactose', materialItemId: 'mat-lac', code: 'MAT-002', name: 'Lactose monohydrate', mgPerTablet: '120.0', role: 'excipient', place: 'intragranular', adjust: { compensates: ['api'] } },
    { key: 'pvp', materialItemId: 'mat-pvp', code: 'MAT-003', name: 'Povidone K30', mgPerTablet: '10.0', role: 'excipient', place: 'binder' },
    { key: 'water', materialItemId: 'mat-wat', code: 'MAT-004', name: 'Purified water', mgPerTablet: '50.0', role: 'solvent', place: 'binder' },
    { key: 'mcc', materialItemId: 'mat-mcc', code: 'MAT-005', name: 'Microcrystalline cellulose', mgPerTablet: '17.5', role: 'excipient', place: 'extragranular' },
    { key: 'mgst', materialItemId: 'mat-mgs', code: 'MAT-006', name: 'Magnesium stearate', mgPerTablet: '2.5', role: 'excipient', place: 'extragranular' },
    { key: 'coat', materialItemId: 'mat-cot', code: 'MAT-007', name: 'Film coating system', mgPerTablet: '7.5', role: 'excipient', place: 'coating', layer: 1 },
  ],
  stages: [
    {
      key: 'binder', name: 'Binder solution', kind: 'preparation', machineTypes: ['balance', 'stirrer'], role: 'Granulation operator',
      produces: { name: 'binder solution', holdHours: 24 },
      steps: [
        { key: 'weigh-pvp', block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'pvp' }, tolerance: '0.5' } },
        { key: 'stir', block: { id: 'mix', version: 1 }, checker: false, minMinutes: 10 },
      ],
    },
    {
      key: 'granulation', name: 'Granulation', kind: 'normal', machineTypes: ['balance', 'granulator', 'dryer', 'mill'], uses: ['binder'], role: 'Granulation operator',
      produces: { name: 'dried granules', holdHours: 72 },
      steps: [
        { key: 'weigh-api', block: { id: 'weigh', version: 1 }, checker: true, critical: true, settings: { target: { formula: 'api', adjusted: true }, tolerance: '0.5' } },
        { key: 'weigh-lactose', block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'lactose', adjusted: true }, tolerance: '0.5' } },
        { key: 'charge-api', block: { id: 'charge', version: 1 }, checker: true, settings: { material: { formula: 'api' } } },
        { key: 'granulate', block: { id: 'granulate', version: 1 }, checker: false, settings: { endPointLimit: { low: '8.0', high: '12.0', unit: 'kW' } } },
        { key: 'dry', block: { id: 'dry', version: 1 }, checker: false, flow: { kind: 'repeat-until', maxRounds: 5 }, settings: { lodLimit: { high: '2.0', unit: '%' } } },
        { key: 'mill', block: { id: 'sieve', version: 1 }, checker: true },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '23.000 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
    {
      key: 'compression', name: 'Compression', kind: 'normal', machineTypes: ['tablet press'], uses: ['granulation'], role: 'Compression operator',
      produces: { name: 'core tablets', holdHours: 720 },
      steps: [
        { key: 'compress', block: { id: 'compress', version: 1 }, checker: false, everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 40 },
          settings: { meanLimit: { low: '245.0', high: '255.0', unit: 'mg' }, weightBand: '5.0', weightOuterBand: '10.0', hardnessLimit: { low: '60', high: '120', unit: 'N' }, thicknessLimit: { low: '3.8', high: '4.2', unit: 'mm' } } },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: { header: 'coreBatch' }, yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
    {
      key: 'coating', name: 'Coating', kind: 'sub-batch', count: 2, machineTypes: ['coater'], uses: ['compression'], role: 'Coating operator',
      produces: { name: 'coated tablets', holdHours: 2160 },
      steps: [
        { key: 'coat', block: { id: 'coat', version: 1 }, checker: false, flow: { kind: 'repeat-until', maxRounds: 10 }, settings: { coreWeight: { ref: 'compression/compress/meanWeight' }, gainLimit: { low: '2.8', high: '3.2', unit: '%' } } },
        { key: 'qa-hold', block: { id: 'check', version: 1 }, checker: false, flow: { kind: 'qa-hold' }, settings: { what: 'Appearance score', unit: '', limit: { low: '4', unit: '' } } },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '12.875 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
  ],
});

/**
 * The fixture as a master names where its stages run (TB-10, TB-11): each stage allows the rooms of its own name as
 * an area, and starts with line clearance. Most tests leave this out: their checks are filtered by `unplaced`.
 */
export function placed(doc: MasterDoc): MasterDoc {
  const clearance = { key: 'clearance', block: { id: 'line-clearance', version: 1 }, settings: {}, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' as const } };
  return { ...doc, stages: doc.stages.map((s) => ({ ...s, roomTypes: s.roomTypes.length ? s.roomTypes : [s.name],
    steps: s.steps.some((t) => t.block.id === 'line-clearance') ? s.steps : [clearance, ...s.steps] })) };
}
/** Leaves out the problems of stages that name no rooms (TB-11, tested in master-checks.test.ts). */
export const unplaced = <T extends { rule?: string; path: string }>(problems: T[]) => problems.filter((p) => !(p.rule === 'TB-11' && p.path.endsWith('.roomTypes')));

/** A small master with the given stages; each step defaults to a "check a value" step without a checker. */
export function small(stages: object[]): MasterDoc {
  return masterSchema.parse({
    header: { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '1000', coreWeightMg: '100.0', dispensingRooms: ['DSP-01'] },
    formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', mgPerTablet: '100.0', role: 'excipient', place: 'intragranular' }],
    stages: stages.map((s, i) => ({ key: `s${i}`, name: `Stage ${i}`, kind: 'normal', ...s,
      steps: ((s as { steps?: object[] }).steps ?? [{}]).map((t, j) => ({ key: `t${j}`, block: { id: 'check', version: 1 }, checker: false,
        settings: { what: 'pH', unit: '', limit: { low: '5.0', high: '7.0', unit: '' } }, ...t })) })),
  });
}

export const T0 = new Date('2026-11-15T08:00:00Z');
export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** An event list builder: ev('done', '0.1.0.1', { person: 2, min: 5 }). */
let next = 1;
export function ev(kind: EventKind, key: string, o: { person?: number | null; min?: number; payload?: Payload } = {}): StepEvent {
  const [stage, sub, step, round] = key.split('.').map(Number) as [number, number, number, number];
  const k: StepKey = { stage, sub, step, round };
  return { id: next++, ...k, kind, payload: o.payload ?? {}, person: o.person === undefined ? 1 : o.person, at: at(o.min ?? next) };
}
/** A value event whose results are those of the engine for these values. */
export const reading = (key: string, results: Record<string, unknown>, o: { person?: number; min?: number } = {}) =>
  ev('value', key, { ...o, payload: { values: {}, results: results as Payload['results'] } });
export const pass = { ok: true, value: '1', unit: '', shown: '', check: { pass: true, level: 'pass', shown: '' } };
export const fail = { ok: true, value: '9', unit: '', shown: '', check: { pass: false, level: 'fail', shown: '' } };
