/**
 * Packing master checks (TrueBatch Liquids Packing, docs/rules.md TL-P1 to TL-P10): what a packing master must hold
 * before it can be approved. Each problem is an error. The formula and calculation checks do not apply to it.
 */
import { findBlock, GENERAL_BLOCKS } from '../blocks/index.js';
import { BULK_ISSUE } from '../engine/stock.js';
import type { Problem } from './checks.js';
import type { MasterDoc, Stage, Step } from './schema.js';

interface At { s: Stage; si: number; t: Step; ti: number; path: string }
const SERIAL = ['vision-challenge', 'serial-received', 'serial-sample', 'serial-reconciliation'];
const FILLS = ['liquid-fill', 'liquid-fill-stirred', 'liquid-fill-unit', 'powder-fill', 'powder-fill-sachet'];
const FINISHED = ['liquid-finished-goods', 'powder-finished-goods'];
const nameOf = (id: string) => findBlock({ id, version: 1 })?.name.toLowerCase() ?? id;
const material = (x: At | undefined, key = 'material') => { const v = x?.t.settings[key]; return typeof v === 'object' && 'formula' in v ? v.formula : undefined; };

export function packingChecks(doc: MasterDoc): Problem[] {
  const out: Problem[] = [];
  const p = doc.pack;
  if (!p) return out;
  const error = (path: string, message: string, rule: string) => out.push({ level: 'error', path, message, rule });
  const steps: At[] = doc.stages.flatMap((s, si) => s.steps.map((t, ti) => ({ s, si, t, ti, path: `stages[${si}].steps[${ti}]` })));
  const of = (id: string) => steps.filter((x) => x.t.block.id === id);
  const pos = (x: At) => x.si * 1000 + x.ti;
  const refTo = (x: At, setting: string) => {
    const v = x.t.settings[setting];
    const [sk, tk, name] = (typeof v === 'object' && 'ref' in v ? v.ref : '').split('/');
    return { at: steps.find((y) => y.s.key === sk && y.t.key === tk), name };
  };

  // TL-P1: the pack, its materials and where the batch coding goes; the bulk type and the fill.
  const powder = doc.header.type === 'dry syrup';
  if (!doc.header.type) error('header.type', 'Choose the type of the bulk filled (solution, drops, suspension, emulsion or dry syrup)', 'TL-P1');
  if (powder && !p.fillWeightG) error('pack.fillWeightG', 'The fill weight of powder per container is not set', 'TL-P1');
  if (!powder && !p.fillVolumeMl) error('pack.fillVolumeMl', 'The nominal fill volume is not set (the fill target is the nominal fill + its excess, never below it)', 'TL-P1');
  if (!powder && p.type !== 'bottle' && p.fillExcessMl && Number(p.fillExcessMl) > 0) {
    out.push({ level: 'warning', path: 'pack.fillExcessMl', message: `A ${p.type} is a single dose: the dose is the whole unit, so a fill excess is given only for what stays behind in it (hold-up)`, rule: 'TL-P1' });
  }
  if (doc.formula.length) error('formula', 'A packing master has no formula: its materials are the packing materials', 'TL-P1');
  if (!p.materials.length) error('pack.materials', 'The packing master lists no packing materials', 'TL-P1');
  else if (!p.materials.some((m) => m.coded)) error('pack.materials', 'No packing material carries the batch coding: mark the materials the batch number, dates and MRP are printed on', 'TL-P1');
  p.materials.forEach((m, i) => p.materials.findIndex((x) => x.key === m.key) !== i && error(`pack.materials[${i}]`, `The key ${m.key} is used twice`, 'TL-P1'));
  if (p.destination === 'India domestic' && !p.mrp) error('pack.mrp', 'A pack for India domestic needs its MRP: it is printed on the pack and checked', 'TL-P9');
  if (p.serialisation && !p.gtin) error('pack.gtin', 'Checking serialisation needs the pack GTIN', 'TL-P5');
  for (const x of steps) {
    const b = findBlock(x.t.block);
    if (b && !b.packing && !GENERAL_BLOCKS.includes(b.id)) error(x.path, `${b.name} is a manufacturing step: a packing master uses the packing steps`, 'TL-P1');
  }

  // TL-P2: the record starts from the released bulk batch.
  const issueId = powder ? 'powder-bulk-issue' : 'liquid-bulk-issue';
  if (doc.stages[0]?.steps[0]?.block.id !== issueId) error('stages', `The packing record starts with the ${nameOf(issueId)}: it links the record to the released bulk batch`, 'TL-P2');
  steps.filter((x) => BULK_ISSUE.includes(x.t.block.id)).slice(1).forEach((x) => error(x.path, 'The bulk is issued once, as the first step', 'TL-P2'));

  // TL-P3: line clearance before and after; strips and blisters formed, sealed and leak tested.
  const setup = of('line-setup')[0];
  if (!of('pack-clearance').some((c) => !setup || pos(c) < pos(setup))) error('stages', 'Line clearance before packing is missing, or comes after the line set-up', 'TL-P3');
  if (doc.stages.at(-1)?.steps.at(-1)?.block.id !== 'pack-clearance-after') error('stages', 'The packing record ends with line clearance after packing', 'TL-P3');

  // TL-P4: every material issued before the line set-up, and the components checked against this master there.
  if (!setup) error('stages', 'The line set-up and component check is missing', 'TL-P4');
  p.materials.forEach((m, i) => {
    const issue = of('pack-material-issue').find((x) => material(x) === m.key);
    if (!issue) error(`pack.materials[${i}]`, `${m.name} has no issue step`, 'TL-P4');
    else if (setup && pos(issue) > pos(setup)) error(issue.path, `${m.name} is issued after the line set-up`, 'TL-P4');
    if (m.printed && !of('printed-reconciliation').some((x) => material(x) === m.key)) error(`pack.materials[${i}]`, `The printed ${m.name} has no reconciliation step`, 'TL-P6');
    // Its steps count in the material's unit (a unit changed after the steps were added left them in the old one).
    for (const x of [...of('pack-material-issue'), ...of('printed-reconciliation')].filter((y) => material(y) === m.key && y.t.settings.unit !== m.unit)) {
      error(`${x.path}.settings.unit`, `${m.name} is counted in ${m.unit} in the packing materials, but this step in ${String(x.t.settings.unit)}: make them the same`, 'TL-P4');
    }
  });

  // TL-P4 (US 211.94(c), SCHM-IX 2.8): bottles are washed or air-rinsed before they are filled.
  const fills = steps.filter((x) => FILLS.includes(x.t.block.id));
  const wash = of('bottle-wash')[0];
  if (p.type === 'bottle' && (!wash || (fills[0] && pos(wash) > pos(fills[0])))) error('stages', 'The bottles are washed or air-rinsed before filling: the container wash step is missing, or comes after the fill', 'TL-P4');

  // TL-P10: one fill step of the bulk's kind, with its rounds; a suspension or emulsion stirred during filling; the
  // filling room's temperature (India: not above 30 °C, SCHM-IX 4.4).
  if (fills.length !== 1) error('stages', 'The packing record has one fill step (its rounds check the fill)', 'TL-P10');
  for (const x of fills) {
    const id = x.t.block.id;
    if (powder !== id.startsWith('powder')) error(x.path, `${findBlock(x.t.block)!.name} does not fill a ${powder ? 'dry syrup powder' : 'liquid'}`, 'TL-P10');
    if ((doc.header.type === 'suspension' || doc.header.type === 'emulsion') && id === 'liquid-fill') error(x.path, `A ${doc.header.type} is kept stirred during filling: use the fill step with the bulk stirred`, 'TL-P10');
  }
  const room = of('room-status')[0];
  const roomHigh = room && room.t.settings.temperatureLimit;
  if (p.destination === 'India domestic') {
    if (!room) error('stages', 'A pack for India domestic records the filling room temperature (not above 30 °C): the room conditions step is missing', 'TL-P10');
    else if (typeof roomHigh === 'object' && 'unit' in roomHigh && roomHigh.unit === '°C' && roomHigh.high && Number(roomHigh.high) > 30) {
      error(`${room.path}.settings.temperatureLimit`, 'The filling room is not above 30 °C for India domestic (Schedule M Part IX)', 'TL-P10');
    }
  }

  // TL-P5: coding checked at the start and at intervals; packs inspected on line.
  if (!of('coding-check').length) error('stages', 'The coding check (at the start and at intervals) is missing', 'TL-P5');
  if (!of('online-inspection').length) error('stages', 'The on-line inspection is missing', 'TL-P5');

  // TL-P6: finished goods and the bulk reconciled, every printed material reconciled from its own issue, coded
  // leftovers destroyed; the checks alongside the line end before the reconciliation.
  const finish = steps.filter((x) => FINISHED.includes(x.t.block.id));
  if (!finish.length) error('stages', 'The finished goods and reconciliation of the bulk step is missing', 'TL-P6');
  if (p.materials.some((m) => m.coded) && !of('destruction').length) error('stages', 'Batch-coded leftovers need the destruction step', 'TL-P6');
  for (const x of of('printed-reconciliation')) {
    const r = refTo(x, 'issued');
    if (r.at?.t.block.id !== 'pack-material-issue' || r.name !== 'issued' || material(r.at) !== material(x)) error(`${x.path}.settings.issued`, 'The quantity issued comes from the issue step of the same material', 'TL-P6');
  }
  for (const x of steps) {
    if (findBlock(x.t.block)?.periodic?.alongside && finish.some((f) => f.si <= x.si)) error(x.path, `${findBlock(x.t.block)!.name} runs alongside the line: put it in a stage before the finished goods`, 'TL-P6');
  }

  // Serialisation (optional per product): checked, never generated.
  for (const id of SERIAL) {
    const has = of(id).length > 0;
    if (p.serialisation && !has) error('stages', `Serialisation is checked for this pack: the ${nameOf(id)} step is missing`, 'TL-P5');
    if (!p.serialisation && has && id !== 'vision-challenge') error(of(id)[0]!.path, `Serialisation is not checked for this pack: remove the ${nameOf(id)} step, or switch serialisation on`, 'TL-P1');
  }
  for (const x of of('serial-reconciliation')) {
    const r = refTo(x, 'received');
    if (r.at?.t.block.id !== 'serial-received' || r.name !== 'received') error(`${x.path}.settings.received`, 'The serial numbers received come from the serial numbers received step', 'TL-P5');
  }
  return out;
}
