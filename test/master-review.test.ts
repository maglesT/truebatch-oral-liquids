import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshApp, login, proofFor, seedUser, type TestApp } from './helpers.js';
import { tablet, placed } from './engine-fixture.js';

// Review and approval of master versions (TB-02): the author sends for review (signs "prepared"), a second person
// checks ("checked") or returns, QA approves ("approved") with a change control number, and making a version
// effective retires the previous one.

let t: TestApp;
const cookies: Record<string, string> = {};
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });

beforeAll(async () => {
  t = await freshApp();
  t.master.products_.push({ ...item('prd-1', 'PRD-001', 'Examplol 100 mg film-coated tablets'), strength: '100 mg', dosageForm: 'tablet' });
  for (const l of tablet().formula) t.master.materials_.push({ ...item(l.materialItemId, l.code, l.name), category: null, unit: 'kg' });
  const people = {
    author: ['truebatch.master.author'], author2: ['truebatch.master.author', 'truebatch.master.check'],
    checker: ['truebatch.master.check'], quality: ['truebatch.master.approve'], qachecker: ['truebatch.master.approve', 'truebatch.master.check'],
    viewer: ['truebatch.view'],
  } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(() => t.close());

const as = (who: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: object) => call(t.app, cookies[who]!, method as 'GET', url, body);
const review = async (id: number, who = 'viewer') => (await as(who, 'GET', `/api/master-versions/${id}/review`)).json() as {
  contentHash: string; actions: string[]; refusals: Record<string, string | null>; events: { kind: string; payload: Record<string, string> }[];
  comments: { text: string; personName: string }[]; previous: { versionNo: number } | null;
};
const state = async (id: number) => ((await as('viewer', 'GET', `/api/master-versions/${id}`)).json() as { state: string }).state;
const act = async (who: string, id: number, action: string, extra: object = {}) =>
  as(who, 'POST', `/api/master-versions/${id}/${action}`, { proof: proofFor(who), contentHash: (await review(id, who)).contentHash, ...extra });
const draft = async (doc = placed(tablet())) => ((await as('author', 'POST', '/api/masters', { doc })).json() as { id: number; masterId: number });
async function approved(doc = placed(tablet())) {
  const v = await draft(doc);
  expect((await act('author', v.id, 'submit')).statusCode).toBe(200);
  expect((await act('checker', v.id, 'pass')).statusCode).toBe(200);
  expect((await act('quality', v.id, 'approve', { changeControl: 'CC-2026-001' })).statusCode).toBe(200);
  return v;
}

describe('master review and approval', () => {
  it('TB-01 a version with master-check errors cannot be sent for review', async () => {
    const doc = placed(tablet());
    doc.formula[0]!.mgPerTablet = '90.0';
    const { id } = await draft(doc);
    expect((await review(id, 'author')).refusals.submit).toMatch(/master check shows 1 problem/);
    const res = await act('author', id, 'submit');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('master_has_errors');
    expect(await state(id)).toBe('draft');
  });

  it('TB-01 a limit written through the API in a unit of another kind than its value: saved as a draft, refused by the check, not sent for review', async () => {
    const doc = placed(tablet());
    const compress = doc.stages[2]!.steps.find((t) => t.key === 'compress')!;
    compress.settings.meanLimit = { low: '245.0', high: '255.0', unit: 'min' };
    const { id } = await draft(doc);
    const checks = (await as('author', 'GET', `/api/master-versions/${id}/checks`)).json() as { problems: { level: string; rule?: string; path: string; message: string }[] };
    expect(checks.problems).toEqual([{ level: 'error', rule: 'TB-01', path: 'stages[2].steps[1].settings.meanLimit', message: expect.stringMatching(/^Mean weight limits: min is a time, but the value checked is a mass/) }]);
    expect((await act('author', id, 'submit')).json().error).toBe('master_has_errors');
    // The same limit in a unit of the right kind is accepted.
    compress.settings.meanLimit = { low: '0.245', high: '0.255', unit: 'g' };
    expect((await as('author', 'PUT', `/api/master-versions/${id}`, { doc })).statusCode).toBe(200);
    expect(((await as('author', 'GET', `/api/master-versions/${id}/checks`)).json() as { problems: unknown[] }).problems).toEqual([]);
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
  });

  it('calculation checks: a warning that needs an answer blocks "Send for review" until the author answers it in the master', async () => {
    const doc = placed(tablet());
    doc.formula[4]!.adjust = { content: { formulaQuantityIs: 'dry', contentSource: 'in-process result', resultType: 'content' } };
    const { id } = await draft(doc);
    const checks = (await as('author', 'GET', `/api/master-versions/${id}/checks`)).json() as { problems: { message: string; question?: { key: string } }[] };
    const q = checks.problems.find((p) => p.question?.key === 'double-adjustment/mcc')!;
    expect(q.message).toMatch(/corrected twice/);
    expect((await review(id, 'author')).refusals.submit).toBe('The master check shows 1 problem to fix or answer first (TB-01).');
    expect((await act('author', id, 'submit')).json().error).toBe('master_has_errors');
    // The answer is saved with the draft, kept in the master document and signed with it.
    const answered = { ...doc, answers: { 'double-adjustment/mcc': { about: q.message, choice: 'intended', reason: 'Blend assay sets the tablet weight; dispensing uses the nominal potency' } } };
    expect((await as('author', 'PUT', `/api/master-versions/${id}`, { doc: answered })).statusCode).toBe(200);
    expect((await review(id, 'author')).refusals.submit).toBeNull();
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    const saved = (await as('checker', 'GET', `/api/master-versions/${id}`)).json() as { doc: { answers: Record<string, { choice: string }> } };
    expect(saved.doc.answers['double-adjustment/mcc']!.choice).toBe('intended');
  });

  it('TB-02 the author cannot check their own version; a second person checks it', async () => {
    const { id } = await draft();
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    expect(await state(id)).toBe('in_review');
    // The version is locked while in review.
    expect((await as('author', 'PUT', `/api/master-versions/${id}`, { doc: placed(tablet()) })).statusCode).toBe(409);
    expect((await review(id, 'checker')).actions).toEqual(['pass', 'return']);
    expect((await act('checker', id, 'pass')).statusCode).toBe(200);
    expect((await act('qachecker', id, 'pass')).json().error).toBe('already_checked');
    const sigs = await t.owner`select s.meaning, s.printed_name from signatures s join master_events e on e.id = s.object_id
      where s.object_type = 'master_event' and e.version_id = ${id} order by s.id`;
    expect(sigs.map((s) => `${s.meaning} ${s.printed_name}`)).toEqual(['prepared AUTHOR', 'checked CHECKER']);
  });

  it('TB-02 an author who edited a version cannot check it', async () => {
    const { id } = await draft();
    expect((await as('author2', 'PUT', `/api/master-versions/${id}`, { doc: placed(tablet()) })).statusCode).toBe(200);
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    expect((await act('author2', id, 'pass')).json().error).toBe('author_cannot_check');
  });

  it('TB-02 only QA approves, and only a version a second person has checked', async () => {
    const { id } = await draft();
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    expect((await act('quality', id, 'approve', { changeControl: 'CC-1' })).json().error).toBe('not_checked');
    expect((await act('checker', id, 'pass')).statusCode).toBe(200);
    expect((await act('checker', id, 'approve', { changeControl: 'CC-1' })).statusCode).toBe(403);
    expect((await act('quality', id, 'approve', { changeControl: 'CC-1' })).statusCode).toBe(200);
    expect(await state(id)).toBe('approved');
  });

  it('TB-02 QA who checked the version cannot also approve it', async () => {
    const { id } = await draft();
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    expect((await act('qachecker', id, 'pass')).statusCode).toBe(200);
    expect((await act('qachecker', id, 'approve', { changeControl: 'CC-1' })).json().error).toBe('author_cannot_approve');
  });

  it('TB-02 approval needs a change control number (route and database)', async () => {
    const { id } = await draft();
    await act('author', id, 'submit');
    await act('checker', id, 'pass');
    const res = await act('quality', id, 'approve', { changeControl: '  ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().problems.join()).toMatch(/change control number is required/);
    const qa = (await t.owner<{ id: number }[]>`select id::int from users where username = 'quality'`)[0]!.id;
    const db = await t.owner`insert into master_events (version_id, kind, person_id) values (${id}, 'approved', ${qa})`.then(() => 'ok', (e: { code?: string }) => e.code);
    expect(db).toBe('23514');
    expect((await act('quality', id, 'approve', { changeControl: 'CC-2026-014' })).statusCode).toBe(200);
    expect((await review(id)).events.at(-1)).toMatchObject({ kind: 'approved', payload: { changeControl: 'CC-2026-014' } });
  });

  it('TB-02 one effective version: making a new version effective retires the previous one', async () => {
    // Without QMS the change control number is typed by hand: a second person makes the version effective.
    const v1 = await approved();
    expect((await as('qachecker', 'POST', `/api/master-versions/${v1.id}/make-effective`, {})).statusCode).toBe(200);
    expect(await state(v1.id)).toBe('effective');
    const next = await as('author', 'POST', `/api/masters/${v1.masterId}/versions`, {});
    const v2 = (next.json() as { id: number }).id;
    expect((await review(v2)).previous?.versionNo).toBe(1);
    // A new version that changes nothing cannot be sent for review.
    expect((await review(v2, 'author')).refusals.submit).toBe('This version is the same as version 1: change what the new version is for, then send it for review.');
    expect((await act('author', v2, 'submit')).json()).toMatchObject({ error: 'no_changes' });
    const doc = placed(tablet());
    doc.header.batchSize = '50000';
    expect((await as('author', 'PUT', `/api/master-versions/${v2}`, { doc })).statusCode).toBe(200);
    expect((await act('author', v2, 'submit')).statusCode).toBe(200);
    await act('checker', v2, 'pass');
    await act('quality', v2, 'approve', { changeControl: 'CC-2026-020' });
    expect((await as('checker', 'POST', `/api/master-versions/${v2}/make-effective`, {})).statusCode).toBe(403);
    expect((await as('qachecker', 'POST', `/api/master-versions/${v2}/make-effective`, {})).statusCode).toBe(200);
    expect([await state(v1.id), await state(v2)]).toEqual(['retired', 'effective']);
    const effective = await t.owner`select id from master_versions where master_id = ${v1.masterId} and state = 'effective'`;
    expect(effective).toHaveLength(1);
    expect((await as('quality', 'POST', `/api/master-versions/${v2}/make-effective`, {})).json().error).toBe('wrong_state');
  });

  it('a returned version goes back to draft with its reason; comments are kept and insert-only', async () => {
    const { id } = await draft();
    await act('author', id, 'submit');
    expect((await as('checker', 'POST', `/api/master-versions/${id}/return`, { reason: '' })).statusCode).toBe(400);
    expect((await as('checker', 'POST', `/api/master-versions/${id}/comments`, { text: 'Hold time of the granules?', path: 'stages[1].produces' })).statusCode).toBe(200);
    expect((await as('checker', 'POST', `/api/master-versions/${id}/return`, { reason: 'See my comment' })).statusCode).toBe(200);
    expect(await state(id)).toBe('draft');
    const r = await review(id);
    expect(r.events.map((e) => e.kind)).toEqual(['submitted', 'returned']);
    expect(r.comments).toMatchObject([{ text: 'Hold time of the granules?', personName: 'CHECKER' }]);
    expect((await as('viewer', 'POST', `/api/master-versions/${id}/comments`, { text: 'x' })).statusCode).toBe(403);
    const change = await t.owner`update master_comments set text = 'changed'`.then(() => 'ok', (e: { code?: string }) => e.code);
    expect(change).toBe('42501');
    // Sent again: a new round, so the checker may check it again.
    expect((await act('author', id, 'submit')).statusCode).toBe(200);
    expect((await act('checker', id, 'pass')).statusCode).toBe(200);
  });
});
