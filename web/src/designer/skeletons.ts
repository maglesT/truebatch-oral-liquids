// Process skeletons a new master may start from: the usual stages and steps of a process, as data. Settings that
// depend on the product (which material a step weighs, its limits) are left for the author; the master check lists
// them. Every stage is worked in a room, so each
// starts with line clearance (TL-10). A later stage's yield is on the actual input of the stage (the previous stage's
// output), unless the stage adds materials (blending: on the batch weight); the granulation end point is checked by a
// second person. A new master names no
// dispensing rooms: the author picks them (Header.tsx). A stage starts with the rooms it usually runs in, by the usual
// area names; a stage whose rooms differ from plant to plant (a binder solution, blending) is left for
// the author: the master check asks for its rooms (TL-11).
import { findBlock } from '../../../shared/blocks/index.js';
import type { MasterDoc, Pack, SettingValue, Stage, Step } from '../../../shared/master/schema.js';
import { stepFrom } from './model.js';

type Header = MasterDoc['header'];
interface StepPlan { block: string; key?: string; name?: string; checker?: boolean; settings?: (h: Header) => Record<string, SettingValue>; minMinutes?: number }
interface StagePlan { key: string; name: string; kind?: Stage['kind']; role: string; rooms?: string[]; produces?: [string, number]; uses?: string[]; steps: StepPlan[] }

const yieldStep = (theoretical: SettingValue): StepPlan => ({ block: 'stage-yield', key: 'yield', settings: () => ({
  theoretical, yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } }) });
const weighStep = (key: string): StepPlan => ({ block: 'weigh', key });
// Dry syrup (powder for oral suspension or solution): blending of the dispensed materials, a blend uniformity test and
// the yield in kg. With granulation: Tablets' wet stages as they are, then blending with the extragranular materials.
// Blending adds materials to the granules, so its yield is on the theoretical batch weight (the granules' output alone
// would leave out what the stage adds and read above 100 %; the master check refuses it).
//
// The liquids (library section 6, S1-S4): the preparations alongside (sugar syrup, the hydrated vehicle, the oil and
// water phases), then manufacturing to the bulk in the holding tank: made up to its volume by weight (the target from
// the header's batch volume and density, I18), transferred, tested (QA hold) and its yield in L. The bulk test and
// yield close the manufacturing stage (every stage that is not a preparation has a yield step), so the bulk is ready
// when it closes (bulk_ready_at); its hold is the stage's (TL-17).
const WET: StagePlan[] = [
  { key: 'binder', name: 'Binder solution', kind: 'preparation', role: 'Granulation operator', produces: ['binder solution', 24],
    steps: [weighStep('weigh-binder'), { block: 'binder-solution' }] },
  { key: 'granulation', name: 'Granulation', role: 'Granulation operator', rooms: ['Granulation'], produces: ['dried granules', 72], uses: ['binder'],
    steps: [weighStep('weigh-api'), { block: 'sift' }, { block: 'charge', key: 'charge-api' }, { block: 'dry-mix' }, { block: 'granulate', checker: true }, { block: 'dry' },
      { block: 'sieve', key: 'mill' }, yieldStep('')] },
  { key: 'blending', name: 'Blending', role: 'Granulation operator', produces: ['dry syrup powder', 720], uses: ['granulation'],
    steps: [weighStep('weigh-extragranular'), { block: 'dry-mix', key: 'blend' }, { block: 'blend-uniformity' }, yieldStep({ header: 'batchMass' })] },
];

const makeUp: StepPlan = { block: 'make-up', settings: () => ({ volume: { header: 'batchVolume' }, density: { header: 'density' }, tolerance: '0.5' }) };
const bulkSteps = (stirred = false): StepPlan[] => [
  { block: 'bulk-transfer', ...(stirred ? { name: 'Transfer the bulk to the holding tank, stirred' } : {}), settings: () => ({ unit: 'L' }) },
  { block: 'bulk-test' },
  { block: 'bulk-yield', key: 'yield', settings: () => ({ unit: 'L', theoretical: { header: 'batchVolume' }, yieldLimit: { low: '97.0', high: '101.0', unit: '%' },
    accountabilityLimit: { low: '99.0', high: '101.0', unit: '%' } }) },
];
const BULK_HOLD = 168;

const SKELETONS: { id: string; name: string; text: string; stages: StagePlan[] }[] = [
  {
    id: 'syrup', name: 'Syrup, oral solution or elixir',
    text: 'Sugar syrup alongside; dispensing, water, dissolving, pH, make-up to volume, filtration, transfer to the holding tank, bulk test and yield.',
    stages: [
      { key: 'syrup', name: 'Sugar syrup', kind: 'preparation', role: 'Manufacturing operator', produces: ['sugar syrup', 24],
        steps: [{ block: 'water' }, weighStep('weigh-sugar'), { block: 'sugar-syrup' }, { block: 'filtration', key: 'filter-syrup' }] },
      { key: 'manufacturing', name: 'Manufacturing', role: 'Manufacturing operator', produces: ['bulk', BULK_HOLD], uses: ['syrup'],
        steps: [weighStep('weigh'), { block: 'water' }, { block: 'charge', key: 'charge-api' }, { block: 'dissolve' }, { block: 'ph-adjust', key: 'ph' }, makeUp,
          { block: 'filtration' }, ...bulkSteps()] },
    ],
  },
  {
    id: 'drops', name: 'Oral drops',
    text: 'A small batch without sugar syrup: dispensing, water, dissolving, pH, make-up to volume, fine filtration, transfer, bulk test and yield.',
    stages: [
      { key: 'manufacturing', name: 'Manufacturing', role: 'Manufacturing operator', produces: ['bulk', BULK_HOLD],
        steps: [weighStep('weigh'), { block: 'water' }, { block: 'charge', key: 'charge-api' }, { block: 'dissolve' }, { block: 'ph-adjust', key: 'ph' }, makeUp,
          { block: 'filtration', name: 'Fine filtration' }, ...bulkSteps()] },
    ],
  },
  {
    id: 'suspension', name: 'Oral suspension',
    text: 'The vehicle alongside (the suspending agent hydrated); dispensing, the API charged and homogenised to its particle size, make-up, mixing, transfer with the stirrer on, bulk test and yield.',
    stages: [
      { key: 'vehicle', name: 'Vehicle', kind: 'preparation', role: 'Manufacturing operator', produces: ['vehicle', 24],
        steps: [{ block: 'water' }, weighStep('weigh-agent'), { block: 'hydrate' }] },
      { key: 'manufacturing', name: 'Manufacturing', role: 'Manufacturing operator', produces: ['bulk', BULK_HOLD], uses: ['vehicle'],
        steps: [weighStep('weigh'), { block: 'charge', key: 'charge-api' }, { block: 'homogenise' }, { block: 'size-check', key: 'size' }, makeUp, { block: 'mix' }, ...bulkSteps(true)] },
    ],
  },
  {
    id: 'emulsion', name: 'Oral emulsion',
    text: 'The oil and water phases alongside; emulsified, homogenised to the droplet size, made up, transferred with the stirrer on, bulk test and yield.',
    stages: [
      { key: 'oil', name: 'Oil phase', kind: 'preparation', role: 'Manufacturing operator', produces: ['oil phase', 24],
        steps: [weighStep('weigh-oil'), { block: 'phase-prep', settings: () => ({ phase: 'oil phase' }) }] },
      { key: 'water', name: 'Water phase', kind: 'preparation', role: 'Manufacturing operator', produces: ['water phase', 24],
        steps: [{ block: 'water' }, weighStep('weigh-aqueous'), { block: 'phase-prep', settings: () => ({ phase: 'water phase' }) }] },
      { key: 'manufacturing', name: 'Emulsify', role: 'Manufacturing operator', produces: ['bulk', BULK_HOLD], uses: ['oil', 'water'],
        steps: [weighStep('weigh'), { block: 'charge', key: 'charge-api' }, { block: 'homogenise' }, { block: 'size-check', key: 'size' }, makeUp, ...bulkSteps(true)] },
    ],
  },
  {
    id: 'dry-syrup', name: 'Dry syrup, blended',
    text: 'Sifting and blending of the dispensed materials, blend uniformity, yield in kg.',
    stages: [
      { key: 'blending', name: 'Blending', role: 'Production operator', produces: ['dry syrup powder', 720],
        steps: [weighStep('weigh'), { block: 'sift' }, { block: 'dry-mix', key: 'blend' }, { block: 'blend-uniformity' }, yieldStep({ header: 'batchMass' })] },
    ],
  },
  {
    id: 'dry-syrup-granulated', name: 'Dry syrup, granulated',
    text: 'Binder solution, granulation and drying, then blending with the extragranular materials.',
    stages: WET,
  },
];
export const SKELETON_LIST = SKELETONS.map(({ id, name, text }) => ({ id, name, text }));

/** The stages of a skeleton for this header. */
export function skeletonStages(id: string, h: Header): Stage[] {
  const sk = SKELETONS.find((s) => s.id === id);
  if (!sk) return [];
  return sk.stages.map((p) => ({
    key: p.key, name: p.name, kind: p.kind ?? 'normal', roomTypes: p.rooms ?? [], machineTypes: [], role: p.role, uses: p.uses ?? [],
    ...(p.produces ? { produces: { name: p.produces[0], holdHours: p.produces[1] } } : {}),
    steps: [{ block: 'line-clearance' }, ...p.steps].reduce<Step[]>((steps, sp) => {
      const block = findBlock({ id: sp.block, version: 1 })!;
      const base = stepFrom(block, steps.map((t) => t.key));
      const settings = Object.fromEntries(Object.entries({ ...base.settings, ...sp.settings?.(h) }).filter(([, v]) => v !== ''));
      return [...steps, { ...base, ...(sp.key ? { key: sp.key } : {}), ...(sp.name ? { name: sp.name } : {}), settings,
        ...(sp.checker ? { checker: true } : {}), ...(sp.minMinutes ? { minMinutes: sp.minMinutes } : {}) }];
    }, []),
  }));
}

// TrueBatch Liquids Packing: the filling and packing record for a pack and its materials (plan section 3, P1-P4). Issue to
// the line (the released bulk and each packing material); filling and packing (line clearance, set-up, the containers
// washed or air-rinsed, the fill with its rounds: a bottle of a solution or drops, a bottle with the bulk stirred for a
// suspension or emulsion, a single-dose unit, or powder by weight; capping, the room alongside, coding, inspection and
// cartons with the measuring device); and the end (the bulk reconciled, every printed material, destruction of coded
// leftovers, line clearance after). Limits that depend on the product (fill, torque, room) are left for the author;
// the master check lists them.
const packStep = (block: string, key?: string, settings: Record<string, SettingValue> = {}): Step => {
  const b = findBlock({ id: block, version: 1 })!;
  return { ...stepFrom(b, []), ...(key ? { key } : {}), settings, ...(b.stop ? { flow: { kind: 'repeat-until' as const, maxRounds: 100 } } : {}) };
};
const issueStep = (m: Pack['materials'][number]) => packStep('pack-material-issue', `issue-${m.key}`, { material: { formula: m.key }, unit: m.unit });
const reconcileStep = (m: Pack['materials'][number]) => packStep('printed-reconciliation', `reconcile-${m.key}`, { material: { formula: m.key }, unit: m.unit, issued: { ref: `issue/issue-${m.key}/issued` } });
const packStage = (key: string, name: string, role: string, steps: Step[], roomTypes: string[] = []): Stage => ({ key, name, kind: 'normal', roomTypes, machineTypes: [], role, uses: [], steps });

export function packingStages(pack: Pack, type?: MasterDoc['header']['type']): Stage[] {
  const powder = type === 'dry syrup';
  const unit = pack.type !== 'bottle';
  const serial = pack.serialisation;
  const fill = powder ? (pack.type === 'sachet' ? 'powder-fill-sachet' : 'powder-fill')
    : unit ? 'liquid-fill-unit' : type === 'suspension' || type === 'emulsion' ? 'liquid-fill-stirred' : 'liquid-fill';
  const accounted = { yieldLimit: { low: '98.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.5', high: '100.5', unit: '%' } };
  return [
    packStage('issue', 'Issue to the line', 'Packing operator', [packStep(powder ? 'powder-bulk-issue' : 'liquid-bulk-issue', 'bulk'), ...pack.materials.map(issueStep)]),
    packStage('filling', 'Filling and packing', 'Packing operator', [packStep('pack-clearance', 'clearance'), packStep('line-setup', 'setup'),
      ...(pack.type === 'bottle' ? [packStep('bottle-wash', 'wash', { what: 'bottles' })] : []),
      packStep(fill, 'fill', powder ? {} : { fillUnit: 'g', ...(unit ? { container: pack.type === 'glass ampoule' ? 'glass ampoule' : pack.type } : {}) }),
      ...(pack.type === 'bottle' && pack.closure !== 'none' ? [packStep('cap-check', 'capping')] : []),
      packStep('room-status', 'room'),
      ...(serial ? [packStep('vision-challenge', 'camera'), packStep('serial-received', 'serials')] : []), packStep('coding-check', 'coding'),
      packStep('online-inspection', 'inspection'), packStep('carton-check', 'cartons'), ...(serial ? [packStep('serial-sample', 'serial-sample')] : [])], ['Packing']),
    packStage('end', 'Reconciliation and line clearance', 'Packing supervisor', [
      packStep(powder ? 'powder-finished-goods' : 'liquid-finished-goods', 'finished', accounted),
      ...pack.materials.filter((m) => m.printed).map(reconcileStep),
      ...(serial ? [packStep('serial-reconciliation', 'serial-reconciliation', { received: { ref: 'filling/serials/received' } })] : []),
      packStep('destruction'), packStep('pack-clearance-after', 'clearance-after')], ['Packing']),
  ];
}

/** Adds the issue and reconciliation steps of packing materials that have none (to the first and last stages). */
export function withMaterialSteps(doc: MasterDoc): MasterDoc {
  const p = doc.pack;
  const first = doc.stages[0];
  const last = doc.stages.at(-1);
  if (!p || !first || !last) return doc;
  const names = (s: Stage, block: string) => s.steps.filter((t) => t.block.id === block).map((t) => (t.settings.material as { formula?: string } | undefined)?.formula);
  const issue = p.materials.filter((m) => !names(first, 'pack-material-issue').includes(m.key)).map(issueStep);
  const recon = p.materials.filter((m) => m.printed && !names(last, 'printed-reconciliation').includes(m.key)).map(reconcileStep);
  const at = Math.max(0, last.steps.findIndex((t) => t.block.id === 'destruction' || t.block.id === 'pack-clearance-after'));
  const stages = doc.stages.map((s, i) => ({ ...s, steps: [...s.steps] }));
  stages[0]!.steps.push(...issue);
  stages.at(-1)!.steps.splice(at, 0, ...recon);
  return { ...doc, stages };
}
