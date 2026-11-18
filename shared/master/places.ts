/**
 * The master against master data's machines and rooms (TB-11): a step that records a machine is offered on the floor
 * only the machines of its type standing in a room its stage allows (balances also in the master's dispensing rooms),
 * shared/engine/picks.ts. When no machine of master data fits, the floor's picker would be empty: the master check
 * warns while the master is written. A warning, not an error: master data changes (a machine is moved or added) without
 * a new master version, and the floor checks it again.
 */
import { findBlock } from '../blocks/index.js';
import { dispensingRooms, isBalance, machineRefusal, type PickMachine, type PickRoom } from '../engine/picks.js';
import type { Problem } from './checks.js';
import type { MasterDoc } from './schema.js';

export interface PlaceData { equipment: readonly (PickMachine & { active?: boolean })[]; rooms: readonly (PickRoom & { active?: boolean })[] }

export function placeChecks(doc: MasterDoc, md: PlaceData): Problem[] {
  const out: Problem[] = [];
  const machines = md.equipment.filter((m) => m.active !== false);
  const rooms = md.rooms.filter((r) => r.active !== false);
  const dispensing = dispensingRooms(doc, rooms);
  doc.stages.forEach((s, si) => s.steps.forEach((t, ti) => {
    const block = findBlock(t.block);
    for (const f of block?.fields ?? []) {
      if (f.kind !== 'machine' || f.optional) continue;
      if (machines.some((m) => machineRefusal(s, f, m, rooms, dispensing) === null)) continue;
      // The machines of the right type, wherever they stand: the author sees where they are.
      const typed = machines.filter((m) => machineRefusal({ ...s, roomTypes: [], machineTypes: [] }, f, m, rooms) === null);
      const where = typed.slice(0, 3).map((m) => `${m.code} stands in ${m.room ?? 'no room'}`).join('; ') + (typed.length > 3 ? `; and ${typed.length - 3} more` : '');
      const allowed = [...s.roomTypes, ...(isBalance(f) ? dispensing : [])].join(', ');
      const what = f.label.toLowerCase();
      out.push({ level: 'warning', path: `stages[${si}].steps[${ti}]`, rule: 'TB-11', message: !typed.length
        ? `Master data has no ${what} (no machine of its type): the floor could not record this step. Engineering adds it in master data`
        : s.machineTypes.length && !typed.some((m) => s.machineTypes.some((x) => x.toLowerCase() === (m.type ?? '').toLowerCase())) && !isBalance(f)
          ? `No ${what} is offered on the floor: the stage allows only the machine types ${s.machineTypes.join(', ')}. Add its type to the stage's machine types (${where})`
          : `No ${what} stands in a room this stage allows (${allowed}): ${where}. Allow its room in the stage settings, or engineering moves it in master data` });
    }
  }));
  return out;
}
