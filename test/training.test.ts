import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { link, links, recruitmentClient } from '../server/links.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { loadConfig } from '../server/config.js';
import { trainingCheck, trainingText, trainingTyped, neededText } from '../shared/engine/index.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster } from '../web/src/designer/describe.js';
import { call, freshApp, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { ev, small } from './engine-fixture.js';

// Only trained people sign (owner, 17 Nov 2026): a step that names a training is signed, performed or checked, only by
// a person Recruitment's training_v1 shows qualified in it; while Recruitment is off or down the signer ticks "I am
// trained in …" and the signature is marked for QA. training_v1 is a stand-in table in its own schema, read with
// TrueBatch's restricted login as on the platform.

let t: TestApp;
let provider: Sql;
let schema = '';
const cookies: Record<string, string> = {};
const SKILL = { code: 'SOP-STR-004', title: 'Operating the stirrer' };

beforeAll(async () => {
  t = await freshApp(async (db) => {
    schema = `${db.schema}_rc`;
    await db.owner.unsafe(`
      create schema ${schema};
      create table ${schema}.training_v1 (person_id uuid, person_login text, person_name text, skill_code text, skill_title text, trained_on date,
        valid_until date, qualified boolean, approved_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now());
      grant usage on schema ${schema} to truebatch_app;
      grant select on all tables in schema ${schema} to truebatch_app;
      insert into ${schema}.training_v1 (person_login, person_name, skill_code, skill_title, trained_on, valid_until, qualified) values
        ('asha', 'Asha', 'SOP-STR-004', 'Operating the stirrer', '2026-01-10', '2027-01-09', true),
        ('meera', 'Meera', 'SOP-STR-004', 'Operating the stirrer', '2026-02-01', '2027-01-31', true),
        ('ravi', 'Ravi', 'SOP-STR-004', 'Operating the stirrer', '2024-01-10', '2025-01-09', false),
        ('ravi', 'Ravi', 'SOP-GRN-001', 'Granulation', '2026-01-10', '2027-01-09', true);`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_app', link: true });
    return links({ recruitment: provider }, { recruitment: schema });
  });
  const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
  t.master.products_.push({ ...item('p', 'P', 'P'), strength: null, dosageForm: 'tablet' });
  t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
  const people = { author: ['truebatch.master.author'], issuer: ['truebatch.batch.issue'], asha: ['truebatch.batch.operate', 'truebatch.batch.check'],
    ravi: ['truebatch.batch.check'], kiran: ['truebatch.batch.check'], meera: ['truebatch.batch.check', 'truebatch.batch.operate'], qaperson: ['truebatch.qa.release'] } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => {
  await provider?.end();
  if (schema) await t.owner.unsafe(`drop schema if exists ${schema} cascade`);
  await t?.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const act = (who: string, id: number, key: string, action: string, body: object = {}) => as(who, 'POST', `/api/batches/${id}/steps/${key}/${action}`, body);
const hashOf = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: { id: string; contentHash: string }[] }).steps.find((s) => s.id === key)!.contentHash;
const sign = async (who: string, id: number, action: 'done' | 'check', extra: object = {}) =>
  act(who, id, '0.1.0.1', action, { proof: proofFor(who), contentHash: await hashOf(id, '0.1.0.1'), ...extra });
const cut = () => t.owner.unsafe(`revoke select on all tables in schema ${schema} from truebatch_app`);
const restore = () => t.owner.unsafe(`grant select on all tables in schema ${schema} to truebatch_app`);
/** A batch of one check step that names the training, recorded and ready to sign. */
async function batch(training: object | null = SKILL) {
  const doc = small([{ steps: [{ checker: true, ...(training ? { training } : {}) },
    { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]);
  const res = await as('author', 'POST', '/api/masters', { doc });
  expect(res.statusCode, res.body).toBe(200);
  const { id: mv } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${mv}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  const { id } = b.json() as { id: number };
  expect((await act('asha', id, '0.1.0.1', 'start')).statusCode).toBe(200);
  expect((await act('asha', id, '0.1.0.1', 'record', { values: { reading: '6.0' } })).statusCode).toBe(200);
  return id;
}
const eventsOf = async (id: number) => (await loadBatch(t.sql, id))!.events;

describe('the training a step needs, in the master', () => {
  it('TB-23 a step may name a training (code and title); none by default, so existing masters do not change', () => {
    expect(small([{}]).stages[0]!.steps[0]!.training).toBeUndefined();
    const d = small([{ steps: [{ checker: true, training: SKILL }] }]);
    expect(d.stages[0]!.steps[0]!.training).toEqual(SKILL);
    expect(masterSchema.safeParse({ ...d, stages: [{ ...d.stages[0], steps: [{ ...d.stages[0]!.steps[0], training: { code: '' } }] }] }).success).toBe(false);
  });

  it('TB-23 the plain view says who may sign it: "Done by a person trained in SOP-STR-004 …"', () => {
    const lines = describeMaster(small([{ steps: [{ checker: true, training: SKILL }, {}] }])).flatMap((s) => s.lines.map((l) => l.text));
    expect(lines.find((l) => l.startsWith('1.'))).toContain('Done by a person trained in SOP-STR-004 Operating the stirrer; checked by a person trained in it too (Recruitment).');
    expect(lines.find((l) => l.startsWith('2.'))).not.toContain('trained');
    expect(neededText({ code: 'SOP-X' }, false)).toBe('Done by a person trained in SOP-X (Recruitment).');
  });

  it('TB-23 the designer picks the skill from those Recruitment publishes (each once); none while the link is off or down', async () => {
    expect((await as('author', 'GET', '/api/recruitment/skills')).json()).toEqual({ link: 'ok', skills: [{ code: 'SOP-GRN-001', title: 'Granulation' }, SKILL] });
    await cut();
    try {
      expect((await as('author', 'GET', '/api/recruitment/skills')).json()).toEqual({ link: 'down', skills: [] });
    } finally { await restore(); }
    expect(await recruitmentClient(link('recruitment', null)).skills()).toEqual({ state: 'absent' });
  });

  it('TB-23 the link is RECRUITMENT_DATABASE_URL, by the platform\'s <PROVIDER>_DATABASE_URL convention; unset, it is off', () => {
    const base = { DATABASE_URL: 'postgres://a@h/d', MASTER_DATA_DATABASE_URL: 'postgres://a@h/m', OIDC_ISSUER: 'https://core.example', OIDC_CLIENT_SECRET: 'x', OIDC_REDIRECT_URI: 'https://tb.example/cb' };
    expect(loadConfig({ ...base, RECRUITMENT_DATABASE_URL: 'postgres://tb@h/recruitment' }).RECRUITMENT_DATABASE_URL).toBe('postgres://tb@h/recruitment');
    expect(loadConfig({ ...base, RECRUITMENT_DATABASE_URL: '' }).RECRUITMENT_DATABASE_URL).toBeUndefined();
  });
});

describe('signing a step that names a training', () => {
  it('TB-23 qualified: the signature records the training as Recruitment has it (pulled), with the signed content', async () => {
    const id = await batch();
    const before = (await as('asha', 'GET', `/api/batches/${id}/steps/0.1.0.1/training`)).json() as { link: string; ok: boolean; training: object };
    expect(before).toMatchObject({ link: 'ok', ok: true, training: { code: 'SOP-STR-004', from: 'recruitment', validUntil: '2027-01-09' } });
    expect((await sign('asha', id, 'done')).statusCode).toBe(200);
    const done = (await eventsOf(id)).find((e) => e.kind === 'done')!;
    expect(done.payload.training).toMatchObject({ code: 'SOP-STR-004', title: 'Operating the stirrer', from: 'recruitment', trainedOn: '2026-01-10', validUntil: '2027-01-09' });
    expect(trainingText(done.payload.training as never)).toBe('trained: SOP-STR-004 Operating the stirrer, valid until 9 Jan 2027 (Recruitment)');
    const [audit] = await t.owner<{ new_value: { training?: object } }[]>`select new_value from audit_log where action = 'step.done' and object_id = ${id}`;
    expect(audit!.new_value.training).toMatchObject({ code: 'SOP-STR-004' });
  });

  it('TB-23 expired or missing: the signature is refused in plain words, and another trained person signs', async () => {
    const id = await batch();
    expect((await sign('asha', id, 'done')).statusCode).toBe(200);
    // ravi's training expired (qualified false); kiran has none.
    const expired = await sign('ravi', id, 'check');
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ error: 'not_trained', problems: ['RAVI has no valid training in SOP-STR-004 Operating the stirrer (Recruitment): ask QA, or another trained person signs.'] });
    expect(((await as('kiran', 'GET', `/api/batches/${id}/steps/0.1.0.1/training`)).json() as { ok: boolean; message: string }))
      .toMatchObject({ ok: false, message: 'KIRAN has no valid training in SOP-STR-004 Operating the stirrer (Recruitment): ask QA, or another trained person signs.' });
    expect((await sign('kiran', id, 'check')).json()).toMatchObject({ error: 'not_trained' });
    // A tick does not overrule Recruitment while it answers.
    expect((await sign('kiran', id, 'check', { trained: true })).json()).toMatchObject({ error: 'not_trained' });
    expect((await eventsOf(id)).filter((e) => e.kind === 'checked')).toHaveLength(0);
    expect((await sign('meera', id, 'check')).statusCode).toBe(200);
    expect((await eventsOf(id)).find((e) => e.kind === 'checked')!.payload.training).toMatchObject({ from: 'recruitment', validUntil: '2027-01-31' });
  });

  it('TB-23 Recruitment down: the signer ticks "I am trained in …"; the signature says training typed by hand, for QA', async () => {
    const id = await batch();
    await cut();
    try {
      expect((await as('kiran', 'GET', `/api/batches/${id}/steps/0.1.0.1/training`)).json()).toMatchObject({ link: 'down', ok: false });
      const unticked = await sign('asha', id, 'done');
      expect(unticked.statusCode).toBe(409);
      expect(unticked.json()).toMatchObject({ error: 'training_tick', problems: ['Recruitment cannot be reached: tick “I am trained in SOP-STR-004 Operating the stirrer” to sign, or another trained person signs.'] });
      expect((await sign('asha', id, 'done', { trained: true })).statusCode).toBe(200);
      // Not trained in Recruitment, but it cannot say so now: the tick is the person's word, marked for QA.
      expect((await sign('kiran', id, 'check', { trained: true })).statusCode).toBe(200);
    } finally { await restore(); }
    const events = await eventsOf(id);
    expect(events.find((e) => e.kind === 'done')!.payload.training).toEqual({ ...SKILL, from: 'hand', state: 'down' });
    expect(trainingTyped(events).map((x) => [x.kind, x.code, x.state])).toEqual([['done', 'SOP-STR-004', 'down'], ['checked', 'SOP-STR-004', 'down']]);
    const r = (await as('qaperson', 'GET', `/api/batches/${id}/review`)).json() as { trainingTyped: { kind: string; personName: string; code: string }[] };
    expect(r.trainingTyped.map((x) => [x.kind, x.personName, x.code])).toEqual([['done', 'ASHA', 'SOP-STR-004'], ['checked', 'KIRAN', 'SOP-STR-004']]);
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!), 'QA'));
    expect(pdf).toContain('Training typed by hand (Recruitment not reachable)');
    expect(pdf).toContain('TRAINING TYPED BY HAND (RECRUITMENT NOT REACHABLE): SOP-STR-004 OPERATING THE STIRRER');
    expect(pdf).toContain('SOP-STR-004 Operating the stirrer: ticked \\"I am trained\\", Recruitment link down');
  });

  it('TB-23 Recruitment not linked (absent): the same tick, marked "not linked"', async () => {
    const id = await batch();
    const was = t.app.links.recruitment;
    t.app.links.recruitment = recruitmentClient(link('recruitment', null));
    try {
      expect((await as('asha', 'GET', `/api/batches/${id}/steps/0.1.0.1/training`)).json()).toMatchObject({ link: 'absent', ok: false });
      expect((await sign('asha', id, 'done')).json()).toMatchObject({ error: 'training_tick' });
      expect((await sign('asha', id, 'done', { trained: true })).statusCode).toBe(200);
    } finally { t.app.links.recruitment = was; }
    expect((await eventsOf(id)).find((e) => e.kind === 'done')!.payload.training).toEqual({ ...SKILL, from: 'hand', state: 'absent' });
  });

  it('TB-23 a step without a training signs as before: nothing read, nothing recorded; the PDF has no training section', async () => {
    const id = await batch(null);
    expect((await as('kiran', 'GET', `/api/batches/${id}/steps/0.1.0.1/training`)).json()).toEqual({ skill: null });
    expect((await sign('asha', id, 'done')).statusCode).toBe(200);
    expect((await eventsOf(id)).find((e) => e.kind === 'done')!.payload.training).toBeUndefined();
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!), 'QA'));
    expect(pdf).not.toContain('Training typed by hand');
  });

  it('TB-23 the sign check, as a rule: qualified passes; not qualified or no row is refused; off or down needs the tick', () => {
    const row = { code: 'S', title: 'Skill', qualified: true, trainedOn: '2026-01-01', validUntil: '2027-01-01', dataAsOf: null };
    expect(trainingCheck({ code: 'S' }, 'A', { state: 'ok', value: row }, false)).toMatchObject({ ok: true, training: { from: 'recruitment', title: 'Skill' } });
    expect(trainingCheck({ code: 'S' }, 'A', { state: 'ok', value: { ...row, qualified: false } }, true)).toMatchObject({ ok: false, error: 'not_trained' });
    expect(trainingCheck({ code: 'S' }, 'A', { state: 'ok', value: null }, true)).toMatchObject({ ok: false, error: 'not_trained', message: 'A has no valid training in S (Recruitment): ask QA, or another trained person signs.' });
    expect(trainingCheck({ code: 'S' }, 'A', { state: 'down' }, false)).toMatchObject({ ok: false, error: 'training_tick' });
    expect(trainingCheck({ code: 'S' }, 'A', { state: 'absent' }, true)).toEqual({ ok: true, training: { code: 'S', from: 'hand', state: 'absent' } });
    expect(trainingTyped([ev('done', '0.1.0.1', { payload: { training: { code: 'S', from: 'recruitment' } } })])).toEqual([]);
  });
});
