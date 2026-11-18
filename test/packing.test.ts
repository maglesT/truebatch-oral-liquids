import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { batchRefusal, batchView, doneProblems, evaluate, openSteps, stepLabel, stepTitle, type BatchEvent, type StepEvent } from '../shared/engine/index.js';
import { c8PrintedData, c9SerialCodes, expiryMonth, gs1, printedMonth, t27Expiry } from '../shared/templates/index.js';
import { at, ev, small } from './engine-fixture.js';
import { code, GTIN, packing } from './packing-fixture.js';
import { headline } from '../web/src/api-floor.js';

// TrueBatch Tablets Packing: the packing master checks (TB-P1 to TB-P9), the packing blocks run by the shared engine,
// the serialisation check (match, mismatch, duplicate, reconciliation), printed materials reconciled, the expiry from
// the shelf life, and QC approval before QA release.

const errors = (d: MasterDoc, rule?: string) => masterChecks(d).filter(blocking).filter((p) => !rule || p.rule === rule).map((p) => p.message);
const where = (d: MasterDoc, block: string) => {
  for (const [si, s] of d.stages.entries()) for (const [ti, t] of s.steps.entries()) if (t.block.id === block) return { si, ti, key: `${si}.1.${ti}.1`, st: t };
  throw new Error(block);
};
const without = (d: MasterDoc, ...blocks: string[]) => ({ ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => !blocks.includes(t.block.id)) })) });
const LINE = { itemId: 'ln-1', code: 'BL-01', name: 'Blister line 1', version: 1, type: 'blister line', room: 'PK-01' };
// The batch facts recorded at issue: bulk TB260001 made on 3 Nov 2026, 100 000 tablets.
const issued = (d: MasterDoc, x: Record<string, unknown> = {}): StepEvent => {
  const values = { line: LINE, bulk: 'TB260001', mfgDate: '2026-11-03', tablets: { value: '100000', unit: 'tablets' }, ...x } as never;
  return ev('value', '0.1.0.1', { min: 1, payload: { values, results: evaluate(d, [], { stage: 0, sub: 1, step: 0, round: 1 }, values) } });
};
const results = (d: MasterDoc, events: StepEvent[], key: string, values: Record<string, unknown>) => {
  const [stage, sub, step, round] = key.split('.').map(Number) as [number, number, number, number];
  return evaluate(d, events, { stage, sub, step, round }, values as never);
};

describe('the packing master (TB-P1 to TB-P9)', () => {
  it('TB-P1 a packing master per product, pack type and size, with its packing materials, coding and limits, or it cannot be approved', () => {
    expect(errors(packing())).toEqual([]);
    expect(errors(packing({ materials: [] }), 'TB-P1')).toContain('The packing master lists no packing materials');
    expect(errors(packing({ materials: packing().pack!.materials.map((m) => ({ ...m, coded: false })) }), 'TB-P1'))
      .toContain('No packing material carries the batch coding: mark the materials the batch number, dates and MRP are printed on');
    const tabletStep = packing();
    tabletStep.stages[1]!.steps.push({ ...tabletStep.stages[1]!.steps[0]!, key: 'weigh', block: { id: 'weigh', version: 1 } });
    expect(errors(tabletStep, 'TB-P1')).toContain('Weigh a material is a tablet manufacturing step: a packing master uses the packing steps');
    // A tablet master never uses a packing step; the pack's limits are the author's (the check lists them).
    expect(errors(small([{ steps: [{ block: { id: 'coding-check', version: 1 }, everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 10 } }] }]))).toContain('Coding check is a packing step: a tablet master cannot use it');
    const unset = packing();
    delete where(unset, 'forming-check').st.settings.sealLimit;
    expect(errors(unset)).toContain('Sealing temperature limits is not set');
    // The pack is part of the master document: one of its own types and sizes.
    expect(masterSchema.safeParse({ ...packing(), pack: { ...packing().pack, type: 'sachet' } }).success).toBe(false);
  });

  it('TB-P2 the packing record starts with the bulk tablets issued to the line, linked to the bulk batch', () => {
    expect(errors(without(packing(), 'bulk-issue'), 'TB-P2')).toEqual(['The packing record starts with the bulk tablets issued to the line: it links the record to the released bulk batch']);
    expect(findBlock({ id: 'bulk-issue', version: 1 })!.atIssue).toEqual(['line', 'bulk', 'mfgDate', 'tablets']);
  });

  it('TB-P3 line clearance before and after packing, checked by a second person; blisters and strips formed, sealed and leak tested', () => {
    expect(errors(without(packing(), 'pack-clearance-after'), 'TB-P3')).toEqual(['The packing record ends with line clearance after packing']);
    expect(errors(without(packing(), 'pack-clearance'), 'TB-P3')).toEqual(['Line clearance before packing is missing, or comes after the line set-up']);
    expect(errors(without(packing(), 'leak-test'), 'TB-P3')).toEqual(['A blister pack needs the leak test step']);
    expect(errors(without(packing({ type: 'bottle' }), 'leak-test', 'forming-check'), 'TB-P3')).toEqual([]);
    const alone = packing();
    where(alone, 'pack-clearance').st.checker = false;
    expect(errors(alone, 'TB-08')).toEqual(['A line clearance step needs a second-person check']);
  });

  it('TB-P4 every packing material is issued before the line set-up, where each component is checked against the packing master', () => {
    const d = packing();
    expect(errors(without(d, 'line-setup'), 'TB-P4')).toEqual(['The line set-up and component check is missing']);
    const missing = { ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => t.key !== 'issue-carton') })) };
    expect(errors(missing, 'TB-P4')).toEqual(['Carton has no issue step']);
    const late = packing();
    late.stages[1]!.steps.push(late.stages[0]!.steps.pop()!);
    expect(errors(late, 'TB-P4')).toEqual(['Leaflet is issued after the line set-up']);
    expect(findBlock({ id: 'pack-material-issue', version: 1 })).toMatchObject({ gmp: 'weighing', checker: true });
  });

  it('TB-P4 each issue step is named after its material from the pack list, so no two look alike', () => {
    const d = packing();
    expect(d.stages[0]!.steps.slice(1).map((t) => stepTitle(d, t))).toEqual(['Issue Printed aluminium foil (PM-101)', 'Issue PVC/PVDC film (PM-102)', 'Issue Carton (PM-103)', 'Issue Leaflet (PM-104)']);
    expect(stepLabel(d, { stage: 2, sub: 1, step: 1, round: 1 })).toBe('Reconciliation and line clearance › Reconcile Printed aluminium foil (PM-101)');
  });

  it('TB-P5 the coding is checked at the start and every N minutes at most, packs are inspected on line, and the camera is challenged with serialisation', () => {
    expect(errors(without(packing(), 'coding-check'), 'TB-P5')).toEqual(['The coding check (at the start and at intervals) is missing']);
    expect(errors(without(packing(), 'online-inspection'), 'TB-P5')).toEqual(['The on-line inspection is missing']);
    const slow = packing();
    where(slow, 'coding-check').st.everyMinutes = 90;
    expect(errors(slow, 'TB-15')).toEqual(['Periodic checks every 90 min: they must be at least every 60 min']);
    expect(errors(packing({ serialisation: true, gtin: GTIN }))).toEqual([]);
    const serial = packing();
    serial.pack = { ...serial.pack!, serialisation: true, gtin: GTIN };
    expect(errors(serial, 'TB-P5')).toEqual(['Serialisation is checked for this pack: the camera challenge step is missing', 'Serialisation is checked for this pack: the serial numbers received step is missing',
      'Serialisation is checked for this pack: the serialisation sample check step is missing', 'Serialisation is checked for this pack: the reconciliation of serial numbers step is missing']);
    expect(errors(packing({ serialisation: true }), 'TB-P5')).toContain('Checking serialisation needs the pack GTIN');
  });

  it('TB-P6 every printed material is reconciled from its own issue, batch-coded leftovers are destroyed, and the checks alongside the line end first', () => {
    const d = packing();
    const noCarton = { ...d, stages: d.stages.map((s) => ({ ...s, steps: s.steps.filter((t) => t.key !== 'reconcile-carton') })) };
    expect(errors(noCarton, 'TB-P6')).toEqual(['The printed Carton has no reconciliation step']);
    const typed = packing();
    where(typed, 'printed-reconciliation').st.settings.issued = '1000 m';
    expect(errors(typed, 'TB-P6')).toEqual(['The quantity issued comes from the issue step of the same material']);
    expect(errors(without(packing(), 'destruction'), 'TB-P6')).toEqual(['Batch-coded leftovers need the destruction step']);
    const inEnd = packing();
    inEnd.stages[2]!.steps.unshift(inEnd.stages[1]!.steps.pop()!);
    expect(errors(inEnd, 'TB-P6')).toEqual(['Carton and leaflet check runs alongside the line: put it in a stage before the finished goods']);
  });

  it('TB-P9 a pack for India domestic carries its MRP; an export pack may have none', () => {
    expect(errors(packing({ mrp: undefined }), 'TB-P9')).toEqual(['A pack for India domestic needs its MRP: it is printed on the pack and checked']);
    expect(errors(packing({ mrp: undefined, destination: 'Export' }))).toEqual([]);
  });
});

describe('the packing blocks', () => {
  it('TB-P8 the expiry is worked out from the approved shelf life and the date of manufacture, never typed', () => {
    expect(expiryMonth('2026-11-03', '24')).toBe('2028-10');
    expect(expiryMonth('2026-01-15', '24')).toBe('2027-12');
    expect(expiryMonth('2026-01-15', '24', 'same month')).toBe('2028-01');
    expect(t27Expiry({ manufactured: '2026-13-01', months: '24' })).toMatchObject({ ok: false });
    expect(t27Expiry({ manufactured: '2026-11-03', months: '0' })).toMatchObject({ ok: false });
    const d = packing();
    const r = results(d, [], '0.1.0.1', { mfgDate: '2026-11-03', tablets: { value: '100000', unit: 'tablets' } });
    expect(r.expiry).toMatchObject({ ok: true, expiry: '2028-10', shown: 'Manufactured 11/2026, shelf life 24 months (to the end of the month before): expiry 10/2028' });
    expect(r.packs).toMatchObject({ ok: true, value: '10000', unit: 'packs' });
    // The bulk step's figure is the expiry date, not the shelf life it is worked out from.
    expect(headline(r.expiry!)).toBe('10/2028');
    // No packing block has an expiry to type: the coding check works it out from the shelf life.
    for (const id of ['bulk-issue', 'coding-check', 'serial-sample']) expect(findBlock({ id, version: 1 })!.fields.map((f) => f.name)).not.toContain('expiry');
    const coding = where(d, 'coding-check');
    const check = (printedExpiry: string) => results(d, [issued(d)], coding.key, { printedBatch: 'TB260001', printedMfg: '11/2026', printedExpiry, printedMrp: 'Rs. 125.00', legible: 'yes', packingDone: 'no' }).expiryCheck;
    expect(check('EXP. OCT.2028')).toMatchObject({ check: { pass: true } });
    expect(check('11/2028')).toMatchObject({ check: { pass: false, shown: 'Expiry printed "11/2028"; batch record 10/2028 (manufactured 11/2026 + 24 months): DOES NOT MATCH' } });
  });

  it('TB-P5 the coding check compares the printed batch number, dates and MRP with the batch data, and an out-of-limits check needs a deviation note', () => {
    const d = packing();
    const c = where(d, 'coding-check');
    const values = { printedBatch: 'TB260001', printedMfg: 'NOV.2026', printedExpiry: '10/28', printedMrp: 'MRP Rs. 125.00 incl. of all taxes', legible: 'yes', packingDone: 'no' };
    const events = [issued(d)];
    const good = results(d, events, c.key, values);
    for (const k of ['batchCheck', 'mfgCheck', 'expiryCheck', 'mrpCheck', 'legibleCheck']) expect(good[k], k).toMatchObject({ ok: true, check: { pass: true } });
    const bad = results(d, events, c.key, { ...values, printedBatch: 'TB260007', printedMrp: 'Rs. 152.00' });
    expect(bad.batchCheck).toMatchObject({ check: { pass: false, shown: 'Batch no. printed "TB260007"; batch record TB260001: DOES NOT MATCH' } });
    expect(bad.mrpCheck).toMatchObject({ check: { pass: false } });
    // Signed with a mismatch only after a deviation note.
    const done = [...events, ev('started', c.key, { min: 2 }), ev('value', c.key, { min: 3, payload: { values: { ...values, printedBatch: 'TB260007' }, results: bad } })];
    const v = openSteps(d, done, at(10)).steps.find((s) => s.id === c.key)!;
    expect(doneProblems(d, v, at(10))).toEqual(['Out of limits: Batch no., MRP. Add a deviation note first.']);
    expect(printedMonth('2028-10')).toBe('2028-10');
    expect(printedMonth('13/2028')).toBeNull();
  });

  it('TB-P9 the coding check per destination: an export pack without an MRP has none printed', () => {
    const d = packing({ destination: 'Export', mrp: undefined });
    const c = where(d, 'coding-check');
    const mrp = (printedMrp: string) => results(d, [issued(d)], c.key, { printedBatch: 'TB260001', printedMfg: '11/2026', printedExpiry: '10/2028', printedMrp, legible: 'yes', packingDone: 'no' }).mrpCheck;
    expect(mrp('none')).toMatchObject({ check: { pass: true } });
    expect(mrp('Rs. 125.00')).toMatchObject({ check: { pass: false } });
    expect(c8PrintedData({ what: 'MRP', kind: 'money', printed: '125', expected: '125.00' })).toMatchObject({ check: { pass: true } });
  });

  it('TB-P9 the coding check reads the common Indian print styles, and still compares the values exactly with the batch record', () => {
    const d = packing();
    const c = where(d, 'coding-check');
    const check = (field: string, printed: string, name: string) => {
      const values = { printedBatch: 'TB260001', printedMfg: '11/2026', printedExpiry: '10/2028', printedMrp: 'Rs. 125.00', legible: 'yes', packingDone: 'no', [field]: printed };
      return (results(d, [issued(d)], c.key, values)[name] as { check?: { pass: boolean } }).check?.pass;
    };
    for (const p of ['M.R.P. Rs. 125.00 (Incl. of all taxes)', 'MRP Rs.125.00 incl. of all taxes', 'm.r.p.  rs 125.00 (incl. of all taxes)']) expect([p, check('printedMrp', p, 'mrpCheck')]).toEqual([p, true]);
    for (const p of ['MFG.DT. 11/2026', 'MFD. 11/2026', 'Mfg. Date 11/2026', 'mfg.dt.11/2026']) expect([p, check('printedMfg', p, 'mfgCheck')]).toEqual([p, true]);
    for (const p of ['EXP.DT. 10/2028', 'EXP. 10/2028', 'Use before 10/2028', 'exp.dt.10/2028']) expect([p, check('printedExpiry', p, 'expiryCheck')]).toEqual([p, true]);
    for (const p of ['B.No. TB260001', 'Batch No.: TB260001']) expect([p, check('printedBatch', p, 'batchCheck')]).toEqual([p, true]);
    // The label is read; the value must still be the batch record's.
    for (const [field, p, name] of [['printedMrp', 'M.R.P. Rs. 152.00 (Incl. of all taxes)', 'mrpCheck'], ['printedMfg', 'MFG.DT. 10/2026', 'mfgCheck'], ['printedMfg', 'Mfg. Date 11/2025', 'mfgCheck'],
      ['printedExpiry', 'EXP.DT. 11/2028', 'expiryCheck'], ['printedExpiry', 'Use before 10/2029', 'expiryCheck'], ['printedBatch', 'B.No. TB260007', 'batchCheck']] as const) {
      expect([p, check(field, p, name)]).toEqual([p, false]);
    }
  });

  it('TB-P5 the checks alongside the line: the next check opens after the first round, and the stage closes only when every check has its end round', () => {
    const d = packing();
    const coding = where(d, 'coding-check');
    const forming = where(d, 'forming-check');
    const done = (key: string, min: number) => [ev('started', key, { min }), ev('done', key, { min: min + 1 })];
    const before = [issued(d), ...['0.1.0.1', ...d.stages[0]!.steps.slice(1).map((_, i) => `0.1.${i + 1}.1`)].flatMap((k, i) => done(k, 2 + i * 2)),
      ...done('1.1.0.1', 20), ...done('1.1.1.1', 22)];
    const state = (events: StepEvent[], key: string) => openSteps(d, events, at(100)).steps.find((s) => s.id === key)?.state;
    expect(state(before, coding.key)).toBe('open');
    expect(state(before, forming.key)).toBe('waiting');
    const round1 = [...before, ...done(coding.key, 30)];
    expect(state(round1, forming.key)).toBe('open');
    expect(state(round1, `${coding.si}.1.${coding.ti}.2`)).toBe('open');
    expect(openSteps(d, round1, at(100)).stages[1]!.closed).toBe(false);
  });

  it('TB-P3 a sealing temperature out of limits and a leaking pack fail; the leak test sample comes from the AQL plan for the theoretical packs', () => {
    const d = packing();
    const f = where(d, 'forming-check');
    expect(results(d, [issued(d)], f.key, { sealTemp: { value: '195', unit: '°C' }, pockets: 'yes', seal: 'yes', packingDone: 'no' }).sealCheck).toMatchObject({ check: { pass: false } });
    const l = where(d, 'leak-test');
    const leak = (leaking: string) => results(d, [issued(d)], l.key, { vacuum: { value: '500', unit: 'mbar' }, tested: { value: '20', unit: 'units' }, leaking: { value: leaking, unit: 'units' }, packingDone: 'no' }).plan;
    expect(leak('0')).toMatchObject({ ok: true, value: '20', check: { pass: true, shown: expect.stringContaining('Sample 20 of 10000 (level S-2)') } });
    expect(leak('1')).toMatchObject({ check: { pass: false } });
  });

  it('TB-P6 a printed material is reconciled to zero: issued = used + destroyed + returned, and a gap needs a deviation note and its number before release', () => {
    const d = packing();
    const issue = where(d, 'pack-material-issue');
    const recon = where(d, 'printed-reconciliation');
    const events = [issued(d), ev('value', issue.key, { min: 2, payload: { values: { lot: 'FOIL-1', issued: { value: '1250', unit: 'm' } } } })];
    const r = (used: string) => results(d, events, recon.key, { used: { value: used, unit: 'm' }, destroyed: { value: '20', unit: 'm' }, returned: { value: '30', unit: 'm' } }).reconciliation;
    expect(r('1200')).toMatchObject({ ok: true, unaccountedCheck: { pass: true } });
    const gap = r('1199');
    expect(gap).toMatchObject({ unaccountedCheck: { pass: false } });
    expect(gap).toMatchObject({ shown: expect.stringContaining('unaccounted 1250 m − 1249.00 m = 1.00 m') });
    // TB-18 mechanism: a reconciliation out of limits blocks release until a deviation note with its number.
    const all = [...events, ev('started', recon.key, { min: 3 }), ev('value', recon.key, { min: 4, payload: { values: {}, results: { reconciliation: gap } as never } })];
    expect(batchView(d, all, [], at(10)).yieldOut).toEqual([expect.stringMatching(/^The yield of Reconciliation and line clearance › .+ is out of limits: a deviation note with its reference is needed$/)]);
  });

  it('TB-P6 finished goods: the tablets in packs and samples, returned and rejected by weight, the yield in packs and the accountability of the tablets issued', () => {
    const d = packing();
    const f = where(d, 'finished-goods');
    const r = results(d, [issued(d)], f.key, { packs: { value: '9800', unit: 'units' }, cartons: { value: '980', unit: 'units' }, samples: { value: '40', unit: 'units' },
      returnedWeight: { value: '0.375', unit: 'kg' }, rejectWeight: { value: '0.125', unit: 'kg' } });
    expect(r.packed).toMatchObject({ ok: true, value: '98000', unit: 'tablets' });
    expect(r.returned).toMatchObject({ value: '1500' });
    expect(r.rejects).toMatchObject({ value: '500' });
    expect(r.yield).toMatchObject({ value: '98', check: { pass: true } });
    expect(r.accountability).toMatchObject({ value: '100.4', check: { pass: true } });
  });

  it('TB-21 a packed batch: QC approves it after production approval (the QC report), and QA releases it only after QC', () => {
    const p = { ...small([{ steps: [{}] }]), pack: packing().pack };
    const approved: BatchEvent[] = [{ id: 1, kind: 'production_approved', payload: {}, person: 5, at: at(50) }];
    const qcApproved: BatchEvent[] = [...approved, { id: 2, kind: 'qc_approved', payload: { reportNo: 'QC-26-0101' }, person: 4, at: at(55) }];
    const events = [ev('started', '0.1.0.1', { min: 1 }), ev('value', '0.1.0.1', { min: 2, payload: { values: { reading: { value: '6.0', unit: '' } }, results: {} } }), ev('done', '0.1.0.1', { min: 3 })];
    const qa = { id: 3, permissions: ['truebatch.qa.release'] };
    const qc = { id: 4, permissions: ['truebatch.qc.approve'] };
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
  const i = { gtin: GTIN, batch: 'TB260001', manufactured: '2026-11-03', months: '24' };
  it('TB-P5 serialisation sample: codes of this batch match on GTIN, batch and expiry, with well-formed serials', () => {
    expect(c9SerialCodes({ ...i, codes: `${code('A1B2C3D4E5')} ${code('A1B2C3D4E6')}` })).toMatchObject({ ok: true, value: expect.anything(), check: { pass: true }, serials: ['A1B2C3D4E5', 'A1B2C3D4E6'] });
    // Raw element strings, with a group separator after the batch.
    expect(gs1(`01${GTIN}172810311\u001d0TB260001`)).toBeNull();
    expect(gs1(`]d201${GTIN}1728103110TB260001\u001d21X9`)).toEqual({ '01': GTIN, '17': '281031', '10': 'TB260001', '21': 'X9' });
    expect(c9SerialCodes({ ...i, codes: `01${GTIN}1728103110TB260001\u001d21X9` })).toMatchObject({ check: { pass: true } });
  });

  it('TB-P5 serialisation sample: a code of another GTIN, batch or expiry, or a bad serial, is refused', () => {
    const r = c9SerialCodes({ ...i, codes: [code('S1', 'TB260002'), code('S2', 'TB260001', '281130'), code('S3', 'TB260001', '281031', '08901234567906'), code('BAD#1'), `(01)${GTIN}(17)281031(10)TB260001`, 'hello'].join(' ') });
    expect(r).toMatchObject({ check: { pass: false } });
    const shown = (r as { shown: string }).shown;
    expect(shown).toContain('code 1: batch TB260002, not TB260001');
    expect(shown).toContain('code 2: expiry 281130, not 10/2028');
    expect(shown).toContain('code 3: GTIN 08901234567906, not 08901234567890');
    expect(shown).toContain('code 4: serial "BAD#1" is not 1 to 20 GS1 characters');
    expect(shown).toContain('code 5: serial missing');
    expect(shown).toContain('code 6: not a GS1 code');
    expect(c9SerialCodes({ ...i, codes: code('S1'), gtin: '08901234567891' })).toMatchObject({ ok: false });
  });

  it('TB-P5 serialisation sample: the same serial is never read twice in the batch, in one round or in an earlier one', () => {
    expect(c9SerialCodes({ ...i, codes: `${code('S1')} ${code('S1')}` })).toMatchObject({ check: { pass: false, shown: expect.stringContaining('code 2: serial S1 was already read in this batch') } });
    const d = packing({ serialisation: true, gtin: GTIN });
    const s = where(d, 'serial-sample');
    const round1 = [issued(d), ev('started', s.key, { min: 5 }), ev('value', s.key, { min: 6, payload: { values: { codes: `${code('S1')} ${code('S2')}` } } }), ev('done', s.key, { min: 7 })];
    const r2 = `${s.si}.1.${s.ti}.2`;
    expect(results(d, round1, r2, { codes: `${code('S3')} ${code('S2')}`, packingDone: 'no' }).codesCheck).toMatchObject({ check: { pass: false, shown: expect.stringContaining('code 2: serial S2 was already read in this batch') } });
    expect(results(d, round1, r2, { codes: code('S3'), packingDone: 'no' }).codesCheck).toMatchObject({ check: { pass: true } });
  });

  it('TB-P5 serialisation reconciliation: received = printed OK + rejected + destroyed + unused; a gap needs a deviation note', () => {
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
