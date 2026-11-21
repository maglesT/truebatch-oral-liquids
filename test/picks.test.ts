import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { balanceCapacity, dispensingRooms, emptyNote, machineRefusal, untypedNote } from '../shared/engine/picks.js';
import { SKELETON_LIST, packingStages, skeletonStages } from '../web/src/designer/skeletons.js';
import { pack } from './packing-fixture.js';

// The equipment and instrument types of the demo master data (owner's list, 15 Nov 2026), with a few real types that
// share a word with them and must not be offered (filter press, air compressor, dry heat steriliser, case packer).
const TYPES = ['Balance', 'Analytical balance', 'Micro balance', 'IPC balance', 'Platform balance', 'Bin blender', 'Blender', 'Auto coater', 'Blister packer',
  'Strip packer', 'High speed blister line', 'Rapid mixer granulator', 'Fluid bed dryer', 'Tablet compression machine', 'Tablet press', 'Cold forming machine',
  'Filter press', 'Air compressor', 'Dry heat steriliser', 'Case packer', 'Sifter', 'Multimill', 'Friabilator', 'Disintegration tester', 'Manufacturing vessel',
  // TrueBatch Liquids: filling lines, cappers and bottle washers.
  'Bottle filling line', 'Filling and capping machine', 'Capping machine', 'Bottle washing machine', 'Air rinser', 'Holding tank', 'Colloid mill', 'Homogeniser', 'Stirrer'];
const MACHINES = TYPES.map((type, i) => ({ code: `EQ-${i}`, type, room: null }));
const BALANCES = ['Balance', 'IPC balance', 'Platform balance'];
const BLENDERS = ['Bin blender', 'Blender'];
const LINES = ['Bottle filling line', 'Filling and capping machine'];
const OFFERS: Record<string, string[]> = {
  'weigh.balance': BALANCES, 'blend-uniformity.machine': BLENDERS,
  'dry-mix.machine': [...BLENDERS, 'Rapid mixer granulator'], 'granulate.machine': ['Rapid mixer granulator'], 'dry.machine': ['Fluid bed dryer'],
  'sift.machine': ['Sifter'],
  'sieve.machine': ['Sifter', 'Multimill', 'Colloid mill'], 'binder-solution.machine': ['Manufacturing vessel', 'Holding tank', 'Stirrer'],
  'charge.machine': [...BLENDERS, 'Rapid mixer granulator', 'Fluid bed dryer', 'Manufacturing vessel', 'Stirrer'],
  'line-setup.machine2': ['Case packer', ...LINES, 'Capping machine'], 'line-setup.machine3': ['Case packer', ...LINES, 'Capping machine'], 'line-setup.machine4': ['Case packer', ...LINES, 'Capping machine'],
  'liquid-bulk-issue.line': LINES, 'pack-clearance.line': LINES, 'pack-clearance-after.line': LINES,
  'bottle-wash.washer': ['Bottle washing machine', 'Air rinser'], 'liquid-fill.machine': ['Bottle filling line', 'Filling and capping machine'],
  'cap-check.capper': ['Filling and capping machine', 'Capping machine'],
  // The liquids: vessels and tanks (never a granulator), mills and homogenisers for homogenising.
  'sugar-syrup.machine': ['Manufacturing vessel', 'Holding tank', 'Stirrer'], 'dissolve.machine': ['Manufacturing vessel', 'Holding tank', 'Stirrer'],
  'hydrate.machine': ['Manufacturing vessel', 'Holding tank', 'Stirrer'], 'phase-prep.machine': ['Manufacturing vessel', 'Holding tank', 'Stirrer'],
  'make-up.machine': ['Manufacturing vessel', 'Holding tank'], 'bulk-transfer.from': ['Manufacturing vessel', 'Holding tank'], 'bulk-transfer.to': ['Holding tank'],
  'homogenise.machine': ['Colloid mill', 'Homogeniser'], 'mix.machine': ['Bin blender', 'Blender', 'Rapid mixer granulator', 'Manufacturing vessel', 'Stirrer'],
};

describe('machine pickers on the demo master-data types', () => {
  const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100000', batchUnit: 'L' as const };
  // The types alone: here every stage allows any room (the rooms are tested below).
  const stages = [...SKELETON_LIST.flatMap((s) => skeletonStages(s.id, header)), ...packingStages(pack())].map((s) => ({ ...s, roomTypes: [] }));

  it('TL-11 every machine field of the skeletons and the packing skeleton offers the machines of its kind, never a QC lab balance', () => {
    const seen = new Set<string>();
    for (const stage of stages) for (const st of stage.steps) {
      for (const f of findBlock(st.block)!.fields.filter((x) => x.kind === 'machine')) {
        const key = `${st.block.id}.${f.name}`;
        seen.add(key);
        expect([key, MACHINES.filter((m) => !machineRefusal(stage, f, m, [])).map((m) => m.type)]).toEqual([key, OFFERS[key]]);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(OFFERS).sort());
  });

  it('TL-11 an analytical balance is refused on the floor with the reason', () => {
    const stage = stages[0]!;
    const balance = findBlock({ id: 'weigh', version: 1 })!.fields.find((f) => f.name === 'balance')!;
    expect(machineRefusal(stage, balance, { code: 'QC-BAL-1', type: 'Analytical balance', room: null }, [])).toBe('QC-BAL-1 is not a balance (master data: Analytical balance)');
  });

  // The demo's rooms and balances (master data, 15 Nov 2026): IN-BAL-03/04 stand in RM-101 (Dispensing), IN-BAL-05 in
  // RM-105 (Compression), IN-BAL-01/02/06 in RM-110 (QC), INQ-BAL-07 in RM-601 (Microbiology), and the liquids block's
  // INL-BAL-01 in RM-301 (Liquid dispensing).
  const ROOMS = [{ code: 'RM-101', area: 'Dispensing' }, { code: 'RM-103', area: 'Granulation' }, { code: 'RM-105', area: 'Compression' },
    { code: 'RM-107', area: 'Coating' }, { code: 'RM-108', area: 'Packing' }, { code: 'RM-110', area: 'QC' }, { code: 'RM-601', area: 'Microbiology' },
    { code: 'RM-301', area: 'Liquid dispensing' }];
  const BALS = [['IN-BAL-03', 'RM-101'], ['IN-BAL-04', 'RM-101'], ['IN-BAL-05', 'RM-105'], ['IN-BAL-01', 'RM-110'], ['INQ-BAL-07', 'RM-601'], ['INL-BAL-01', 'RM-301']]
    .map(([code, room]) => ({ code: code!, type: 'Balance', room }));
  const field = (block: string, name: string) => findBlock({ id: block, version: 1 })!.fields.find((f) => f.name === name)!;

  it('TL-11 a balance is offered in the master\'s dispensing rooms, with those of the stage\'s rooms; INL-BAL-01 of the liquids block is not; never a QC or laboratory balance', () => {
    const stage = { ...stages[0]!, roomTypes: ['Granulation', 'Coating'], machineTypes: ['Granulator', 'Coater'] };
    const offered = (block: string, s = stage, dispensing = ['RM-101']) => BALS.filter((b) => !machineRefusal(s, field(block, 'balance'), b, ROOMS, dispensing)).map((b) => b.code);
    expect(offered('weigh')).toEqual(['IN-BAL-03', 'IN-BAL-04']);
    expect(offered('weigh', { ...stage, roomTypes: ['Compression'] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05']);
    expect(offered('weigh', stage, ['RM-301'])).toEqual(['INL-BAL-01']);
    expect(offered('weigh', { ...stage, roomTypes: [] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05', 'INL-BAL-01']);
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[5]!, ROOMS, ['RM-101'])).toBe('INL-BAL-01 stands in RM-301, neither in a dispensing room of the master nor in a room this stage allows (Granulation, Coating)');
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[3]!, ROOMS, ['RM-101'])).toBe('IN-BAL-01 stands in RM-110 (QC), a laboratory area: weigh with a balance of a dispensing room of the master or of a room this stage allows');
    // A version made before the setting: the rooms whose area is exactly "Dispensing".
    const old = { header: { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '1', batchUnit: 'L' as const } };
    expect(dispensingRooms(old, ROOMS)).toEqual(['RM-101']);
    expect(dispensingRooms({ header: { ...old.header, dispensingRooms: ['RM-102'] } }, ROOMS)).toEqual(['RM-102']);
  });

  it('TL-11 a packing line is offered only standing in a room the stage allows; one with no type is named in the note', () => {
    const stage = { ...stages[0]!, roomTypes: ['Packing'] };
    const line = field('pack-clearance', 'line');
    const lines = [{ code: 'FL-01', type: 'Bottle filling line', room: 'RM-108' }, { code: 'FL-X', type: 'Bottle filling line', room: 'RM-107' },
      { code: 'FL-02', type: 'Bottle filling line', room: null }, { code: 'FL-03', type: null, room: 'RM-108' }, { code: 'BLS-01', type: 'Blister packer', room: 'RM-108' }];
    expect(lines.map((m) => machineRefusal(stage, line, m, ROOMS))).toEqual([null, 'FL-X stands in RM-107, not in a room this stage allows (Packing)',
      'FL-02 stands in no room in master data, so it is not in a room this stage allows (Packing)', 'FL-03 has no type in master data, so it is not offered as a filling and packing line',
      'BLS-01 is not a filling and packing line (master data: Blister packer)']);
    expect(untypedNote(line, lines)).toBe('1 machine has no type in master data, so it is not offered.');
  });

  it('TL-11 an empty machine picker says why: where the machines of its type stand, or that master data has none (17 Nov 2026 run, F17)', () => {
    const stage = { ...stages[0]!, roomTypes: ['RM-105'] };
    const tester = field('dry', 'machine');
    const all = [{ code: 'FBD-01', type: 'Fluid bed dryer', room: 'RM-110' }, { code: 'BAL-X', type: null, room: null }, { code: 'EQ-RMG-01', type: 'Rapid mixer granulator', room: 'RM-105' }];
    expect(emptyNote(stage, tester, all, ROOMS)).toBe('No dryer can be used here: FBD-01 stands in RM-110, not in a room this stage allows (RM-105). '
      + '1 machine has no type in master data, so it is not offered. Engineering moves one into a room this stage allows, or adds one, in master data (the Logbook shows where each stands).');
    expect(emptyNote(stage, tester, all.slice(1), ROOMS)).toBe('Master data has no active dryer. 1 machine has no type in master data, so it is not offered. Engineering adds it in master data.');
  });
});

describe('A8 pickers: a balance for the quantity weighed (fix round 21 Nov 2026)', () => {
  const stage = { key: 's', name: 'S', kind: 'normal' as const, roomTypes: [], machineTypes: [], role: '', uses: [], steps: [] };
  it('a balance is offered when the quantity is within its capacity and at least 0.5 % of it; a name without a capacity is not checked', () => {
    const f = findBlock({ id: 'weigh', version: 1 })!.fields.find((x) => x.name === 'balance')!;
    const bal = [{ code: 'IN-BAL-03', type: 'Balance', name: 'Platform balance 300 kg' }, { code: 'IN-BAL-04', type: 'Balance', name: 'Precision balance 6 kg' },
      { code: 'IN-BAL-05', type: 'Balance', name: 'IPC balance (fill weight)' }];
    expect(balanceCapacity(bal[0]!)).toBe(300);
    expect(balanceCapacity({ code: 'x', name: 'Analytical balance 220 g' })).toBeCloseTo(0.22);
    const offered = (value: string, unit: string) => bal.filter((m) => !machineRefusal(stage, f, m, [], [], { value, unit })).map((m) => m.code);
    expect(offered('0.04', 'kg')).toEqual(['IN-BAL-04', 'IN-BAL-05']);
    expect(offered('12.000', 'kg')).toEqual(['IN-BAL-03', 'IN-BAL-05']);
    expect(offered('3.26', 'kg')).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05']);
    expect(machineRefusal(stage, f, bal[0]!, [], [], { value: '0.04', unit: 'kg' })).toBe('IN-BAL-03 (300 kg) is too large for 0.04 kg: a balance weighs at least 0.5 % of its capacity (1.5 kg); use a smaller balance');
    expect(machineRefusal(stage, f, bal[1]!, [], [], { value: '12', unit: 'kg' })).toBe('IN-BAL-04 weighs at most 6 kg: 12 kg is too much for it');
    expect(machineRefusal(stage, f, bal[0]!, [])).toBeNull();
  });
});
