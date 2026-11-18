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
// would leave out what the stage adds and read above 100 %; the master check refuses it). The liquid skeletons
// (syrup, oral drops, suspension, emulsion) come with their blocks.
const WET: StagePlan[] = [
  { key: 'binder', name: 'Binder solution', kind: 'preparation', role: 'Granulation operator', produces: ['binder solution', 24],
    steps: [weighStep('weigh-binder'), { block: 'binder-solution' }] },
  { key: 'granulation', name: 'Granulation', role: 'Granulation operator', rooms: ['Granulation'], produces: ['dried granules', 72], uses: ['binder'],
    steps: [weighStep('weigh-api'), { block: 'sift' }, { block: 'charge', key: 'charge-api' }, { block: 'dry-mix' }, { block: 'granulate', checker: true }, { block: 'dry' },
      { block: 'sieve', key: 'mill' }, yieldStep('')] },
  { key: 'blending', name: 'Blending', role: 'Granulation operator', produces: ['dry syrup powder', 720], uses: ['granulation'],
    steps: [weighStep('weigh-extragranular'), { block: 'dry-mix', key: 'blend' }, { block: 'blend-uniformity' }, yieldStep({ header: 'coreBatch' })] },
];

const SKELETONS: { id: string; name: string; text: string; stages: StagePlan[] }[] = [
  {
    id: 'dry-syrup', name: 'Dry syrup, blended',
    text: 'Sifting and blending of the dispensed materials, blend uniformity, yield in kg.',
    stages: [
      { key: 'blending', name: 'Blending', role: 'Production operator', produces: ['dry syrup powder', 720],
        steps: [weighStep('weigh'), { block: 'sift' }, { block: 'dry-mix', key: 'blend' }, { block: 'blend-uniformity' }, yieldStep({ header: 'coreBatch' })] },
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

// TrueBatch Liquids Packing: the packing record for a pack and its materials. Issue to the line (the bulk tablets and
// each packing material); packing (line clearance, set-up, the camera and serial numbers when serialisation is
// checked, then the periodic checks alongside the line); and the end (finished goods and tablets, every printed
// material, the serial numbers, destruction of coded leftovers, line clearance after). Limits that depend on the
// product (sealing temperature, vacuum) are left for the author; the master check lists them.
const packStep = (block: string, key?: string, settings: Record<string, SettingValue> = {}): Step => {
  const b = findBlock({ id: block, version: 1 })!;
  return { ...stepFrom(b, []), ...(key ? { key } : {}), settings, ...(b.stop ? { flow: { kind: 'repeat-until' as const, maxRounds: 100 } } : {}) };
};
const issueStep = (m: Pack['materials'][number]) => packStep('pack-material-issue', `issue-${m.key}`, { material: { formula: m.key }, unit: m.unit });
const reconcileStep = (m: Pack['materials'][number]) => packStep('printed-reconciliation', `reconcile-${m.key}`, { material: { formula: m.key }, unit: m.unit, issued: { ref: `issue/issue-${m.key}/issued` } });
const packStage = (key: string, name: string, role: string, steps: Step[], roomTypes: string[] = []): Stage => ({ key, name, kind: 'normal', roomTypes, machineTypes: [], role, uses: [], steps });

export function packingStages(pack: Pack): Stage[] {
  const blister = pack.type !== 'bottle';
  const serial = pack.serialisation;
  return [
    packStage('issue', 'Issue to the line', 'Packing operator', [packStep('bulk-issue', 'bulk'), ...pack.materials.map(issueStep)]),
    packStage('packing', 'Packing', 'Packing operator', [packStep('pack-clearance', 'clearance'), packStep('line-setup', 'setup'),
      ...(serial ? [packStep('vision-challenge', 'camera'), packStep('serial-received', 'serials')] : []), packStep('coding-check', 'coding'),
      ...(blister ? [packStep('forming-check', 'forming'), packStep('leak-test', 'leak', { vacuumUnit: 'mbar', level: 'S-2', aql: '0.65' })] : []),
      packStep('online-inspection', 'inspection'), packStep('carton-check', 'cartons'), ...(serial ? [packStep('serial-sample', 'serial-sample')] : [])], ['Packing']),
    packStage('end', 'Reconciliation and line clearance', 'Packing supervisor', [
      packStep('finished-goods', 'finished', { meanWeight: { header: 'coreWeight' }, yieldLimit: { low: '98.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.5', high: '100.5', unit: '%' } }),
      ...pack.materials.filter((m) => m.printed).map(reconcileStep),
      ...(serial ? [packStep('serial-reconciliation', 'serial-reconciliation', { received: { ref: 'packing/serials/received' } })] : []),
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
