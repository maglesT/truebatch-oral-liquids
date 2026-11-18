// Invented master data for the browser tests: what core's master_data views would list.
import type { FakeMaster } from '../test/helpers.js';

const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
export function seedMasterData(m: FakeMaster) {
  m.products_.push(
    { ...item('prd-1', 'PRD-001', 'Examplol 100 mg tablets'), strength: '100 mg', dosageForm: 'tablet', kind: 'bulk' },
    // A pack (TrueBatch Tablets Packing's): never offered for a tablet master.
    { ...item('pk-1', 'PK-001', 'Examplol 100 mg tablets, 10 x 10 blister'), strength: '100 mg', dosageForm: 'tablet', kind: 'pack' },
    { ...item('prd-2', 'PRD-002', 'Samplomide 50 mg film-coated tablets'), strength: '50 mg', dosageForm: 'film-coated tablet' },
  );
  m.materials_.push(
    { ...item('mat-api', 'MAT-001', 'Examplol'), category: 'API', unit: 'kg' },
    { ...item('mat-lac', 'MAT-002', 'Lactose monohydrate'), category: 'excipient', unit: 'kg' },
    { ...item('mat-mcc', 'MAT-005', 'Microcrystalline cellulose'), category: 'excipient', unit: 'kg' },
    { ...item('mat-mgs', 'MAT-006', 'Magnesium stearate'), category: 'excipient', unit: 'kg' },
    { ...item('mat-cot', 'MAT-007', 'Film coating system'), category: 'excipient', unit: 'kg' },
  );
  m.equipment_.push(
    { ...item('eq-bal', 'BAL-01', 'Balance 60 kg'), kind: 'instrument', type: 'balance', room: 'DSP-01' },
    { ...item('eq-bln', 'BLN-01', 'Bin blender 200 L'), kind: 'equipment', type: 'blender', room: 'BLN-01' },
    { ...item('eq-prs', 'PRS-01', 'Rotary tablet press'), kind: 'equipment', type: 'tablet press', room: 'CMP-01' },
    // The skeleton's sifting and in-process tests stand in the rooms of their stages (the master check warns otherwise).
    { ...item('eq-sft', 'SFT-01', 'Vibro sifter'), kind: 'equipment', type: 'sifter', room: 'BLN-01' },
    { ...item('eq-frb', 'FRB-01', 'Friability tester'), kind: 'instrument', type: 'friability tester', room: 'CMP-01' },
    { ...item('eq-dit', 'DIT-01', 'Disintegration tester'), kind: 'instrument', type: 'disintegration tester', room: 'CMP-01' },
  );
  // These rooms only, not the fixtures' rooms of the server tests.
  m.rooms_.splice(0);
  m.rooms_.push(
    { ...item('rm-dsp', 'DSP-01', 'Dispensing booth 1'), area: 'Dispensing', grade: 'D' },
    { ...item('rm-bln', 'BLN-01', 'Blending room 1'), area: 'Blending', grade: 'D' },
    { ...item('rm-cmp', 'CMP-01', 'Compression room 1'), area: 'Compression', grade: 'D' },
  );
}
