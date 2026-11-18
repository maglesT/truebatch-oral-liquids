import { describe, expect, it, vi } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { batchRefusal, batchView, doneProblems, evaluate, openSteps, stepLabel, stepTitle, type BatchEvent, type StepEvent } from '../shared/engine/index.js';
import { c8PrintedData, c9SerialCodes, expiryMonth, gs1, printedMonth, t27Expiry } from '../shared/templates/index.js';
import { at, ev, small } from './engine-fixture.js';
import { code, GTIN, packing } from './packing-fixture.js';
import { headline } from '../web/src/api-floor.js';
// The shared test master is built from test-only blocks (test/test-blocks.ts).
vi.mock('../shared/blocks/index.js', async (original) => (await import('./test-blocks.js')).withTestBlocks(original as never));

// TrueBatch Liquids Packing: the packing master checks (TL-P1 to TL-P10), the packing blocks run by the shared engine,
// the serialisation check (match, mismatch, duplicate, reconciliation), printed materials reconciled, the expiry from
// the shelf life, and QC approval before QA release.

const errors = (d: MasterDoc, rule?: string) => masterChecks(d).filter(blocking).filter((p) => !rule || p.rule === rule).map((p) => p.message);
const where = (d: MasterDoc, block: string) => {
  for (const [si, s] of d.stages.entries()) for (const [ti, t] of s.steps.entries()) if (t.block.id === block) return { si, ti, key: `${si}.1.${ti}.1`, st: t };
  throw new Error(block);
};
const without = (d: MasterDoc, ...blocks: string[]) => ({ ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => !blocks.includes(t.block.id)) })) });
const LINE = { itemId: 'ln-1', code: 'FL-01', name: 'Filling line 1', version: 1, type: 'filling line', room: 'PK-01' };
// The batch facts recorded at issue: bulk TL260001 made on 3 Nov 2026, 615 L issued (10 000 bottles of 61.5 mL), ready
// at 06:00 on 15 Nov 2026 with a hold of 168 h (to 06:00 on 22 Nov).
const issued = (d: MasterDoc, x: Record<string, unknown> = {}): StepEvent => {
  const values = { line: LINE, bulk: 'TL260001', mfgDate: '2026-11-03', quantity: { value: '615', unit: 'L' }, readyAt: '2026-11-15T06:00:00Z', holdHours: '168', ...x } as never;
  return ev('value', '0.1.0.1', { min: 1, payload: { values, results: evaluate(d, [], { stage: 0, sub: 1, step: 0, round: 1 }, values) } });
};
const results = (d: MasterDoc, events: StepEvent[], key: string, values: Record<string, unknown>) => {
  const [stage, sub, step, round] = key.split('.').map(Number) as [number, number, number, number];
  return evaluate(d, events, { stage, sub, step, round }, values as never);
};
const byKey = (d: MasterDoc, key: string) => {
  for (const [si, s] of d.stages.entries()) for (const [ti, t] of s.steps.entries()) if (t.key === key) return { si, ti, key: `${si}.1.${ti}.1`, st: t };
  throw new Error(key);
};

describe('the packing master (TL-P1 to TL-P10)', () => {
  it('TL-P1 a packing master per product, container, closure, measuring device and fill, with its packing materials, coding and limits, or it cannot be approved', () => {
    expect(errors(packing())).toEqual([]);
    expect(errors(packing({ materials: [] }), 'TL-P1')).toContain('The packing master lists no packing materials');
    expect(errors(packing({ materials: packing().pack!.materials.map((m) => ({ ...m, coded: false })) }), 'TL-P1'))
      .toContain('No packing material carries the batch coding: mark the materials the batch number, dates and MRP are printed on');
    const made = packing();
    made.stages[1]!.steps.push({ ...made.stages[1]!.steps[0]!, key: 'weigh', block: { id: 'weigh', version: 1 } });
    expect(errors(made, 'TL-P1')).toContain('Weigh a material is a manufacturing step: a packing master uses the packing steps');
    // A manufacturing master never uses a packing step; the pack's limits are the author's (the check lists them).
    expect(errors(small([{ steps: [{ block: { id: 'coding-check', version: 1 }, everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 10 } }] }]))).toContain('Coding check is a packing step: a manufacturing master cannot use it');
    const unset = packing();
    delete where(unset, 'cap-check').st.settings.defectLimit;
    expect(errors(unset)).toContain('Defective closures allowed per round is not set');
    // The fill: a liquid by its nominal fill (+ excess), a dry syrup by its fill weight; the bulk type is named.
    expect(errors(packing({ fillVolumeMl: undefined }), 'TL-P1')).toEqual(['The nominal fill volume is not set (the fill target is the nominal fill + its excess, never below it)']);
    expect(errors(packing({ fillWeightG: undefined }, 'dry syrup'), 'TL-P1')).toEqual(['The fill weight of powder per container is not set']);
    expect(errors(packing({ fillWeightG: '25.0' }, 'dry syrup'))).toEqual([]);
    const untyped = packing();
    delete untyped.header.type;
    expect(errors(untyped, 'TL-P1')).toContain('Choose the type of the bulk filled (solution, drops, suspension, emulsion or dry syrup)');
    // A single-dose unit with a fill excess: a warning (the dose is the whole unit).
    expect(masterChecks(packing({ type: 'sachet', closure: 'none' })).filter((p) => p.path === 'pack.fillExcessMl').map((p) => p.level)).toEqual(['warning']);
    // The pack is part of the master document: one of its own containers.
    expect(masterSchema.safeParse({ ...packing(), pack: { ...packing().pack, type: 'blister' } }).success).toBe(false);
  });

  it('TL-P2 the packing record starts with the released bulk issued to the filling line, in L (or kg of a dry syrup powder), with its ready time and hold', () => {
    expect(errors(without(packing(), 'liquid-bulk-issue'), 'TL-P2')).toEqual(['The packing record starts with the bulk liquid issued to the filling line: it links the record to the released bulk batch']);
    expect(errors(packing({ fillWeightG: '25.0' }, 'dry syrup'), 'TL-P2')).toEqual([]);
    expect(packing({ fillWeightG: '25.0' }, 'dry syrup').stages[0]!.steps[0]!.block.id).toBe('powder-bulk-issue');
    expect(findBlock({ id: 'liquid-bulk-issue', version: 1 })!.atIssue).toEqual(['line', 'bulk', 'mfgDate', 'quantity', 'readyAt', 'holdHours']);
  });

  it('TL-P3 line clearance before and after packing, checked by a second person', () => {
    expect(errors(without(packing(), 'pack-clearance-after'), 'TL-P3')).toEqual(['The packing record ends with line clearance after packing']);
    expect(errors(without(packing(), 'pack-clearance'), 'TL-P3')).toEqual(['Line clearance before packing is missing, or comes after the line set-up']);
    const alone = packing();
    where(alone, 'pack-clearance').st.checker = false;
    expect(errors(alone, 'TL-08')).toEqual(['A line clearance step needs a second-person check']);
  });

  it('TL-P4 every packing material is issued before the line set-up, where each component is checked; the bottles are washed or air-rinsed before filling', () => {
    const d = packing();
    expect(errors(without(d, 'line-setup'), 'TL-P4')).toEqual(['The line set-up and component check is missing']);
    const missing = { ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => t.key !== 'issue-carton') })) };
    expect(errors(missing, 'TL-P4')).toEqual(['Carton has no issue step']);
    const late = packing();
    late.stages[1]!.steps.push(late.stages[0]!.steps.pop()!);
    expect(errors(late, 'TL-P4')).toEqual(['Leaflet is issued after the line set-up']);
    expect(findBlock({ id: 'pack-material-issue', version: 1 })).toMatchObject({ gmp: 'weighing', checker: true });
    expect(errors(without(packing(), 'bottle-wash'), 'TL-P4')).toEqual(['The bottles are washed or air-rinsed before filling: the container wash step is missing, or comes after the fill']);
    expect(errors(packing({ type: 'sachet', closure: 'none' }), 'TL-P4')).toEqual([]);
  });

  it('TL-P4 each issue step is named after its material from the pack list, so no two look alike', () => {
    const d = packing();
    expect(d.stages[0]!.steps.slice(1).map((t) => stepTitle(d, t))).toEqual(['Issue Amber PET bottle 60 mL (PM-201)', 'Issue Child-resistant cap 25 mm (PM-202)',
      'Issue Measuring cup 10 mL (PM-203)', 'Issue Printed label (PM-204)', 'Issue Carton (PM-205)', 'Issue Leaflet (PM-206)']);
    expect(stepLabel(d, { stage: 2, sub: 1, step: 1, round: 1 })).toBe('Reconciliation and line clearance › Reconcile Printed label (PM-204)');
  });

  it('TL-P5 the coding is checked at the start and every N minutes at most, packs are inspected on line, and the camera is challenged with serialisation', () => {
    expect(errors(without(packing(), 'coding-check'), 'TL-P5')).toEqual(['The coding check (at the start and at intervals) is missing']);
    expect(errors(without(packing(), 'online-inspection'), 'TL-P5')).toEqual(['The on-line inspection is missing']);
    const slow = packing();
    where(slow, 'coding-check').st.everyMinutes = 90;
    expect(errors(slow, 'TL-P5')).toEqual(['Periodic checks every 90 min: they must be at least every 60 min']);
    expect(errors(packing({ serialisation: true, gtin: GTIN }))).toEqual([]);
    const serial = packing();
    serial.pack = { ...serial.pack!, serialisation: true, gtin: GTIN };
    expect(errors(serial, 'TL-P5')).toEqual(['Serialisation is checked for this pack: the camera challenge step is missing', 'Serialisation is checked for this pack: the serial numbers received step is missing',
      'Serialisation is checked for this pack: the serialisation sample check step is missing', 'Serialisation is checked for this pack: the reconciliation of serial numbers step is missing']);
    expect(errors(packing({ serialisation: true }), 'TL-P5')).toContain('Checking serialisation needs the pack GTIN');
  });

  it('TL-P6 every printed material is reconciled from its own issue, batch-coded leftovers are destroyed, and the checks alongside the line end first', () => {
    const d = packing();
    const noCarton = { ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => t.key !== 'reconcile-carton') })) };
    expect(errors(noCarton, 'TL-P6')).toEqual(['The printed Carton has no reconciliation step']);
    const typed = packing();
    where(typed, 'printed-reconciliation').st.settings.issued = '1000 units';
    expect(errors(typed, 'TL-P6')).toEqual(['The quantity issued comes from the issue step of the same material']);
    expect(errors(without(packing(), 'destruction'), 'TL-P6')).toEqual(['Batch-coded leftovers need the destruction step']);
    expect(errors(without(packing(), 'liquid-finished-goods'), 'TL-P6')).toEqual(['The finished goods and reconciliation of the bulk step is missing']);
    const inEnd = packing();
    inEnd.stages[2]!.steps.unshift(inEnd.stages[1]!.steps.pop()!);
    expect(errors(inEnd, 'TL-P6')).toEqual(['Carton and leaflet check runs alongside the line: put it in a stage before the finished goods']);
  });

  it('TL-P9 a pack for India domestic carries its MRP; an export pack may have none', () => {
    expect(errors(packing({ mrp: undefined }), 'TL-P9')).toEqual(['A pack for India domestic needs its MRP: it is printed on the pack and checked']);
    expect(errors(packing({ mrp: undefined, destination: 'Export' }))).toEqual([]);
  });

  it('TL-P10 one fill step of the bulk\'s kind; a suspension or emulsion stirred during filling; the filling room not above 30 °C for India domestic', () => {
    expect(packing({}, 'suspension').stages[1]!.steps.find((t) => t.key === 'fill')!.block.id).toBe('liquid-fill-stirred');
    expect(errors(packing({}, 'suspension'))).toEqual([]);
    const plain = packing({}, 'emulsion');
    byKey(plain, 'fill').st.block = { id: 'liquid-fill', version: 1 };
    expect(errors(plain, 'TL-P10')).toEqual(['A emulsion is kept stirred during filling: use the fill step with the bulk stirred']);
    expect(errors(without(packing(), 'liquid-fill'), 'TL-P10')).toEqual(['The packing record has one fill step (its rounds check the fill)']);
    const wrong = packing({ fillWeightG: '25.0' }, 'dry syrup');
    byKey(wrong, 'fill').st.block = { id: 'liquid-fill', version: 1 };
    expect(errors(wrong, 'TL-P10')).toContain('Fill bottles with periodic fill checks does not fill a dry syrup powder');
    const warm = packing();
    where(warm, 'room-status').st.settings.temperatureLimit = { high: '35', unit: '°C' };
    expect(errors(warm, 'TL-P10')).toEqual(['The filling room is not above 30 °C for India domestic (Schedule M Part IX)']);
    expect(errors(without(packing(), 'room-status'), 'TL-P10')).toEqual(['A pack for India domestic records the filling room temperature (not above 30 °C): the room conditions step is missing']);
    const exportPack = packing({ destination: 'Export', mrp: undefined });
    where(exportPack, 'room-status').st.settings.temperatureLimit = { high: '35', unit: '°C' };
    expect(errors(exportPack, 'TL-P10')).toEqual([]);
  });
});

describe('the packing blocks', () => {
  it('TL-P8 the expiry is worked out from the approved shelf life and the date of manufacture, never typed; the bottles to fill are the bulk ÷ the fill target', () => {
    expect(expiryMonth('2026-11-03', '24')).toBe('2028-10');
    expect(expiryMonth('2026-01-15', '24')).toBe('2027-12');
    expect(expiryMonth('2026-01-15', '24', 'same month')).toBe('2028-01');
    expect(t27Expiry({ manufactured: '2026-13-01', months: '24' })).toMatchObject({ ok: false });
    expect(t27Expiry({ manufactured: '2026-11-03', months: '0' })).toMatchObject({ ok: false });
    const d = packing();
    const r = results(d, [], '0.1.0.1', { mfgDate: '2026-11-03', quantity: { value: '615', unit: 'L' } });
    expect(r.expiry).toMatchObject({ ok: true, expiry: '2028-10', shown: 'Manufactured 11/2026, shelf life 24 months (to the end of the month before): expiry 10/2028' });
    expect(r.packs).toMatchObject({ ok: true, value: '10000', unit: 'packs' });
    // A dry syrup: the powder ÷ the fill weight.
    const p = packing({ fillWeightG: '25.0' }, 'dry syrup');
    expect(results(p, [], '0.1.0.1', { mfgDate: '2026-11-03', quantity: { value: '250', unit: 'kg' } }).packs).toMatchObject({ ok: true, value: '10000', unit: 'packs' });
    // The bulk step's figure is the expiry date, not the shelf life it is worked out from.
    expect(headline(r.expiry!)).toBe('10/2028');
    // No packing block has an expiry to type: the coding check works it out from the shelf life.
    for (const id of ['liquid-bulk-issue', 'powder-bulk-issue', 'coding-check', 'serial-sample']) expect(findBlock({ id, version: 1 })!.fields.map((f) => f.name)).not.toContain('expiry');
    const coding = where(d, 'coding-check');
    const check = (printedExpiry: string) => results(d, [issued(d)], coding.key, { printedBatch: 'TL260001', printedMfg: '11/2026', printedExpiry, printedMrp: 'Rs. 45.00', legible: 'yes', packingDone: 'no' }).expiryCheck;
    expect(check('EXP. OCT.2028')).toMatchObject({ check: { pass: true } });
    expect(check('11/2028')).toMatchObject({ check: { pass: false, shown: 'Expiry printed "11/2028"; batch record 10/2028 (manufactured 11/2026 + 24 months): DOES NOT MATCH' } });
  });

  it('TL-P5 the coding check compares the printed batch number, dates and MRP with the batch data, and an out-of-limits check needs a deviation note', () => {
    const d = packing();
    const c = where(d, 'coding-check');
    const values = { printedBatch: 'TL260001', printedMfg: 'NOV.2026', printedExpiry: '10/28', printedMrp: 'MRP Rs. 45.00 incl. of all taxes', legible: 'yes', packingDone: 'no' };
    const events = [issued(d)];
    const good = results(d, events, c.key, values);
    for (const k of ['batchCheck', 'mfgCheck', 'expiryCheck', 'mrpCheck', 'legibleCheck']) expect(good[k], k).toMatchObject({ ok: true, check: { pass: true } });
    const bad = results(d, events, c.key, { ...values, printedBatch: 'TL260007', printedMrp: 'Rs. 54.00' });
    expect(bad.batchCheck).toMatchObject({ check: { pass: false, shown: 'Batch no. printed "TL260007"; batch record TL260001: DOES NOT MATCH' } });
    expect(bad.mrpCheck).toMatchObject({ check: { pass: false } });
    // Signed with a mismatch only after a deviation note.
    const done = [...events, ev('started', c.key, { min: 2 }), ev('value', c.key, { min: 3, payload: { values: { ...values, printedBatch: 'TL260007' }, results: bad } })];
    const v = openSteps(d, done, at(10)).steps.find((s) => s.id === c.key)!;
    expect(doneProblems(d, v, at(10))).toEqual(['Out of limits: Batch no., MRP. Add a deviation note first.']);
    expect(printedMonth('2028-10')).toBe('2028-10');
    expect(printedMonth('13/2028')).toBeNull();
  });

  it('TL-P9 the coding check per destination: an export pack without an MRP has none printed', () => {
    const d = packing({ destination: 'Export', mrp: undefined });
    const c = where(d, 'coding-check');
    const mrp = (printedMrp: string) => results(d, [issued(d)], c.key, { printedBatch: 'TL260001', printedMfg: '11/2026', printedExpiry: '10/2028', printedMrp, legible: 'yes', packingDone: 'no' }).mrpCheck;
    expect(mrp('none')).toMatchObject({ check: { pass: true } });
    expect(mrp('Rs. 45.00')).toMatchObject({ check: { pass: false } });
    expect(c8PrintedData({ what: 'MRP', kind: 'money', printed: '45', expected: '45.00' })).toMatchObject({ check: { pass: true } });
  });

  it('TL-P9 the coding check reads the common Indian print styles, and still compares the values exactly with the batch record', () => {
    const d = packing();
    const c = where(d, 'coding-check');
    const check = (field: string, printed: string, name: string) => {
      const values = { printedBatch: 'TL260001', printedMfg: '11/2026', printedExpiry: '10/2028', printedMrp: 'Rs. 45.00', legible: 'yes', packingDone: 'no', [field]: printed };
      return (results(d, [issued(d)], c.key, values)[name] as { check?: { pass: boolean } }).check?.pass;
    };
    for (const p of ['M.R.P. Rs. 45.00 (Incl. of all taxes)', 'MRP Rs.45.00 incl. of all taxes', 'm.r.p.  rs 45.00 (incl. of all taxes)']) expect([p, check('printedMrp', p, 'mrpCheck')]).toEqual([p, true]);
    for (const p of ['MFG.DT. 11/2026', 'MFD. 11/2026', 'Mfg. Date 11/2026', 'mfg.dt.11/2026']) expect([p, check('printedMfg', p, 'mfgCheck')]).toEqual([p, true]);
    for (const p of ['EXP.DT. 10/2028', 'EXP. 10/2028', 'Use before 10/2028', 'exp.dt.10/2028']) expect([p, check('printedExpiry', p, 'expiryCheck')]).toEqual([p, true]);
    for (const p of ['B.No. TL260001', 'Batch No.: TL260001']) expect([p, check('printedBatch', p, 'batchCheck')]).toEqual([p, true]);
    // The label is read; the value must still be the batch record's.
    for (const [field, p, name] of [['printedMrp', 'M.R.P. Rs. 54.00 (Incl. of all taxes)', 'mrpCheck'], ['printedMfg', 'MFG.DT. 10/2026', 'mfgCheck'], ['printedMfg', 'Mfg. Date 11/2025', 'mfgCheck'],
      ['printedExpiry', 'EXP.DT. 11/2028', 'expiryCheck'], ['printedExpiry', 'Use before 10/2029', 'expiryCheck'], ['printedBatch', 'B.No. TL260007', 'batchCheck']] as const) {
      expect([p, check(field, p, name)]).toEqual([p, false]);
    }
  });

  it('TL-P10 the fill, capping and line checks run alongside: the next opens after the first fill round, and the stage closes only when every check has its end round', () => {
    const d = packing();
    const fill = where(d, 'liquid-fill');
    const capping = where(d, 'cap-check');
    const done = (key: string, min: number) => [ev('started', key, { min }), ev('done', key, { min: min + 1 })];
    const before = [issued(d), ...['0.1.0.1', ...d.stages[0]!.steps.slice(1).map((_, i) => `0.1.${i + 1}.1`)].flatMap((k, i) => done(k, 2 + i * 2)),
      ...done('1.1.0.1', 20), ...done('1.1.1.1', 22), ...done('1.1.2.1', 24)];
    const state = (events: StepEvent[], key: string) => openSteps(d, events, at(100)).steps.find((s) => s.id === key)?.state;
    expect(state(before, fill.key)).toBe('open');
    expect(state(before, capping.key)).toBe('waiting');
    const round1 = [...before, ...done(fill.key, 30)];
    expect(state(round1, capping.key)).toBe('open');
    expect(state(round1, `${fill.si}.1.${fill.ti}.2`)).toBe('open');
    expect(openSteps(d, round1, at(100)).stages[1]!.closed).toBe(false);
  });

  it('TL-P10 a fill round: 10 bottles, the mean and each fill against their limits; a round after the bulk hold is out of limits and needs a deviation note', () => {
    const d = packing();
    const f = where(d, 'liquid-fill');
    const fills = (w: string) => Array.from({ length: 10 }, () => ({ value: w, unit: 'g' }));
    const round = (checkedAt: string, w = '76.9') => results(d, [issued(d)], f.key, { round: 'start', checkedAt, fills: fills(w), counter: { value: '120', unit: 'units' }, filling: 'going on' });
    const r = round('2026-11-16T09:00:00Z');
    expect([r.mean, r.each]).toMatchObject([{ check: { pass: true } }, { check: { pass: true } }]);
    expect(r.holdCheck).toMatchObject({ ok: true, value: '27', check: { pass: true } });
    expect(round('2026-11-16T09:00:00Z', '75.5').mean).toMatchObject({ check: { pass: false } });
    // 22 Nov 07:00 is 169 h after the bulk was ready: past its hold of 168 h.
    const late = round('2026-11-22T07:00:00Z');
    expect(late.holdCheck).toMatchObject({ ok: true, value: '169', check: { pass: false } });
    const events = [issued(d), ev('started', f.key, { min: 2 }), ev('value', f.key, { min: 3, payload: { values: { round: 'start', checkedAt: '2026-11-22T07:00:00Z', fills: fills('76.9') }, results: late } })];
    const v = openSteps(d, events, at(10)).steps.find((s) => s.id === f.key)!;
    expect(doneProblems(d, v, at(10))).toContain('Out of limits: Time since the bulk was ready. Add a deviation note first.');
  });

  it('TL-P6 a printed material is reconciled to zero: issued = used + destroyed + returned, and a gap needs a deviation note and its number before release', () => {
    const d = packing();
    const issue = byKey(d, 'issue-label');
    const recon = byKey(d, 'reconcile-label');
    const events = [issued(d), ev('value', issue.key, { min: 2, payload: { values: { lot: 'LBL-1', issued: { value: '10200', unit: 'units' } } } })];
    const r = (used: string) => results(d, events, recon.key, { used: { value: used, unit: 'units' }, destroyed: { value: '120', unit: 'units' }, returned: { value: '80', unit: 'units' } }).reconciliation;
    expect(r('10000')).toMatchObject({ ok: true, unaccountedCheck: { pass: true } });
    const gap = r('9999');
    expect(gap).toMatchObject({ unaccountedCheck: { pass: false } });
    // TL-18 mechanism: a reconciliation out of limits blocks release until a deviation note with its number.
    const all = [...events, ev('started', recon.key, { min: 3 }), ev('value', recon.key, { min: 4, payload: { values: {}, results: { reconciliation: gap } as never } })];
    expect(batchView(d, all, [], at(10)).yieldOut).toEqual([expect.stringMatching(/^The yield of Reconciliation and line clearance › .+ is out of limits: a deviation note with its reference is needed$/)]);
  });

  it('TL-P6 finished goods: the bulk in good packs, samples and rejected bottles (× the fill target) and the bulk left, against the bulk issued; the yield in packs', () => {
    const d = packing();
    const f = where(d, 'liquid-finished-goods');
    const r = results(d, [issued(d)], f.key, { packs: { value: '9800', unit: 'packs' }, cartons: { value: '205', unit: 'nos' }, samples: { value: '40', unit: 'packs' },
      rejects: { value: '60', unit: 'units' }, left: { value: '5.0', unit: 'L' } });
    expect(r.packed).toMatchObject({ ok: true, value: '602.7', unit: 'L' });
    expect(r.sampled).toMatchObject({ value: '2.46' });
    expect(r.rejected).toMatchObject({ value: '3.69' });
    expect(r.yield).toMatchObject({ value: '98', check: { pass: true } });
    expect(r.accountability).toMatchObject({ check: { pass: true } });
    expect((r.accountability as { value: string }).value).toMatch(/^99\.8/);
    // A dry syrup: the powder in packs by the fill weight.
    const p = packing({ fillWeightG: '25.0' }, 'dry syrup');
    const pf = where(p, 'powder-finished-goods');
    const powder = results(p, [issued(p, { quantity: { value: '250', unit: 'kg' } })], pf.key, { packs: { value: '9900', unit: 'packs' }, cartons: { value: '207', unit: 'nos' },
      samples: { value: '40', unit: 'packs' }, rejects: { value: '50', unit: 'units' }, left: { value: '0.25', unit: 'kg' } });
    expect(powder.packed).toMatchObject({ ok: true, value: '247.5', unit: 'kg' });
    expect(powder.accountability).toMatchObject({ value: '100', check: { pass: true } });
  });

  it('TL-21 a packed batch: QC approves it after production approval (the QC report), and QA releases it only after QC', () => {
    const p = { ...small([{ steps: [{}] }]), pack: packing().pack };
    const approved: BatchEvent[] = [{ id: 1, kind: 'production_approved', payload: {}, person: 5, at: at(50) }];
    const qcApproved: BatchEvent[] = [...approved, { id: 2, kind: 'qc_approved', payload: { reportNo: 'QC-26-0101' }, person: 4, at: at(55) }];
    const events = [ev('started', '0.1.0.1', { min: 1 }), ev('value', '0.1.0.1', { min: 2, payload: { values: { reading: { value: '6.0', unit: '' } }, results: {} } }), ev('done', '0.1.0.1', { min: 3 })];
    const qa = { id: 3, permissions: ['truebatch_liquids.qa.release'] };
    const qc = { id: 4, permissions: ['truebatch_liquids.qc.approve'] };
    const view = (b: BatchEvent[]) => batchView(p, events, b, at(60));
    expect(view(approved).status).toBe('production approved');
    expect(batchRefusal('release', view(approved), qa)?.problems).toEqual(['Not possible while the batch is production approved.']);
    expect(batchRefusal('reject', view(approved), qa)?.problems).toEqual(['Not possible while the batch is production approved.']);
    expect(batchRefusal('qc-approve', view(approved), qa)).toMatchObject({ status: 403 });
    expect(batchRefusal('qc-approve', view(approved), qc)).toBeNull();
    expect(view(qcApproved).status).toBe('QC approved');
    expect(batchRefusal('release', view(qcApproved), qa)).toBeNull();
    expect(batchRefusal('qc-approve', view(qcApproved), qc)?.problems).toEqual(['Not possible while the batch is QC approved.']);
    // Every step done, not yet approved: the refusal says "packing complete", never "manufacturing complete".
    expect(view([]).status).toBe('manufacturing complete');
    expect(batchRefusal('release', view([]), qa)?.problems).toEqual(['Not possible while the batch is packing complete.']);
    expect(batchRefusal('release', batchView({ ...p, pack: undefined }, events, [], at(60)), qa)?.problems).toEqual(['Not possible while the batch is manufacturing complete.']);
  });
});

describe('the serialisation check (the customer system numbers, checked never generated)', () => {
  const i = { gtin: GTIN, batch: 'TL260001', manufactured: '2026-11-03', months: '24' };
  it('TL-P5 serialisation sample: codes of this batch match on GTIN, batch and expiry, with well-formed serials', () => {
    expect(c9SerialCodes({ ...i, codes: `${code('A1B2C3D4E5')} ${code('A1B2C3D4E6')}` })).toMatchObject({ ok: true, value: expect.anything(), check: { pass: true }, serials: ['A1B2C3D4E5', 'A1B2C3D4E6'] });
    // Raw element strings, with a group separator after the batch.
    expect(gs1(`01${GTIN}172810311\u001d0TL260001`)).toBeNull();
    expect(gs1(`]d201${GTIN}1728103110TL260001\u001d21X9`)).toEqual({ '01': GTIN, '17': '281031', '10': 'TL260001', '21': 'X9' });
    expect(c9SerialCodes({ ...i, codes: `01${GTIN}1728103110TL260001\u001d21X9` })).toMatchObject({ check: { pass: true } });
  });

  it('TL-P5 serialisation sample: a code of another GTIN, batch or expiry, or a bad serial, is refused', () => {
    const r = c9SerialCodes({ ...i, codes: [code('S1', 'TL260002'), code('S2', 'TL260001', '281130'), code('S3', 'TL260001', '281031', '08901234567906'), code('BAD#1'), `(01)${GTIN}(17)281031(10)TL260001`, 'hello'].join(' ') });
    expect(r).toMatchObject({ check: { pass: false } });
    const shown = (r as { shown: string }).shown;
    expect(shown).toContain('code 1: batch TL260002, not TL260001');
    expect(shown).toContain('code 2: expiry 281130, not 10/2028');
    expect(shown).toContain('code 3: GTIN 08901234567906, not 08901234567890');
    expect(shown).toContain('code 4: serial "BAD#1" is not 1 to 20 GS1 characters');
    expect(shown).toContain('code 5: serial missing');
    expect(shown).toContain('code 6: not a GS1 code');
    expect(c9SerialCodes({ ...i, codes: code('S1'), gtin: '08901234567891' })).toMatchObject({ ok: false });
  });

  it('TL-P5 serialisation sample: the same serial is never read twice in the batch, in one round or in an earlier one', () => {
    expect(c9SerialCodes({ ...i, codes: `${code('S1')} ${code('S1')}` })).toMatchObject({ check: { pass: false, shown: expect.stringContaining('code 2: serial S1 was already read in this batch') } });
    const d = packing({ serialisation: true, gtin: GTIN });
    const s = where(d, 'serial-sample');
    const round1 = [issued(d), ev('started', s.key, { min: 5 }), ev('value', s.key, { min: 6, payload: { values: { codes: `${code('S1')} ${code('S2')}` } } }), ev('done', s.key, { min: 7 })];
    const r2 = `${s.si}.1.${s.ti}.2`;
    expect(results(d, round1, r2, { codes: `${code('S3')} ${code('S2')}`, packingDone: 'no' }).codesCheck).toMatchObject({ check: { pass: false, shown: expect.stringContaining('code 2: serial S2 was already read in this batch') } });
    expect(results(d, round1, r2, { codes: code('S3'), packingDone: 'no' }).codesCheck).toMatchObject({ check: { pass: true } });
  });

  it('TL-P5 serialisation reconciliation: received = printed OK + rejected + destroyed + unused; a gap needs a deviation note', () => {
    const d = packing({ serialisation: true, gtin: GTIN });
    const got = where(d, 'serial-received');
    const rec = where(d, 'serial-reconciliation');
    const events = [issued(d), ev('value', got.key, { min: 3, payload: { values: { received: { value: '10500', unit: 'units' }, reference: 'SER-ORD-77', forBatch: 'yes' } } })];
    const r = (unused: string) => results(d, events, rec.key, { printedOk: { value: '9800', unit: 'units' }, rejected: { value: '120', unit: 'units' }, destroyed: { value: '80', unit: 'units' }, unused: { value: unused, unit: 'units' } }).reconciliation;
    expect(r('500')).toMatchObject({ unaccountedCheck: { pass: true } });
    expect(r('499')).toMatchObject({ unaccountedCheck: { pass: false } });
    // Above, a batch recorded before serial numbers were counted in nos (units): it still works out. A new batch counts
    // them in nos, as the other counts of the floor (17 Nov 2026 run).
    const nos = { value: '10500', unit: 'nos' };
    const now = results(d, [issued(d), ev('value', got.key, { min: 3, payload: { values: { received: nos, reference: 'SER-ORD-77', forBatch: 'yes' } } })], rec.key,
      { printedOk: { value: '9800', unit: 'nos' }, rejected: { value: '120', unit: 'nos' }, destroyed: { value: '80', unit: 'nos' }, unused: { value: '500', unit: 'nos' } }).reconciliation;
    expect(now).toMatchObject({ unaccountedCheck: { pass: true } });
    expect(JSON.stringify(now)).toContain('9800 nos printed OK');
    expect(JSON.stringify(now)).not.toContain('units');
    for (const f of [...findBlock({ id: 'serial-received', version: 1 })!.fields, ...findBlock({ id: 'serial-reconciliation', version: 1 })!.fields]) expect(f.unit ?? 'nos').toBe('nos');
    const all = [...events, ev('started', rec.key, { min: 4 }), ev('value', rec.key, { min: 5, payload: { values: { printedOk: { value: '9800', unit: 'units' }, rejected: { value: '120', unit: 'units' }, destroyed: { value: '80', unit: 'units' }, unused: { value: '499', unit: 'units' } }, results: { reconciliation: r('499') } as never } })];
    const v = openSteps(d, all, at(10)).steps.find((x) => x.id === rec.key)!;
    expect(doneProblems(d, v, at(10))).toEqual(['Out of limits: Serial numbers accounted for. Add a deviation note first.']);
  });
});
