import { describe, expect, it, vi } from 'vitest';
import { BLOCKS } from '../shared/blocks/index.js';
import { masterChecks, plainWords } from '../shared/master/checks.js';
import { placeChecks } from '../shared/master/places.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster } from '../web/src/designer/describe.js';
import { verdictless } from '../web/src/designer/example.js';
import { dispensingRoomChoices, grouped, ownProducts, qtyText, stageRoomChoices, unitsOf } from '../web/src/designer/model.js';
import { sentence, sentenceText } from '../web/src/designer/sentences.js';
import { SKELETON_LIST, skeletonStages } from '../web/src/designer/skeletons.js';
import { tablet } from './engine-fixture.js';
// The shared test master is built from test-only blocks (test/test-blocks.ts).
vi.mock('../shared/blocks/index.js', async (original) => (await import('./test-blocks.js')).withTestBlocks(original as never));

// The designer findings of the full demo run of 17 Nov 2026 (F03-F17, F35, F36): what the master check reports, the
// plain view's words, and the pick lists offered from master data.

const block = (id: string) => BLOCKS.find((b) => b.id === id)!;
const header = { productItemId: 'p', productCode: 'P', productName: 'P', type: 'dry syrup' as const, batchSize: '50000', batchUnit: 'kg' as const, dispensingRooms: ['RM-101'] };
const room = (code: string, name: string, area: string | null, active = true) => ({ itemId: code, code, name, version: 1, active, area, grade: 'D' });
const machine = (code: string, type: string | null, at: string | null, active = true) => ({ itemId: code, code, name: code, version: 1, active, kind: 'instrument' as const, type, room: at });
const MD = {
  rooms: [room('RM-101', 'Dispensing booth', 'Dispensing'), room('RM-932', 'Immunosuppressants block: dispensing', 'Dispensing'), room('RM-105', 'Granulation room 1', 'Granulation'),
    room('RM-110', 'QC instrument laboratory', 'QC'), room('RM-501', 'Cyclotron vault', 'Cyclotron vault'), room('RM-999', 'Old room', 'Granulation', false)],
  equipment: [machine('IN-BAL-03', 'Balance', 'RM-101'), machine('IN-BAL-01', 'Balance', 'RM-110'), machine('RMG-01', 'Rapid mixer granulator', 'RM-105'),
    machine('FBD-01', 'Fluid bed dryer', 'RM-110'), machine('MIL-01', 'Sieve', 'RM-105')],
};
const granulated = () => masterSchema.parse({ header, formula: [], stages: skeletonStages('dry-syrup-granulated', header) });

describe('designer findings of the 17 Nov 2026 run', () => {
  it('TL-11 the master check warns when no machine of a step\'s type stands in the rooms its stage allows, and says where it stands (F17)', () => {
    const doc = granulated();
    const gran = doc.stages.findIndex((s) => s.key === 'granulation');
    const di = doc.stages[gran]!.steps.findIndex((t) => t.block.id === 'dry');
    const warned = placeChecks(doc, MD).find((p) => p.path === `stages[${gran}].steps[${di}]`);
    expect(warned).toMatchObject({ level: 'warning', rule: 'TL-11' });
    expect(warned!.message).toBe('No dryer stands in a room this stage allows (Granulation): FBD-01 stands in RM-110. Allow its room in the stage settings, or engineering moves it in master data');
    // The granulator and the mill stand in the granulation room: no warning for them; with the dryer moved, none.
    expect(placeChecks(doc, MD).filter((p) => p.path.startsWith(`stages[${gran}]`)).map((p) => p.path)).toEqual([`stages[${gran}].steps[${di}]`]);
    const moved = { ...MD, equipment: MD.equipment.map((m) => (m.code === 'FBD-01' ? { ...m, room: 'RM-105' } : m)) };
    expect(placeChecks(doc, moved).filter((p) => p.path.startsWith(`stages[${gran}]`))).toEqual([]);
    // A type master data does not have at all; a balance in a dispensing room of the master is found there.
    expect(placeChecks(doc, { ...MD, equipment: MD.equipment.filter((m) => m.code !== 'FBD-01') }).find((p) => p.path === `stages[${gran}].steps[${di}]`)!.message)
      .toMatch(/^Master data has no /);
    const weigh = doc.stages[0]!.steps.findIndex((t) => t.block.id === 'weigh');
    expect(placeChecks(doc, MD).some((p) => p.path === `stages[0].steps[${weigh}]`)).toBe(false);
  });

  it('a stage\'s yield on an earlier stage\'s output is refused when the stage adds formula materials (F11)', () => {
    const d = tablet();
    // Compression of the fixture weighs nothing; make its yield on the granules and let it charge the lubricant.
    const ci = d.stages.findIndex((s) => s.key === 'compression');
    const yi = d.stages[ci]!.steps.findIndex((t) => t.key === 'yield');
    d.stages[ci]!.steps[yi]!.settings.theoretical = { ref: 'granulation/yield/output' };
    expect(masterChecks(d).filter((p) => p.path === `stages[${ci}].steps[${yi}].settings.theoretical`)).toEqual([]);
    d.stages[ci]!.steps.unshift({ key: 'weigh-mgst', block: { id: 'weigh', version: 1 }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' }, settings: { target: { formula: 'mgst' }, tolerance: '0.5' } });
    expect(masterChecks(d).filter((p) => p.path === `stages[${ci}].steps[${yi + 1}].settings.theoretical`).map((p) => [p.level, p.message])).toEqual([['error',
      'The yield of Compression is worked out on the output of Granulation only, but Compression adds Magnesium stearate: the yield would read above 100 %. Take the theoretical core batch weight (or a quantity that includes what this stage adds) as the theoretical quantity']]);
    // Every skeleton passes this check: blending's yield is on the core batch weight.
    for (const s of SKELETON_LIST) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header) });
      expect(masterChecks(doc).filter((p) => p.path.endsWith('.settings.theoretical') && /above 100 %/.test(p.message))).toEqual([]);
    }
  });

  it('the master check reports everything the plain view shows as not set; optional settings left empty are left out of the sentences (F12)', () => {
    for (const s of SKELETON_LIST) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header).map((st, i) => (i === 0 ? { ...st, role: '' } : st)) });
      const problems = masterChecks(doc);
      for (const [si, sec] of describeMaster(doc).filter((x) => x.key.startsWith('stage:')).entries()) {
        for (const [li, line] of sec.lines.entries()) {
          if (!/not set|not chosen|\?/.test(line.text)) continue;
          const path = li === 0 ? `stages[${si}]` : `stages[${si}].steps[${li - 1}]`;
          expect(problems.some((p) => p.path === path || p.path.startsWith(`${path}.`)), `${s.id}: ${line.text}`).toBe(true);
        }
      }
    }
    // The binder solution with only its binder: no "(not set), (not set)" for the optional second and third materials.
    const b = block('binder-solution');
    const settings = { binder: { formula: 'pvp' }, targetSolids: '10 %w/w', tolerance: '2.0', mixTimeLimit: { low: '15', high: '30', unit: 'min' } };
    expect(sentenceText(tablet(), b, settings, sentence(b, b.calcs[0]!))).toBe('The solvent to add is worked out from the batch quantity of Povidone K30 and 10 %w/w.');
    const doc = granulated();
    // A stage without a responsible role is reported.
    expect(masterChecks({ ...doc, stages: doc.stages.map((s, i) => (i === 0 ? { ...s, role: '' } : s)) }).some((p) => p.path === 'stages[0]' && /no responsible role/.test(p.message))).toBe(true);
  });

  it('the plain view gives numbers with their units and plain sentences (F06, F13)', () => {
    const by = block('bulk-yield-weight');
    expect(sentenceText(tablet(), by, {}, sentence(by, by.calcs.find((c) => c.name === 'output')!))).toMatch(/^The bulk in the tank is /);
    const lines = describeMaster(granulated()).flatMap((s) => s.lines.map((l) => l.text));
    expect(lines).toContain('Batch 50,000 kg.');
    expect(lines.find((l) => l.includes('Produces dry syrup powder'))).toMatch(/to be used within 720 hours \(30 days\)\./);
    // A charged material by its name and code, as the floor names it.
    const d = tablet();
    const text = describeMaster(d).flatMap((s) => s.lines.map((l) => l.text)).find((l) => l.includes('Charge a material'))!;
    expect(text).toContain('Material: Examplol (MAT-001).');
    expect(text).not.toContain('formula line');
    expect(grouped('600.0 mg × 50000 tablets = 30.000 kg')).toBe('600.0 mg × 50,000 tablets = 30.000 kg');
    expect(grouped('CC-2026-0016, 49225.7 tablets, 100000 tablets')).toBe('CC-2026-0016, 49225.7 tablets, 1,00,000 tablets');
  });

  it('no internal codes of rules, templates or failure cases in what the master check says (F07)', () => {
    expect(plainWords('A line is adjusted for potency (T9) or for content (T18), not both')).toBe('A line is adjusted for potency or for content, not both');
    expect(plainWords('stop at that net weight (F0339: spraying all of it gives about 4.5 % more drug)')).toBe('stop at that net weight (spraying all of it gives about 4.5 % more drug)');
    const d = tablet();
    d.formula[0]!.adjust = { potency: { basis: 'as is' }, content: { formulaQuantityIs: 'dry' } };
    d.formula[0]!.name = 'Examplol wet cake';
    for (const p of masterChecks(d)) expect(p.message).not.toMatch(/\bT\d+\b|\bTB-\w+|\bF0\d{3}\b/);
    // An answer given to the message as it read before keeps counting.
    const wet = masterChecks(d).find((p) => p.question?.key === 'solvent-wet/api')!;
    expect(wet.message).toContain('(an assay adjustment on the dried or solvent-free basis, or a content adjustment)');
  });

  it('the worked example gives its verdict once, in the chip (F14)', () => {
    expect(verdictless('All 6 units disintegrated within 15 min: PASS')).toBe('All 6 units disintegrated within 15 min');
    expect(verdictless('6.0 within limits')).toBe('6.0 within limits');
  });

  it('pick lists offer this product\'s products and the relevant rooms first, by name (F04, F05, F09)', () => {
    const p = (code: string, dosageForm: string | null, kind?: 'bulk' | 'pack' | null) => ({ code, dosageForm, kind });
    // Plan data change 5: oral liquids only (a solution for injection, a tablet or a capsule is not offered).
    expect(ownProducts([p('FG-PCM-SYR', 'Syrup'), p('FG-IBU-SUS', 'Oral suspension'), p('FG-D3', 'Oral drops'), p('FG-AMX-DS', 'Powder for oral suspension'), p('FG-LP', 'Oral emulsion'),
      p('FG-PB', 'Elixir'), p('FG-KCL', 'Oral solution'), p('FG-INJ', 'Solution for injection'), p('FG-PCM500', 'Tablet'), p('FG-CAP', 'Capsule'), p('EXZ', null)], 'bulk').map((x) => x.code))
      .toEqual(['FG-PCM-SYR', 'FG-IBU-SUS', 'FG-D3', 'FG-AMX-DS', 'FG-LP', 'FG-PB', 'FG-KCL']);
    // Master data's kind: a manufacturing master offers the bulk products, a packing master the packs; no kind yet: both, as before.
    const all = [p('FG-PCM-SYR', 'Syrup', 'bulk'), p('PK-PCM-SYR-60', 'Syrup', 'pack'), p('FG-D3', 'Oral drops', null), p('FG-INJ', 'Solution for injection', 'bulk')];
    expect(ownProducts(all, 'bulk').map((x) => x.code)).toEqual(['FG-PCM-SYR', 'FG-D3']);
    expect(ownProducts(all, 'pack').map((x) => x.code)).toEqual(['PK-PCM-SYR-60', 'FG-D3']);
    // Dispensing: the rooms with a weighing balance first (never a QC lab's), each by code, name and area.
    const disp = dispensingRoomChoices(MD);
    expect(disp.groups).toEqual([{ label: 'Rooms with a weighing balance', options: ['RM-101'] }, { label: 'Other rooms', options: ['RM-105', 'RM-110', 'RM-501', 'RM-932'] }]);
    expect(disp.text('RM-932')).toBe('RM-932 · Immunosuppressants block: dispensing (Dispensing)');
    // A stage: the areas and rooms where its machines stand first.
    const gran = granulated().stages.find((s) => s.key === 'granulation')!;
    const st = stageRoomChoices(gran, MD);
    expect(st.groups[0]).toEqual({ label: "Where this stage's machines stand", options: ['Granulation', 'QC', 'RM-105', 'RM-110'] });
    expect(st.groups[1]!.options).toEqual(['Cyclotron vault', 'Dispensing']);
  });

  it('a small quantity reads in g; the unit lists offer every unit of the unit table (ported from TrueBatch Injectables)', () => {
    expect(qtyText({ ok: true, value: '0.0025', unit: 'kg', shown: '' })).toBe('2.500 g');
    expect(qtyText({ ok: true, value: '1.2625', unit: 'kg', shown: '' })).toBe('1.263 kg');
    expect(qtyText({ ok: false, message: 'x' })).toBe('—');
    expect(unitsOf('temperature').map((u) => u.symbol)).toEqual(['°C', 'K', '°F']);
    expect(unitsOf('pressure').map((u) => u.symbol)).toContain('N/mm²');
  });
});
