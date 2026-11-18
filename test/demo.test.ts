import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { asPermissions } from '../server/auth.js';
import { demoSkipCommand, skipWaits } from '../server/demo.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { ownCodes, TABLETS } from '../server/product.js';
import { PACKING } from '../packing/product.js';
import { doneProblems, evaluate, lateItems, openSteps, timers, type StepEvent } from '../shared/engine/index.js';
import { at, ev, pass, reading, small } from './engine-fixture.js';
import { call, fakeSignOn, freshApp, login, proofFor, seedUser, TEST_PROOF_KEY, type TestApp } from './helpers.js';

// Demo installations only (TRUEBATCH_DEMO=1): a skip event satisfies the wait the timers compute, nothing else changes;
// the button, the route and the terminal command are refused anywhere else.

const skip = (key: string, timer: string, min: number) => ev('demo_wait_skipped', key, { min, payload: { timer, label: timer } });
const ids = (doc: ReturnType<typeof small>, events: StepEvent[], now: Date) => openSteps(doc, events, now).steps.map((s) => `${s.id} ${s.state} ${s.blocked ?? ''}`);

describe('the engine: a skip ends the wait at once', () => {
  it('a minimum time skipped is due from the skip: the step can be signed', () => {
    const doc = small([{ steps: [{ minMinutes: 30 }] }]);
    const events = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values: { reading: { value: '6', unit: '' } }, results: { readingCheck: pass as never } } })];
    const done = (e: StepEvent[]) => doneProblems(doc, openSteps(doc, e, at(6)).steps[0]!, at(6));
    expect(done(events)).toEqual([`The minimum time is 30 min: the step can be finished from ${at(30).toISOString()}`]);
    const skipped = [...events, skip('0.1.0.1', 'min:0.1.0.1', 5)];
    expect(timers(doc, skipped, at(6))).toMatchObject([{ id: 'min:0.1.0.1', state: 'due', at: at(5), skipped: { person: 1, at: at(5) } }]);
    expect(done(skipped)).toEqual([]);
    expect(ids(doc, skipped, at(6))).toEqual(ids(doc, events, at(6)));
  });

  it('a periodic check skipped is due now and never late; the rounds are as before', () => {
    const doc = small([{ steps: [{ everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 10, stop: 'readingCheck' } }] }]);
    const r1 = [ev('started', '0.1.0.1', { min: 0 }), reading('0.1.0.1', { readingCheck: { ...pass, check: { pass: false, level: 'fail', shown: '' } } }, { min: 2 }), ev('done', '0.1.0.1', { min: 3 })];
    const skipped = [...r1, skip('0.1.0.1', 'every:0.1.0.2', 10)];
    expect(timers(doc, skipped, at(100))).toMatchObject([{ id: 'every:0.1.0.2', state: 'due', at: at(10) }]);
    expect(ids(doc, skipped, at(11))).toEqual(ids(doc, r1, at(11)));
    const next = (e: StepEvent[]) => timers(doc, [...e, ev('started', '0.1.0.2', { min: 50 })], at(55)).map((t) => `${t.id} ${t.state}`);
    expect(next(r1)).toEqual(['every:0.1.0.2 late', 'every:0.1.0.3 running']);
    expect(next(skipped)).toEqual(['every:0.1.0.3 running']);
  });

  it('a hold time skipped is satisfied: never late, the using stage is not blocked', () => {
    const doc = small([{ produces: { name: 'granules', holdHours: 2 } }, { uses: ['s0'] }]);
    const done = [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 10 })];
    const skipped = [...done, skip('1.1.0.1', 'hold:0:1', 20)];
    expect(timers(doc, skipped, at(300))).toMatchObject([{ id: 'hold:0:1', state: 'due', at: at(20) }]);
    expect(lateItems(doc, skipped, at(300))).toEqual([]);
    expect(openSteps(doc, done, at(300)).steps[1]!.state).toBe('waiting');
    expect(openSteps(doc, skipped, at(300)).steps[1]!.state).toBe('open');
    expect(timers(doc, [...skipped, ev('started', '1.1.0.1', { min: 400 })], at(500))).toEqual([]);
  });

  describe('a mixing time (T13 from a start timer to an end timer) is a wait until its lower limit', () => {
    const mixing = (limit: object) => small([{ steps: [{ block: { id: 'dry-mix', version: 1 }, settings: { mixTimeLimit: limit } }] }]);
    const doc = mixing({ low: '10', high: '30', unit: 'min' });
    const stamp = (min: number) => `${at(min).toISOString().slice(0, 19)}Z`;
    const begun = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values: { mixStart: stamp(1) } } })];
    const id = 'dur:0.1.0.1:mixTime';
    const mixTime = (events: StepEvent[], end: number, d = doc) => evaluate(d, events, { stage: 0, sub: 1, step: 0, round: 1 }, { mixStart: stamp(1), mixEnd: stamp(end) }).mixTime;

    it('runs from the recorded start to the lower limit, then is due; gone once the end is recorded; none without a lower limit', () => {
      const t = (now: number, events = begun, d = doc) => timers(d, events, at(now)).map((x) => `${x.id} ${x.kind} ${x.state} ${x.at.toISOString()}`);
      expect(timers(doc, begun, at(5))).toMatchObject([{ id, kind: 'duration', key: { stage: 0, step: 0 }, label: 'Mixing time of “Dry mix for a time” (at least 10 min)', from: at(1), at: at(11), state: 'running' }]);
      expect([t(10), t(12)]).toEqual([[`${id} duration due soon ${at(11).toISOString()}`], [`${id} duration due ${at(11).toISOString()}`]]);
      expect(t(0, begun.slice(0, 1))).toEqual([]);
      expect(t(12, [...begun, ev('value', '0.1.0.1', { min: 11, payload: { values: { mixEnd: stamp(11) } } })])).toEqual([]);
      expect(t(5, begun, mixing({ high: '30', unit: 'min' }))).toEqual([]);
      expect(timers(mixing({ low: '0.5', high: '2', unit: 'h' }), begun, at(5))).toMatchObject([{ id, at: at(31), label: 'Mixing time of “Dry mix for a time” (at least 0.5 h)' }]);
    });

    it('skipped: due from the skip, and the lower limit counts as met with the real duration shown; the upper limit still applies', () => {
      const skipped = [...begun, skip('0.1.0.1', id, 3)];
      expect(timers(doc, skipped, at(4))).toMatchObject([{ id, state: 'due', at: at(3), skipped: { person: 1, at: at(3) } }]);
      // Without a skip nothing changes: 2 min is below the lower limit.
      expect(mixTime(begun, 3)).toMatchObject({ ok: true, value: '2', check: { pass: false } });
      expect(JSON.stringify(mixTime(begun, 3))).not.toContain('DEMO');
      const short = mixTime(skipped, 3);
      expect(short).toMatchObject({ ok: true, value: '2', shown: expect.stringMatching(/= 2 min · DEMO: wait skipped$/), check: { pass: true, shown: expect.stringMatching(/· DEMO: wait skipped$/) } });
      expect(mixTime(skipped, 41)).toMatchObject({ ok: true, value: '40', check: { pass: false, shown: expect.stringContaining('above the upper limit') } });
      // A lower limit alone: no check is left, the result passes.
      const lowOnly = mixing({ low: '10', unit: 'min' });
      expect(mixTime(skipped, 3, lowOnly)).toMatchObject({ ok: true, value: '2' });
      expect(mixTime(skipped, 3, lowOnly)).not.toHaveProperty('check');
      // A skip of another wait of the step does not touch the mixing time.
      expect(mixTime([...begun, skip('0.1.0.1', 'min:0.1.0.1', 3)], 3)).toMatchObject({ check: { pass: false } });
    });
  });
});

describe('demo skip through the server', () => {
  let t: TestApp;
  let plain: FastifyInstance;
  const cookies: Record<string, string> = {};
  const plainCookies: Record<string, string> = {};
  const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });
  const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
  type Step = { id: string; contentHash: string };
  const step = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: Step[] }).steps.find((s) => s.id === key)!;
  async function issue() {
    const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
    const m = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [{ minMinutes: 30 }, yieldStep] }]) });
    const { id: mv } = m.json() as { id: number };
    for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${mv}`;
    const r = await as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer') });
    const b = r.json() as { id: number; batchNo: string };
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`)).statusCode).toBe(200);
    return b;
  }

  beforeAll(async () => {
    t = await freshApp(undefined, TABLETS, true);
    t.master.products_.push({ ...item('p', 'P', 'P'), strength: null, dosageForm: 'tablet' });
    t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
    const people = { author: ['truebatch.master.author'], issuer: ['truebatch.batch.issue'], asha: ['truebatch.batch.operate', 'truebatch.demo.skip'],
      ravi: ['truebatch.batch.operate'], meera: ['truebatch.qa.release'] } as const;
    for (const [name, perms] of Object.entries(people)) {
      await seedUser(t.owner, name, [...perms]);
      cookies[name] = (await login(t.app, name)).cookie;
    }
    // The same database served by an installation that is not a demo.
    plain = await buildApp({ sql: t.sql, signOn: fakeSignOn(), proofKey: TEST_PROOF_KEY, master: t.master, webRoot: '/nonexistent' });
    plainCookies.asha = (await login(plain, 'asha')).cookie;
  });
  afterAll(async () => { await plain?.close(); await t.close(); });

  it('the person with the demo permission skips the minimum time; the step history, the QA review and the PDF say who and when', async () => {
    const b = await issue();
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/record`, { values: { reading: '6.0' } })).statusCode).toBe(200);
    const done = async () => as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/done`, { proof: proofFor('asha'), contentHash: (await step(b.id, '0.1.0.1')).contentHash });
    expect((await done()).json()).toMatchObject({ error: 'not_ready' });
    const timer = 'min:0.1.0.1';
    expect((await as('ravi', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).statusCode).toBe(403);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).statusCode).toBe(200);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).json()).toMatchObject({ error: 'no_wait' });
    const d = (await as('asha', 'GET', `/api/batches/${b.id}`)).json() as { timers: { id: string; state: string; skipped?: object }[] };
    expect(d.timers).toMatchObject([{ id: timer, state: 'due', skipped: { person: expect.any(Number) } }]);
    const signed = await done();
    expect(signed.statusCode, signed.body).toBe(200);

    const history = (await as('asha', 'GET', `/api/batches/${b.id}/steps/0.1.0.1/events`)).json() as { events: { kind: string; personName: string; payload: { label: string } }[] };
    expect(history.events.map((e) => e.kind)).toEqual(['started', 'value', 'demo_wait_skipped', 'done']);
    expect(history.events[2]).toMatchObject({ personName: 'ASHA', payload: { label: 'Minimum time of “Check a value against limits: pH” (30 min)' } });
    const review = (await as('meera', 'GET', `/api/batches/${b.id}/review`)).json() as { demoSkips: { kind: string; personName: string }[] };
    expect(review.demoSkips).toMatchObject([{ kind: 'demo_wait_skipped', personName: 'ASHA' }]);
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, b.id))!), 'QA'));
    expect(pdf).toMatch(/DEMO: wait skipped by ASHA at \d+ \w+ 2026, \d\d:\d\d IST/);
    // A demo installation's PDF says DEMO in the header and footer of every page; any other's does not.
    const page = (demo: boolean) => { const d = batchRecordDoc({ ...input }, 'QA', new Date(), demo); return JSON.stringify([d.header, typeof d.footer === 'function' ? d.footer(2, 3, { width: 0, height: 0 } as never) : d.footer]); };
    const input = await recordInput(t.sql, (await loadBatch(t.sql, b.id))!);
    expect(page(true)).toMatch(/"text":"DEMO · ".*DEMO installation, not a GMP record/);
    expect(page(false)).not.toContain('DEMO');
    const [a] = await t.owner<{ action: string }[]>`select action from audit_log where action = 'step.demo_wait_skipped' and object_id = ${String(b.id)}`;
    expect(a).toEqual({ action: 'step.demo_wait_skipped' });
  });

  it('the screens know a demo installation; one that is not a demo refuses the skip, and its screens show no DEMO', async () => {
    const b = await issue();
    expect((await as('asha', 'GET', '/api/me')).json()).toMatchObject({ demo: true });
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ demo: true });
    const refused = await call(plain, plainCookies.asha!, 'POST', `/api/batches/${b.id}/demo-skip`, { timer: 'min:0.1.0.1' });
    expect([refused.statusCode, refused.json().error]).toEqual([403, 'not_demo']);
    expect((await call(plain, plainCookies.asha!, 'GET', '/api/me')).json().demo).toBeUndefined();
    expect((await plain.inject({ method: 'GET', url: '/api/health' })).json().demo).toBeUndefined();
    expect(timers((await loadBatch(t.sql, b.id))!.doc, (await loadBatch(t.sql, b.id))!.events, new Date())[0]!.skipped).toBeUndefined();
  });

  it('the terminal command skips every running wait of a batch or a stage as the named person, and is refused when not a demo', async () => {
    const lines: string[] = [];
    expect(await demoSkipCommand(TABLETS, ['TB260001', '--as', 'asha'], {}, (l) => lines.push(l))).toBe(2);
    expect(await demoSkipCommand(PACKING, ['TP260001', '--as', 'asha'], { TRUEBATCH_DEMO: 'yes' }, (l) => lines.push(l))).toBe(2);
    expect(lines).toEqual(['Refused: TrueBatch Tablets here is not a demo installation (TRUEBATCH_DEMO is not 1).',
      'Refused: TrueBatch Tablets Packing here is not a demo installation (TRUEBATCH_DEMO is not 1).']);
    expect(await demoSkipCommand(TABLETS, ['TB260001'], { TRUEBATCH_DEMO: '1' }, () => {})).toBe(1);
    const b = await issue();
    expect(await skipWaits(t.sql, b.batchNo, undefined, 'nobody')).toEqual({ error: 'There is no person nobody here: they sign in once first.' });
    expect(await skipWaits(t.sql, b.batchNo, 'packing', 'asha')).toEqual({ error: `Batch ${b.batchNo} has no stage packing: 1 s0 (Stage 0).` });
    expect(await skipWaits(t.sql, b.batchNo, 'Stage 0', 'asha')).toEqual({ skipped: ['Minimum time of “Check a value against limits: pH” (30 min)'] });
    expect(await skipWaits(t.sql, b.batchNo, undefined, 'asha')).toEqual({ skipped: [] });
  });

  it('a mixing time: skipped by the button or the terminal command, its lower limit counts as met; the result says DEMO', async () => {
    const mix = { key: 'mix', block: { id: 'dry-mix', version: 1 }, checker: false, settings: { mixTimeLimit: { low: '10', high: '30', unit: 'min' } } };
    const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
    const m = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [mix, { ...mix, key: 'mix-2' }, yieldStep] }]) });
    const { id: mv } = m.json() as { id: number };
    for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${mv}`;
    const issue2 = async () => (await as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer') })).json() as { id: number; batchNo: string };
    const b = await issue2();
    const record = (id: number, values: object) => as('asha', 'POST', `/api/batches/${id}/steps/0.1.0.1/record`, { values });
    const timer = 'dur:0.1.0.1:mixTime';
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`)).statusCode).toBe(200);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).json()).toMatchObject({ error: 'no_wait' });
    expect((await record(b.id, { mixStart: 'now' })).statusCode).toBe(200);
    const d = (await as('asha', 'GET', `/api/batches/${b.id}`)).json() as { timers: { id: string; kind: string; state: string; label: string }[] };
    expect(d.timers).toMatchObject([{ id: timer, kind: 'duration', state: 'running', label: 'Mixing time of “Dry mix for a time” (at least 10 min)' }]);
    expect((await as('ravi', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).statusCode).toBe(403);
    expect((await call(plain, plainCookies.asha!, 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).statusCode).toBe(403);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/demo-skip`, { timer })).statusCode).toBe(200);
    expect((await record(b.id, { mixEnd: 'now' })).statusCode).toBe(200);
    type Row = { id: string; values: Record<string, string>; results: Record<string, { value: string; shown: string; check: { pass: boolean } }> };
    const mixed = async (id: number) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: Row[] }).steps.find((s) => s.id === '0.1.0.1')!;
    // The real recorded duration (well under the 10 min) counts as met; nothing recorded is changed.
    const first = await mixed(b.id);
    // Start and end are both "now": 0 s, or 1 s when the clock ticks between the two records (0.0166… min).
    expect(first.results.mixTime).toMatchObject({ shown: expect.stringContaining('· DEMO: wait skipped'), check: { pass: true } });
    expect(Number(first.results.mixTime!.value)).toBeLessThan(0.1);
    expect(first.values.mixEnd).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // The terminal command skips a running mixing time too; without a skip the same short mix is out of limits.
    const [c, e] = [await issue2(), await issue2()];
    for (const x of [c, e]) {
      expect((await as('asha', 'POST', `/api/batches/${x.id}/steps/0.1.0.1/start`)).statusCode).toBe(200);
      expect((await record(x.id, { mixStart: 'now' })).statusCode).toBe(200);
    }
    expect(await skipWaits(t.sql, c.batchNo, undefined, 'asha')).toEqual({ skipped: ['Mixing time of “Dry mix for a time” (at least 10 min)'] });
    for (const x of [c, e]) expect((await record(x.id, { mixEnd: 'now' })).statusCode).toBe(200);
    expect((await mixed(c.id)).results.mixTime).toMatchObject({ check: { pass: true } });
    expect((await mixed(e.id)).results.mixTime).toMatchObject({ check: { pass: false } });
    expect(JSON.stringify((await mixed(e.id)).results.mixTime)).not.toContain('DEMO');
  });

  it('packing has its own demo permission, read as the app\'s', () => {
    expect(asPermissions(ownCodes(PACKING, ['truebatch_packing.demo.skip']))).toEqual(['truebatch.demo.skip']);
  });
});
