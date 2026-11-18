import { describe, expect, it } from 'vitest';
import {
  batchRefusal, batchView, cutShort, evaluate, notYetText, openSteps, review,
  type BatchAction, type BatchEvent, type BatchEventKind, type StepEvent,
} from '../shared/engine/index.js';
import { at, ev, fail, pass, reading, small } from './engine-fixture.js';
import { batchRecordDoc } from '../server/batch-record.js';

// The batch status and its signatures (TB-20, TB-21), computed from step events and batch events.

let n = 1000;
const be = (kind: BatchEventKind, payload: BatchEvent['payload'] = {}): BatchEvent => ({ id: n++, kind, payload, person: 5, at: at(900) });
const people = {
  supervisor: { permissions: ['truebatch.batch.supervise'] },
  qc: { permissions: ['truebatch.qc.approve'] },
  qa: { permissions: ['truebatch.qa.release'] },
  operator: { permissions: ['truebatch.batch.operate'] },
};
type Who = keyof typeof people;

// One checked step and one optional step marked not applicable.
const doc = small([{ steps: [{ checker: true }, { flow: { kind: 'optional-with-reason' } }] }]);
const started = [ev('started', '0.1.0.1', { min: 1 }), ev('done', '0.1.0.1', { min: 2 })];
const complete = [...started, ev('checked', '0.1.0.1', { person: 2, min: 3 }), ev('not_applicable', '0.1.1.1', { min: 4, payload: { reason: 'Not needed' } })];
const deviation = ev('note', '0.1.0.1', { min: 5, payload: { text: 'pH re-measured', reference: 'DEV-26-001' } });
const close = be('deviation_closed', { note: deviation.id, reason: 'Investigation closed' });
const approved = [be('production_approved'), be('qc_approved', { reportNo: 'QC-26-0042' })];
const view = (events: StepEvent[], batch: BatchEvent[] = [], d = doc) => batchView(d, events, batch, at(1000));

describe('the batch status', () => {
  it.each<[string, StepEvent[], BatchEvent[], string]>([
    ['nothing done', [], [], 'in production'],
    ['a step waits for its check', started, [], 'in production'],
    ['every step done, checked or not applicable', complete, [], 'manufacturing complete'],
    ['a correction after the check', [...complete, ev('corrected', '0.1.0.1', { min: 6, payload: { values: {}, reason: 'x' } })], [], 'in production'],
    ['production approved', complete, approved.slice(0, 1), 'production approved'],
    ['QC approved', complete, approved, 'QC approved'],
    ['released', complete, [...approved, be('released')], 'released'],
    ['rejected', complete, [...approved, be('rejected', { reason: 'Out of specification' })], 'rejected'],
  ])('%s → %s', (_what, events, batch, status) => {
    expect(view(events, batch).status).toBe(status);
  });
});

describe('batch signatures', () => {
  const refused = (a: BatchAction, who: Who, events: StepEvent[], batch: BatchEvent[] = [], note?: number) =>
    batchRefusal(a, view(events, batch), people[who], note);
  it.each<[string, BatchAction, Who, StepEvent[], BatchEvent[], string | null]>([
    ['TB-20 production approval while a check is open', 'production-approve', 'supervisor', started, [], 'Stage 0 › Check a value against limits: pH is waiting for its check'],
    ['TB-20 production approval of a step that needs signing again', 'production-approve', 'supervisor',
      [...complete, ev('corrected', '0.1.0.1', { min: 6, payload: { values: {}, reason: 'x' } })], [], 'Stage 0 › Check a value against limits: pH needs signing again'],
    ['TB-20 production approval without batch.supervise', 'production-approve', 'operator', complete, [], 'You do not have the permission for this action.'],
    ['TB-20 production approval of a complete record', 'production-approve', 'supervisor', complete, [], null],
    ['TB-20 production approval twice', 'production-approve', 'supervisor', complete, approved.slice(0, 1), 'Not possible while the batch is production approved.'],
    ['TB-21 QC approval before production approval', 'qc-approve', 'qc', complete, [], 'Not possible while the batch is manufacturing complete.'],
    ['TB-21 QC approval after production approval', 'qc-approve', 'qc', complete, approved.slice(0, 1), null],
    ['TB-21 QC approval while a linked deviation is open', 'qc-approve', 'qc', [...complete, deviation], approved.slice(0, 1), null],
    ['TB-21 release before QC approval', 'release', 'qa', complete, approved.slice(0, 1), 'Not possible while the batch is production approved.'],
    ['TB-21 release without qa.release', 'release', 'qc', complete, approved, 'You do not have the permission for this action.'],
    ['TB-21 release after QC approval', 'release', 'qa', complete, approved, null],
    ['TB-21 release while a linked deviation is open', 'release', 'qa', [...complete, deviation], approved, 'Deviation DEV-26-001 (Stage 0 › Check a value against limits: pH) is open'],
    ['TB-21 rejection while a linked deviation is open', 'reject', 'qa', [...complete, deviation], approved, 'Deviation DEV-26-001 (Stage 0 › Check a value against limits: pH) is open'],
    ['TB-21 release once the deviation is closed', 'release', 'qa', [...complete, deviation], [...approved, close], null],
    ['TB-21 release after rejection', 'release', 'qa', complete, [...approved, be('rejected')], 'Not possible while the batch is rejected.'],
    ['TB-21 QA terminates a batch in production', 'terminate', 'qa', started, [], null],
    ['TB-21 QA terminates a complete batch with an open deviation', 'terminate', 'qa', [...complete, deviation], [], null],
    ['TB-21 termination after production approval', 'terminate', 'qa', complete, approved.slice(0, 1), 'Not possible while the batch is production approved: QA decides at release.'],
    ['TB-21 termination without qa.release', 'terminate', 'supervisor', started, [], 'You do not have the permission for this action.'],
    ['TB-21 termination of a released batch', 'terminate', 'qa', complete, [...approved, be('released')], 'The batch is released.'],
    ['TB-21 termination of a rejected batch', 'terminate', 'qa', complete, [...approved, be('rejected')], 'The batch is rejected.'],
    ['TB-21 production approval after termination', 'production-approve', 'supervisor', complete, [be('rejected', { terminated: true, reason: 'x' })], 'Not possible while the batch is rejected.'],
  ])('%s → %s', (_what, action, who, events, batch, want) => {
    expect(refused(action, who, events, batch)?.problems[0] ?? null).toBe(want);
  });

  it.each<[string, BatchEvent[], number, string | null]>([
    ['an open deviation note', [], deviation.id, null],
    ['a note closed already', [close], deviation.id, 'There is no open deviation note with this number.'],
    ['a step event that is not a deviation note', [], complete[0]!.id, 'There is no open deviation note with this number.'],
    ['after release', [...approved, be('released')], deviation.id, 'The batch is released.'],
  ])('TB-21 QA closes %s with a reason → %s', (_what, batch, note, want) => {
    expect(refused('close-deviation', 'qa', [...complete, deviation], batch, note)?.problems[0] ?? null).toBe(want);
  });

  it('TB-04 production approval is refused while a check made late has no deviation note', () => {
    const d = small([{ steps: [{ everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' } }] }]);
    const r = (round: number, start: number, pass: boolean) => [ev('started', `0.1.0.${round}`, { min: start }),
      ev('value', `0.1.0.${round}`, { min: start + 1, payload: { values: {}, results: evaluate(d, [], { stage: 0, sub: 1, step: 0, round }, { reading: { value: pass ? '6.0' : '8.0', unit: '' } }) } }),
      ev('done', `0.1.0.${round}`, { min: start + 2 })];
    // Round 1 out of limits, round 2 started at 40 min: 10 minutes late.
    const events = [...r(1, 0, false), ...r(2, 40, true)];
    const v = view(events, [], d);
    expect(v.status).toBe('manufacturing complete');
    expect(batchRefusal('production-approve', v, people.supervisor)?.problems).toEqual(['Check 2 of “Check a value against limits: pH” (every 30 min) ran over: a deviation note is needed']);
    const noted = view([...events, ev('note', '0.1.0.2', { min: 45, payload: { text: 'Press stopped for a jam' } })], [], d);
    expect(batchRefusal('production-approve', noted, people.supervisor)).toBeNull();
  });

  it('TB-18 a yield out of limits blocks release until a linked deviation is raised and closed; rejection stays possible', () => {
    const d = small([{ steps: [{ block: { id: 'stage-yield', version: 1 }, settings: { theoretical: '10.000 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]);
    const values = { output: { value: '9.000', unit: 'kg' }, samples: { value: '0.100', unit: 'kg' }, rejects: { value: '0.100', unit: 'kg' } };
    const results = evaluate(d, [], { stage: 0, sub: 1, step: 0, round: 1 }, values);
    expect(results.yield).toMatchObject({ value: '90', check: { pass: false } });
    const events = [ev('started', '0.1.0.1'), ev('value', '0.1.0.1', { payload: { values, results } }), ev('note', '0.1.0.1', { payload: { text: 'Spillage' } }), ev('done', '0.1.0.1')];
    expect(batchRefusal('release', view(events, approved, d), people.qa)?.problems).toEqual(['The yield of Stage 0 › Stage yield is out of limits: a deviation note with its reference is needed']);
    expect(batchRefusal('reject', view(events, approved, d), people.qa)).toBeNull();
    const dev = ev('note', '0.1.0.1', { payload: { text: 'Spillage at discharge', reference: 'DEV-26-007' } });
    expect(batchRefusal('release', view([...events, dev], approved, d), people.qa)?.problems).toEqual(['Deviation DEV-26-007 (Stage 0 › Stage yield) is open']);
    const closed = [...approved, be('deviation_closed', { note: dev.id, reason: 'Root cause found; yield accepted' })];
    expect(batchRefusal('release', view([...events, dev], closed, d), people.qa)).toBeNull();
  });
});

describe('the review list for QA', () => {
  it('TB-21 lists corrections, sent-backs, values out of limits with their notes, deviations with status and steps not applicable', () => {
    const value = (v: string, pass: boolean) => ({ values: { reading: { value: v, unit: '' } }, results: { readingCheck: { ok: true as const, value: v, unit: '', shown: `${v} …`, check: { pass, level: pass ? 'pass' : 'fail', shown: '' } } } });
    const events = [
      ev('started', '0.1.0.1'), ev('value', '0.1.0.1', { payload: value('6.1', true) }), ev('done', '0.1.0.1'),
      ev('sent_back', '0.1.0.1', { person: 2, payload: { reason: 'Reading looks wrong' } }),
      ev('corrected', '0.1.0.1', { payload: { ...value('7.5', false), reason: 'Re-read the meter' } }), deviation, ev('done', '0.1.0.1'),
      ev('not_applicable', '0.1.1.1', { payload: { reason: 'Not needed' } }),
    ];
    const r = review(doc, events, [close], at(1000));
    expect(r.corrections).toMatchObject([{ step: '0.1.0.1', field: 'reading', was: { value: '6.1' }, now: { value: '7.5' }, reason: 'Re-read the meter' }]);
    expect(r.sentBack).toMatchObject([{ payload: { reason: 'Reading looks wrong' }, person: 2 }]);
    expect(r.outOfLimits).toMatchObject([{ step: '0.1.0.1', calc: 'readingCheck', shown: '7.5 …', notes: [{ payload: { reference: 'DEV-26-001' } }] }]);
    expect(r.deviations).toMatchObject([{ reference: 'DEV-26-001', open: false, closed: { payload: { reason: 'Investigation closed' } } }]);
    expect(r.notApplicable).toMatchObject([{ step: 1, payload: { reason: 'Not needed' } }]);
    expect(r.late).toEqual([]);
  });

  it('TB-14 a repeat-until round whose stop check is "not yet" is not out of limits; the last allowed round failing is', () => {
    const d = small([{ steps: [{ flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' } }] }]);
    const round = (r: number, ok: boolean) => [ev('started', `0.1.0.${r}`), reading(`0.1.0.${r}`, { readingCheck: ok ? pass : fail }), ev('done', `0.1.0.${r}`)];
    const dried = [...round(1, false), ...round(2, true)];
    expect(review(d, dried, [], at(1000)).outOfLimits).toEqual([]);
    expect(batchView(d, dried, [], at(1000)).open).toEqual([]);
    const never = [...round(1, false), ...round(2, false), ...round(3, false)];
    expect(review(d, never, [], at(1000)).outOfLimits.map((o) => o.step)).toEqual(['0.1.0.3']);
    expect(notYetText('2.150 % rounded to 1 decimal = 2.2 %; limit 2.5 to 3.5 %: OUT OF LIMITS (below the lower limit)')).toBe('2.150 % rounded to 1 decimal = 2.2 %; limit 2.5 to 3.5 %: not reached yet, the rounds go on');
    expect(notYetText('Compression finished: no: FAIL')).toBe('Compression finished: no: not yet, the rounds go on');
    // A terminated batch: the rounds do not go on (owner, 16 Nov 2026).
    expect(notYetText('limit 2.5 to 3.5 %: OUT OF LIMITS (below the lower limit)', true)).toBe('limit 2.5 to 3.5 %: not reached (terminated)');
    expect(notYetText('Compression finished: no: FAIL', true)).toBe('Compression finished: no: not reached (terminated)');
  });

  it('TB-14 a terminated batch: only the last round left unfinished reads "not reached (terminated)"; an earlier round followed by another went on (owner, 16 Nov 2026)', () => {
    const d = small([{ steps: [{ flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' } }] }]);
    const notPassed = { ...fail, shown: 'pH = 9: FAIL' };
    // Round 1 did not pass and round 2 followed; round 2 was started and did not pass when QA terminated the batch.
    const events = [ev('started', '0.1.0.1'), reading('0.1.0.1', { readingCheck: notPassed }), ev('done', '0.1.0.1'), ev('started', '0.1.0.2'), reading('0.1.0.2', { readingCheck: notPassed })];
    const { steps } = openSteps(d, events, at(1000));
    expect(steps.map((v) => [v.id, v.notYet, cutShort(true, v, steps), cutShort(false, v, steps)])).toEqual([['0.1.0.1', 'readingCheck', false, false], ['0.1.0.2', 'readingCheck', true, false]]);
    const record = (batchEvents: BatchEvent[]) => JSON.stringify(batchRecordDoc({ batch: { id: 1, batchNo: 'TB260099', masterVersionId: 1, issuedBy: 1, issuedAt: at(0) }, doc: d,
      events: events.map((e) => ({ ...e, personName: 'RAMESH' })), batchEvents: batchEvents.map((b) => ({ ...b, personName: 'MEERA' })), now: at(1000), versionNo: 1, issuedByName: 'SUPER', signatures: [] }, 'QA'));
    const ended = record([be('rejected', { terminated: true, reason: 'The dryer broke down' })]);
    expect(ended.match(/pH = 9: not yet, the rounds go on/g)).toHaveLength(1);
    expect(ended.match(/NOT YET: the rounds go on/g)).toHaveLength(1);
    expect(ended.match(/pH = 9: not reached \(terminated\)/g)).toHaveLength(1);
    expect(ended.match(/NOT REACHED: terminated/g)).toHaveLength(1);
    expect(ended.indexOf('the rounds go on')).toBeLessThan(ended.indexOf('not reached (terminated)'));
    // In production both rounds read as before.
    const live = record([]);
    expect(live.match(/NOT YET: the rounds go on/g)).toHaveLength(2);
    expect(live).not.toContain('terminated');
    // Round 2 signed done without passing, round 3 opened but never started, then terminated: round 2 was cut short.
    const events3 = [...events, ev('done', '0.1.0.2')];
    const { steps: steps3 } = openSteps(d, events3, at(1000));
    const r3 = steps3.find((v) => v.id === '0.1.0.3');
    expect(r3 && ['waiting', 'open'].includes(r3.state)).toBe(true);
    expect(steps3.filter((v) => v.id !== '0.1.0.3').map((v) => [v.id, cutShort(true, v, steps3)])).toEqual([['0.1.0.1', false], ['0.1.0.2', true]]);
  });
});
