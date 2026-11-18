/**
 * Packing master checks (TrueBatch Tablets Packing, docs/rules.md TB-P1 to TB-P9): what a packing master must hold
 * before it can be approved. Each problem is an error. The tablet formula and calculation checks do not apply to it.
 */
import { findBlock, GENERAL_BLOCKS } from '../blocks/index.js';
import type { Problem } from './checks.js';
import type { MasterDoc, Stage, Step } from './schema.js';

interface At { s: Stage; si: number; t: Step; ti: number; path: string }
const SERIAL = ['vision-challenge', 'serial-received', 'serial-sample', 'serial-reconciliation'];
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

  // TB-P1: the pack, its materials and where the batch coding goes.
  if (doc.formula.length) error('formula', 'A packing master has no formula: its materials are the packing materials', 'TB-P1');
  if (!p.materials.length) error('pack.materials', 'The packing master lists no packing materials', 'TB-P1');
  else if (!p.materials.some((m) => m.coded)) error('pack.materials', 'No packing material carries the batch coding: mark the materials the batch number, dates and MRP are printed on', 'TB-P1');
  p.materials.forEach((m, i) => p.materials.findIndex((x) => x.key === m.key) !== i && error(`pack.materials[${i}]`, `The key ${m.key} is used twice`, 'TB-P1'));
  if (p.destination === 'India domestic' && !p.mrp) error('pack.mrp', 'A pack for India domestic needs its MRP: it is printed on the pack and checked', 'TB-P9');
  if (p.serialisation && !p.gtin) error('pack.gtin', 'Checking serialisation needs the pack GTIN', 'TB-P5');
  for (const x of steps) {
    const b = findBlock(x.t.block);
    if (b && !b.packing && !GENERAL_BLOCKS.includes(b.id)) error(x.path, `${b.name} is a tablet manufacturing step: a packing master uses the packing steps`, 'TB-P1');
  }

  // TB-P2: the record starts from the released bulk batch.
  if (doc.stages[0]?.steps[0]?.block.id !== 'bulk-issue') error('stages', 'The packing record starts with the bulk tablets issued to the line: it links the record to the released bulk batch', 'TB-P2');
  of('bulk-issue').slice(1).forEach((x) => error(x.path, 'The bulk tablets are issued once, as the first step', 'TB-P2'));

  // TB-P3: line clearance before and after; strips and blisters formed, sealed and leak tested.
  const setup = of('line-setup')[0];
  if (!of('pack-clearance').some((c) => !setup || pos(c) < pos(setup))) error('stages', 'Line clearance before packing is missing, or comes after the line set-up', 'TB-P3');
  if (doc.stages.at(-1)?.steps.at(-1)?.block.id !== 'pack-clearance-after') error('stages', 'The packing record ends with line clearance after packing', 'TB-P3');
  if (p.type !== 'bottle') for (const id of ['forming-check', 'leak-test']) if (!of(id).length) error('stages', `A ${p.type} pack needs the ${nameOf(id)} step`, 'TB-P3');

  // TB-P4: every material issued before the line set-up, and the components checked against this master there.
  if (!setup) error('stages', 'The line set-up and component check is missing', 'TB-P4');
  p.materials.forEach((m, i) => {
    const issue = of('pack-material-issue').find((x) => material(x) === m.key);
    if (!issue) error(`pack.materials[${i}]`, `${m.name} has no issue step`, 'TB-P4');
    else if (setup && pos(issue) > pos(setup)) error(issue.path, `${m.name} is issued after the line set-up`, 'TB-P4');
    if (m.printed && !of('printed-reconciliation').some((x) => material(x) === m.key)) error(`pack.materials[${i}]`, `The printed ${m.name} has no reconciliation step`, 'TB-P6');
  });

  // TB-P5: coding checked at the start and at intervals; packs inspected on line.
  if (!of('coding-check').length) error('stages', 'The coding check (at the start and at intervals) is missing', 'TB-P5');
  if (!of('online-inspection').length) error('stages', 'The on-line inspection is missing', 'TB-P5');

  // TB-P6: finished goods and tablets reconciled, every printed material reconciled from its own issue, coded
  // leftovers destroyed; the checks alongside the line end before the reconciliation.
  const finish = of('finished-goods');
  if (!finish.length) error('stages', 'The finished goods and reconciliation of tablets step is missing', 'TB-P6');
  if (p.materials.some((m) => m.coded) && !of('destruction').length) error('stages', 'Batch-coded leftovers need the destruction step', 'TB-P6');
  for (const x of of('printed-reconciliation')) {
    const r = refTo(x, 'issued');
    if (r.at?.t.block.id !== 'pack-material-issue' || r.name !== 'issued' || material(r.at) !== material(x)) error(`${x.path}.settings.issued`, 'The quantity issued comes from the issue step of the same material', 'TB-P6');
  }
  for (const x of steps) {
    if (findBlock(x.t.block)?.periodic?.alongside && finish.some((f) => f.si <= x.si)) error(x.path, `${findBlock(x.t.block)!.name} runs alongside the line: put it in a stage before the finished goods`, 'TB-P6');
  }

  // Serialisation (optional per product): checked, never generated.
  for (const id of SERIAL) {
    const has = of(id).length > 0;
    if (p.serialisation && !has) error('stages', `Serialisation is checked for this pack: the ${nameOf(id)} step is missing`, 'TB-P5');
    if (!p.serialisation && has && id !== 'vision-challenge') error(of(id)[0]!.path, `Serialisation is not checked for this pack: remove the ${nameOf(id)} step, or switch serialisation on`, 'TB-P1');
  }
  for (const x of of('serial-reconciliation')) {
    const r = refTo(x, 'received');
    if (r.at?.t.block.id !== 'serial-received' || r.name !== 'received') error(`${x.path}.settings.received`, 'The serial numbers received come from the serial numbers received step', 'TB-P5');
  }
  return out;
}
