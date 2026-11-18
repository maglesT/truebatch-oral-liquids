import { describe, expect, it } from 'vitest';
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

// The designer findings of the full demo run of 17 Nov 2026 (F03-F17, F35, F36): what the master check reports, the
// plain view's words, and the pick lists offered from master data.

const block = (id: string) => BLOCKS.find((b) => b.id === id)!;
const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '50000', coreWeightMg: '600.0', dispensingRooms: ['RM-101'] };
const room = (code: string, name: string, area: string | null, active = true) => ({ itemId: code, code, name, version: 1, active, area, grade: 'D' });
const machine = (code: string, type: string | null, at: string | null, active = true) => ({ itemId: code, code, name: code, version: 1, active, kind: 'instrument' as const, type, room: at });
const MD = {
  rooms: [room('RM-101', 'Dispensing booth', 'Dispensing'), room('RM-932', 'Immunosuppressants block: dispensing', 'Dispensing'), room('RM-105', 'Compression room 1', 'Compression'),
    room('RM-110', 'QC instrument laboratory', 'QC'), room('RM-501', 'Cyclotron vault', 'Cyclotron vault'), room('RM-999', 'Old room', 'Compression', false)],
  equipment: [machine('IN-BAL-03', 'Balance', 'RM-101'), machine('IN-BAL-01', 'Balance', 'RM-110'), machine('TP-01', 'Tablet press', 'RM-105'),
    machine('IN-DT-01', 'Disintegration tester', 'RM-110'), machine('FR-01', 'Friabilator', 'RM-105')],
};
const uncoated = () => masterSchema.parse({ header, formula: [], stages: skeletonStages('wet-granulation-uncoated', header) });

describe('designer findings of the 17 Nov 2026 run', () => {
  it('TB-11 the master check warns when no machine of a step\'s type stands in the rooms its stage allows, and says where it stands (F17)', () => {
    const doc = uncoated();
    const compression = doc.stages.findIndex((s) => s.key === 'compression');
    const di = doc.stages[compression]!.steps.findIndex((t) => t.block.id === 'disintegration');
    const warned = placeChecks(doc, MD).find((p) => p.path === `stages[${compression}].steps[${di}]`);
    expect(warned).toMatchObject({ level: 'warning', rule: 'TB-11' });
    expect(warned!.message).toBe('No disintegration tester stands in a room this stage allows (Compression): IN-DT-01 stands in RM-110. Allow its room in the stage settings, or engineering moves it in master data');
    // The press and the friabilator stand in the compression room: no warning for them; with the tester moved, none.
    expect(placeChecks(doc, MD).filter((p) => p.path.startsWith(`stages[${compression}]`)).map((p) => p.path)).toEqual([`stages[${compression}].steps[${di}]`]);
    const moved = { ...MD, equipment: MD.equipment.map((m) => (m.code === 'IN-DT-01' ? { ...m, room: 'RM-105' } : m)) };
    expect(placeChecks(doc, moved).filter((p) => p.path.startsWith(`stages[${compression}]`))).toEqual([]);
    // A type master data does not have at all; a balance in a dispensing room of the master is found there.
    expect(placeChecks(doc, { ...MD, equipment: MD.equipment.filter((m) => m.code !== 'IN-DT-01') }).find((p) => p.path === `stages[${compression}].steps[${di}]`)!.message)
      .toMatch(/^Master data has no disintegration tester/);
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
    // The disintegration medium's temperature: no sentence while its limits are empty, and a warning to set them.
    const di = block('disintegration');
    expect(sentenceText(tablet(), di, { maxTime: '15' }, sentence(di, di.calcs[0]!))).toBe('');
    const doc = uncoated();
    expect(masterChecks(doc).filter((p) => /recorded but not checked/.test(p.message)).map((p) => p.message)).toEqual(['Medium temperature is recorded but not checked: set the medium temperature limits']);
    // A stage without a responsible role is reported.
    expect(masterChecks({ ...doc, stages: doc.stages.map((s, i) => (i === 0 ? { ...s, role: '' } : s)) }).some((p) => p.path === 'stages[0]' && /no responsible role/.test(p.message))).toBe(true);
  });

  it('the plain view gives numbers with their units and plain sentences (F06, F13)', () => {
    const di = block('disintegration');
    expect(sentenceText(tablet(), di, { maxTime: '15' }, sentence(di, di.calcs[1]!)))
      .toBe('Each of the times of 6 tablets must be at most 15 min; when one or two are not, the times of 12 more tablets are recorded too, and at least 16 of the 18 must be.');
    const pd = block('punch-die-check');
    expect(sentenceText(tablet(), pd, {}, sentence(pd, pd.calcs[1]!))).toBe('The punches or dies damaged must be 0: none allowed.');
    const rec = block('tablet-reconciliation');
    const good = rec.calcs.find((c) => /good tablets/i.test(c.label));
    if (good) expect(sentenceText(tablet(), rec, {}, sentence(rec, good))).toMatch(/^The good tablets are /);
    const lines = describeMaster(uncoated()).flatMap((s) => s.lines.map((l) => l.text));
    expect(lines).toContain('Batch size 50,000 tablets.');
    expect(lines.find((l) => l.includes('Produces bulk tablets'))).toMatch(/to be used within 720 hours \(30 days\)\./);
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
    expect(ownProducts([p('FG-PCM500', 'Tablet'), p('FG-ATV20', 'Film-coated tablet'), p('FG-INJ', 'Solution for injection'), p('EXZ', null)], 'bulk').map((x) => x.code))
      .toEqual(['FG-PCM500', 'FG-ATV20']);
    // Master data's kind: a tablet master offers the bulk products, a packing master the packs; no kind yet: both, as before.
    const all = [p('FG-PCM500', 'Tablet', 'bulk'), p('PK-PCM500-B10', 'Tablet', 'pack'), p('FG-AML5', 'Tablet', null), p('FG-INJ', 'Solution for injection', 'bulk')];
    expect(ownProducts(all, 'bulk').map((x) => x.code)).toEqual(['FG-PCM500', 'FG-AML5']);
    expect(ownProducts(all, 'pack').map((x) => x.code)).toEqual(['PK-PCM500-B10', 'FG-AML5']);
    // Dispensing: the rooms with a weighing balance first (never a QC lab's), each by code, name and area.
    const disp = dispensingRoomChoices(MD);
    expect(disp.groups).toEqual([{ label: 'Rooms with a weighing balance', options: ['RM-101'] }, { label: 'Other rooms', options: ['RM-105', 'RM-110', 'RM-501', 'RM-932'] }]);
    expect(disp.text('RM-932')).toBe('RM-932 · Immunosuppressants block: dispensing (Dispensing)');
    // A stage: the areas and rooms where its machines stand first.
    const compression = uncoated().stages.find((s) => s.key === 'compression')!;
    const st = stageRoomChoices(compression, MD);
    expect(st.groups[0]).toEqual({ label: "Where this stage's machines stand", options: ['Compression', 'QC', 'RM-105', 'RM-110'] });
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
