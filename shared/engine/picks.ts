/**
 * The machines and rooms a step field offers and accepts (owner, 15 Nov 2026), from master data's type, room and area:
 * a machine of the stage's allowed types and of the type the field asks for (a balance field: balances only, never a
 * QC lab analytical or micro balance), standing in a room the stage allows; a room the stage allows by its area or by
 * its own code. A balance is not one of the stage's process machines: it is offered where the weighing is done, in one
 * of the master's dispensing rooms (owner, 16 Nov 2026: named in the header, not every area called dispensing) or in a
 * room the stage allows, never in a QC or laboratory area.
 */
import type { BlockField } from '../blocks/format.js';
import type { MasterDoc, Stage } from '../master/schema.js';

export interface PickMachine { code: string; type?: string | null; room?: string | null; name?: string | null }
/** A quantity to weigh (the step's target), for the balance's range. */
export interface PickQuantity { value: string; unit: string }
export interface PickRoom { code: string; area?: string | null }
const among = (list: readonly string[], x: string | null | undefined) => list.some((a) => a.toLowerCase() === (x ?? '').toLowerCase());
// Master data's laboratory room areas (the demo has QC, Microbiology, Wet chemistry, Stability).
const LAB_AREA = /\bqc\b|quality control|laborator|\blab\b|microbiolog|chemistry|stability/i;
export const isBalance = (f: BlockField) => !!f.types?.includes('balance');
/** The master's dispensing rooms; a version from before the setting: the rooms whose area is exactly "Dispensing". */
export const dispensingRooms = (doc: Pick<MasterDoc, 'header'>, rooms: readonly PickRoom[]): string[] =>
  doc.header.dispensingRooms ?? rooms.filter((r) => r.area === 'Dispensing').map((r) => r.code);

/** Why a room is not one the stage allows; null when it is. */
export function roomRefusal(stage: Stage, r: PickRoom): string | null {
  return !stage.roomTypes.length || among(stage.roomTypes, r.area) || among(stage.roomTypes, r.code) ? null
    : `${r.code} is not one of the rooms this stage allows (${stage.roomTypes.join(', ')})`;
}

const MASS: Record<string, number> = { mg: 1e-6, g: 1e-3, kg: 1 };
/**
 * Fix round 21 Nov 2026 (A8): a balance's capacity, from its name in master data ("Platform balance 300 kg",
 * "Analytical balance 220 g"); none when the name gives none (then the range is not checked).
 */
export function balanceCapacity(m: PickMachine): number | null {
  const all = [...(m.name ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(mg|g|kg)\b/gi)];
  const last = all.at(-1);
  return last ? Number(last[1]) * MASS[last[2]!.toLowerCase()]! : null;
}
// The smallest share of its capacity a balance weighs (0.5 %): 40 g is not weighed on a 300 kg platform balance.
export const BALANCE_MIN_SHARE = 0.005;
/** Why a balance does not fit the quantity to weigh (A8); null when it does, or when either is not known. */
export function rangeRefusal(m: PickMachine, q: PickQuantity | undefined): string | null {
  const cap = balanceCapacity(m);
  const per = q && MASS[q.unit];
  if (!cap || !q || per === undefined) return null;
  const kg = Number(q.value) * per;
  const shown = (x: number) => (x >= 1 ? `${+x.toFixed(3)} kg` : `${+(x * 1000).toFixed(3)} g`);
  if (kg > cap) return `${m.code} weighs at most ${shown(cap)}: ${q.value} ${q.unit} is too much for it`;
  if (kg < cap * BALANCE_MIN_SHARE) return `${m.code} (${shown(cap)}) is too large for ${q.value} ${q.unit}: a balance weighs at least ${BALANCE_MIN_SHARE * 100} % of its capacity (${shown(cap * BALANCE_MIN_SHARE)}); use a smaller balance`;
  return null;
}

/** Why a machine does not fit the field in this stage; null when it does. `dispensing`: the master's dispensing rooms;
 *  `quantity`: what a balance weighs in this step (A8: within its range). */
export function machineRefusal(stage: Stage, f: BlockField, m: PickMachine, rooms: readonly PickRoom[], dispensing: readonly string[] = [], quantity?: PickQuantity): string | null {
  const balance = isBalance(f);
  if (!balance && stage.machineTypes.length && !among(stage.machineTypes, m.type)) return `${m.code} is not one of the machine types this stage allows (${stage.machineTypes.join(', ')})`;
  const type = (m.type ?? '').toLowerCase();
  if (!type && f.types?.length) return `${m.code} has no type in master data, so it is not offered as a ${f.label.toLowerCase()}`;
  if (!fitsType(f, m)) return `${m.code} is not a ${f.label.toLowerCase()} (master data: ${m.type ?? 'no type'})`;
  if (f.capability?.length && !f.capability.some((w) => `${m.type ?? ''} ${m.name ?? ''}`.toLowerCase().includes(w))) {
    return `${m.code} is not a ${f.capability[0]} machine (master data: ${[m.type, m.name].filter(Boolean).join(', ') || 'no type'})`;
  }
  if (balance) { const r = rangeRefusal(m, quantity); if (r) return r; }
  const room = m.room ? rooms.find((r) => r.code === m.room) : undefined;
  if (balance && room && LAB_AREA.test(room.area ?? '')) return `${m.code} stands in ${room.code} (${room.area}), a laboratory area: weigh with a balance of a dispensing room of the master or of a room this stage allows`;
  if (!stage.roomTypes.length || (balance && among(dispensing, m.room))) return null;
  if (!room) return `${m.code} stands in no room in master data, so it is not in a room this stage allows (${stage.roomTypes.join(', ')})`;
  if (roomRefusal(stage, room)) return `${m.code} stands in ${room.code}, ${balance ? 'neither in a dispensing room of the master nor' : 'not'} in a room this stage allows (${stage.roomTypes.join(', ')})`;
  return null;
}

/** Whether master data's type of a machine is one the field takes (any type when the field names none). */
export function fitsType(f: BlockField, m: PickMachine): boolean {
  const type = (m.type ?? '').toLowerCase();
  return !(f.types?.length && !f.types.some((w) => type.includes(w))) && !f.notTypes?.some((w) => type.includes(w));
}

/**
 * The active machines left out for having no type in master data (they cannot be matched to the field), in a few
 * words. Engineering's housekeeping: said only where it matters, when the picker offers nothing (owner, 17 Nov 2026).
 */
export function untypedNote(f: BlockField, machines: readonly (PickMachine & { active?: boolean })[]): string | null {
  if (f.kind !== 'machine' || !f.types?.length) return null;
  const n = machines.filter((m) => m.active !== false && !m.type?.trim()).length;
  return n ? `${n} machine${n === 1 ? ' has' : 's have'} no type in master data, so ${n === 1 ? 'it is' : 'they are'} not offered.` : null;
}

/**
 * Why a machine or room picker offers nothing (owner, 17 Nov 2026: an empty picker says why): the machines of the
 * field's type and where they stand (or that master data has none of that type), and the untyped ones in a few words.
 */
export function emptyNote(stage: Stage, f: BlockField, machines: readonly (PickMachine & { active?: boolean })[], rooms: readonly (PickRoom & { active?: boolean })[],
  dispensing: readonly string[] = [], quantity?: PickQuantity): string {
  const allowed = stage.roomTypes.length ? ` (${stage.roomTypes.join(', ')})` : '';
  if (f.kind === 'room') return `No room this stage allows${allowed} is active in master data. Engineering adds or activates it in master data.`;
  const what = f.label.toLowerCase();
  const ofType = machines.filter((m) => m.active !== false && (!f.types?.length || m.type?.trim()) && fitsType(f, m));
  const why = ofType.map((m) => machineRefusal(stage, f, m, rooms, dispensing, quantity)).filter((x): x is string => !!x);
  const untyped = untypedNote(f, machines);
  const shown = why.length > 3 ? `${why.slice(0, 3).join('; ')}; and ${why.length - 3} more` : why.join('; ');
  return [
    why.length ? `No ${what} can be used here: ${shown}.` : `Master data has no active ${what}.`,
    untyped,
    why.length ? 'Engineering moves one into a room this stage allows, or adds one, in master data (the Logbook shows where each stands).' : 'Engineering adds it in master data.',
  ].filter(Boolean).join(' ');
}

/**
 * While the Logbook link answers, a machine or room is used only if the Logbook has it (server/pull.ts refuses any
 * other): the picker offers only those; when that leaves it empty, it names the ones it leaves out. `known`: the master-data ids the Logbook has;
 * null while the link is absent or down (every item is offered, and its status labels are answered by hand).
 */
export function inLogbook<T extends { itemId: string; code: string }>(items: readonly T[], known: readonly string[] | null): { offered: T[]; note: string | null } {
  if (!known) return { offered: [...items], note: null };
  const offered = items.filter((i) => known.includes(i.itemId));
  const codes = items.filter((i) => !known.includes(i.itemId)).map((i) => i.code);
  // Only an empty picker says why (owner, 17 Nov 2026): a picker with choices needs no note.
  if (!codes.length || offered.length) return { offered, note: null };
  const shown = codes.length > 6 ? `${codes.slice(0, 6).join(', ')} and ${codes.length - 6} more` : codes.join(', ');
  return { offered, note: `Not offered, because the Logbook does not have ${codes.length === 1 ? 'it' : 'them'}: ${shown}. Only what the Logbook has can be used while it is linked.` };
}
