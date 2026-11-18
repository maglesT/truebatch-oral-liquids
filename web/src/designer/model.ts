// Pure helpers of the designer over the master document: keys, units and their kinds, what an input may be picked
// from, scaling to a new batch size. No GMP maths here: numbers go through the templates library.
import { BLOCKS, blocksFor, findBlock, type Block } from '../../../shared/blocks/index.js';
import { product } from '../product.js';
import { stepTitle as title } from '../../../shared/engine/batch.js';
import { Dec, UNIT_LIST, type Kind } from '../../../shared/templates/index.js';
import type { Stored } from '../../../shared/engine/index.js';
import { kindOf, kindOfUnit } from '../../../shared/master/kinds.js';
import type { Problem } from '../../../shared/master/checks.js';
import { isBalance, machineRefusal } from '../../../shared/engine/picks.js';
import type { BlockField } from '../../../shared/blocks/format.js';
import type { MasterData } from '../api-designer.js';
import type { HEADER_VALUES, MasterDoc, SettingValue, Stage, Step } from '../../../shared/master/schema.js';

// The unit list as offered in pick lists: every unit of the templates' unit table (shared/templates/units.ts).
export const UNITS = UNIT_LIST;
export const unitsOf = (kind?: Kind) => UNITS.filter((u) => !kind || u.kind === kind);
export { kindOf, kindOfUnit, neededKind } from '../../../shared/master/kinds.js';
export const unitLabel = (s: string) => (s === '' ? 'no unit' : s);

/** A worked-out quantity as shown in the formula and the preview: 3 decimals; a mass under 0.01 kg in g, so a small
 *  excipient reads right (2.500 g, not 0.003 kg). Display only: the stored value is not changed. */
export function qtyText(r: Stored | undefined): string {
  if (!r?.ok) return '—';
  const v = new Dec(r.value);
  return r.unit === 'kg' && !v.isZero() && v.abs().lt('0.01') ? `${v.times(1000).toFixed(3)} g` : `${v.toFixed(3)} ${r.unit}`;
}

/** Whole numbers of five digits or more with Indian thousands separators, as the lists show them ("50,000 tablets");
 *  a number with decimals, or part of a code or date, stays as written. */
export const grouped = (text: string) => text.replace(/(?<![\w.,/-])\d{5,}(?![\w.,/-]|\.\d)/g, (n) => Number(n).toLocaleString('en-IN'));

/** A new key, unique among the given ones: "weigh", "weigh-2" … */
export function newKey(base: string, taken: string[]): string {
  const b = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item';
  let k = b;
  for (let i = 2; taken.includes(k); i++) k = `${b}-${i}`;
  return k;
}

export const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

const CHECKS = /^(C\d|F2)$/;

export interface RefOption { ref: string; label: string; kind: Kind | undefined }
/** Earlier steps' recorded numbers and worked-out values this step may use (same rules as the master check). */
export function earlierRefs(doc: MasterDoc, si: number, ti: number): RefOption[] {
  const out: RefOption[] = [];
  doc.stages.forEach((s, i) => {
    if (i > si || (i !== si && s.kind === 'sub-batch')) return;
    s.steps.forEach((t, j) => {
      if (i === si && j >= ti) return;
      const b = findBlock(t.block);
      if (!b) return;
      const where = `${s.name} › ${stepTitle(doc, t, j)}`;
      for (const f of b.fields) if (f.kind === 'number' && !f.count) out.push({ ref: `${s.key}/${t.key}/${f.name}`, label: `${where} › ${f.label} (recorded)`, kind: kindOf(b, f.name, t.settings) });
      for (const c of b.calcs) if (!CHECKS.test(c.template)) out.push({ ref: `${s.key}/${t.key}/${c.name}`, label: `${where} › ${c.label} (worked out)`, kind: kindOf(b, c.name, t.settings) });
    });
  });
  return out;
}

export const HEADER_LABEL: Record<(typeof HEADER_VALUES)[number], { label: string; kind: Kind }> = {
  batchSize: { label: 'the batch size (tablets)', kind: 'count' },
  coreWeight: { label: 'the theoretical core tablet weight', kind: 'mass' },
  coatedWeight: { label: 'the theoretical coated tablet weight', kind: 'mass' },
  coreBatch: { label: 'the theoretical core batch weight', kind: 'mass' },
  coatedBatch: { label: 'the theoretical coated batch weight', kind: 'mass' },
};

export const stepTitle = (doc: MasterDoc, t: Step, j?: number) => `${j === undefined ? '' : `${j + 1}. `}${title(doc, t)}`;

// Settings a new step starts with (the author may change them): the usual dispensing tolerance.
const DEFAULT_SETTINGS: Record<string, Step['settings']> = { weigh: { tolerance: '0.5' }, lubricate: { tolerance: '0.5' } };
/** A new step from a block, with its default instruction, signatures and settings. */
export function stepFrom(block: Block, taken: string[]): Step {
  return { key: newKey(block.id, taken), block: { id: block.id, version: block.version }, settings: { ...DEFAULT_SETTINGS[block.id] }, checker: block.checker,
    waitForCheck: false, critical: false, flow: block.stop ? { kind: 'repeat-until', maxRounds: 10 } : block.qaHold ? { kind: 'qa-hold' } : { kind: 'none' },
    ...(block.periodic ? { everyMinutes: block.periodic.maxMinutes } : {}) };
}

export const newStage = (name: string, taken: string[]): Stage =>
  ({ key: newKey(name, taken), name, kind: 'normal', roomTypes: [], machineTypes: [], role: '', uses: [], steps: [] });

/** The latest version of each block of this product (the library offers only these for new steps). */
export const LIBRARY = blocksFor(product.packing).filter((b) => !BLOCKS.some((x) => x.id === b.id && x.version > b.version));
/** Blocks found by plain words in their name, instruction, fields and settings. */
export function searchBlocks(q: string): Block[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY.filter((b) => {
    const text = [b.name, b.instruction, ...b.fields.map((f) => f.label), ...b.settings.map((s) => s.label)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const QUANTITY = /^(\d+(?:\.(\d+))?)\s*(\S.*)$/;
/** "Copy to a new batch size": typed quantities of mass or count in step settings scale with the batch size. */
export function scaleDoc(doc: MasterDoc, batchSize: string): MasterDoc {
  if (doc.header.batchSize === batchSize || !/^[1-9]\d*$/.test(batchSize)) return { ...doc, header: { ...doc.header, batchSize } };
  const factor = new Dec(batchSize).div(doc.header.batchSize);
  const scale = (v: SettingValue, kind: string | undefined): SettingValue => {
    const m = typeof v === 'string' && kind === 'quantity' ? QUANTITY.exec(v.trim()) : null;
    const k = m ? kindOfUnit(m[3]) : undefined;
    if (!m || (k !== 'mass' && k !== 'count')) return v;
    return `${new Dec(m[1]!).times(factor).toFixed(m[2]?.length ?? 0, Dec.ROUND_HALF_UP)} ${m[3]}`;
  };
  return {
    ...doc,
    header: { ...doc.header, batchSize },
    stages: doc.stages.map((s) => ({ ...s, steps: s.steps.map((t) => {
      const b = findBlock(t.block);
      return { ...t, settings: Object.fromEntries(Object.entries(t.settings).map(([n, v]) => [n, scale(v, b?.settings.find((x) => x.name === n)?.kind)])) };
    }) })),
  };
}

/** Where a master-check path points: the tab and the item to select. */
export interface Place { tab: 'header' | 'formula' | 'process'; line?: number; stage?: number; step?: number }
export function placeOf(path: string): Place {
  const n = (re: RegExp) => { const m = re.exec(path); return m ? Number(m[1]) : undefined; };
  if (path.startsWith('header')) return { tab: 'header' };
  if (path.startsWith('formula')) return { tab: 'formula', line: n(/^formula\[(\d+)\]/) };
  return { tab: 'process', stage: n(/^stages\[(\d+)\]/), step: n(/\.steps\[(\d+)\]/) };
}

/** A short label for a master-check path: "Granulation › 3. Charge a material". */
export function placeLabel(doc: MasterDoc, path: string): string {
  const p = placeOf(path);
  if (p.tab === 'header') return 'Header';
  if (p.tab === 'formula') return p.line === undefined ? 'Formula' : `Formula › ${doc.formula[p.line]?.name || `line ${p.line + 1}`}`;
  const s = p.stage === undefined ? undefined : doc.stages[p.stage];
  if (!s) return 'Process';
  const t = p.step === undefined ? undefined : s.steps[p.step];
  return t ? `${s.name} › ${stepTitle(doc, t, p.step)}` : s.name;
}

/** The author's answer to a calculation warning, kept in the master document with the warning as answered. */
export function answerDoc(doc: MasterDoc, p: Problem, choice: string, reason: string): MasterDoc {
  if (!p.question) return doc;
  return { ...doc, answers: { ...doc.answers, [p.question.key]: { about: p.message, choice, reason: reason.trim() } } };
}

// ---- Rooms to pick from: the relevant ones first, from master data (where the machines stand), never a fixed list ----

export interface Choices { options: string[]; groups: { label: string; options: string[] }[]; text: (o: string) => string }
const sortBy = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
const roomText = (md: Pick<MasterData, 'rooms'>) => (o: string) => {
  const r = md.rooms.find((x) => x.code === o);
  return r ? `${r.code} · ${r.name}${r.area ? ` (${r.area})` : ''}` : o;
};
/** The active rooms where an active machine that fits one of the fields stands (type only, wherever it is). */
function roomsOfMachines(md: Pick<MasterData, 'rooms' | 'equipment'>, fields: BlockField[], machineTypes: string[] = []): string[] {
  const any = { key: 'x', name: '', kind: 'normal' as const, roomTypes: [], machineTypes, role: '', uses: [], steps: [] };
  const rooms = md.rooms.filter((r) => r.active);
  return sortBy(md.equipment.filter((m) => m.active && m.room && rooms.some((r) => r.code === m.room) && fields.some((f) => machineRefusal(any, f, m, rooms) === null)).map((m) => m.room!));
}

/** The rooms a stage may run in, by area or by room: first those where the stage's machines stand (its process
 *  machines, not balances), then every other area and room. */
export function stageRoomChoices(stage: Stage, md: Pick<MasterData, 'rooms' | 'equipment'>): Choices {
  const rooms = md.rooms.filter((r) => r.active);
  const areas = sortBy(rooms.flatMap((r) => (r.area ? [r.area] : [])));
  const codes = sortBy(rooms.map((r) => r.code));
  const fields = stage.steps.flatMap((t) => findBlock(t.block)?.fields.filter((f) => f.kind === 'machine' && !isBalance(f)) ?? []);
  const near = roomsOfMachines(md, fields, stage.machineTypes);
  const nearAreas = sortBy(near.flatMap((c) => { const a = rooms.find((r) => r.code === c)?.area; return a ? [a] : []; }));
  const text = roomText(md);
  return { options: [...areas, ...codes], text,
    groups: [{ label: "Where this stage's machines stand", options: [...nearAreas, ...near] },
      { label: 'Other areas', options: areas.filter((a) => !nearAreas.includes(a)) }, { label: 'Other rooms', options: codes.filter((c) => !near.includes(c)) }] };
}

/** The dispensing rooms of a master: first the rooms where a weighing balance stands (as the floor offers balances),
 *  then the other rooms. */
export function dispensingRoomChoices(md: Pick<MasterData, 'rooms' | 'equipment'>): Choices {
  const codes = sortBy(md.rooms.filter((r) => r.active).map((r) => r.code));
  const balance = findBlock({ id: 'weigh', version: 1 })?.fields.filter((f) => f.kind === 'machine' && isBalance(f)) ?? [];
  const near = roomsOfMachines(md, balance);
  return { options: codes, text: roomText(md),
    groups: [{ label: 'Rooms with a weighing balance', options: near }, { label: 'Other rooms', options: codes.filter((c) => !near.includes(c)) }] };
}

/** The products of master data this product makes: those whose dosage form names it (tablets), and none without one;
 *  of those, the bulk products (TrueBatch Tablets) or the packs (Packing), plus those master data gives no kind yet. */
export const ownProducts = <P extends { dosageForm: string | null; kind?: 'bulk' | 'pack' | null }>(products: readonly P[], kind: 'bulk' | 'pack'): P[] =>
  products.filter((p) => p.dosageForm?.toLowerCase().includes(product.dosageForm) && (p.kind ?? kind) === kind);
