import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { recordLate } from '../server/late.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, type TestApp } from './helpers.js';
import { small, tablet } from './engine-fixture.js';
import { findBlock } from '../shared/blocks/index.js';
import { machineRefusal, roomRefusal } from '../shared/engine/picks.js';

// Master versions (draft, locked once out of draft), issuing a batch from an effective version (TB-03), walking a
// stage through the step routes, refused actions (TB-08), insert-only step events and the timer job (TB-17).

let t: TestApp;
const cookies: Record<string, string> = {};
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });

beforeAll(async () => {
  t = await freshApp();
  t.master.products_.push({ ...item('prd-1', 'PRD-001', 'Examplol 100 mg film-coated tablets'), strength: '100 mg', dosageForm: 'tablet' });
  for (const l of tablet().formula) t.master.materials_.push({ ...item(l.materialItemId, l.code, l.name), category: null, unit: 'kg' });
  t.master.equipment_.push(
    { ...item('eq-bal', 'BAL-01', 'Balance 60 kg'), kind: 'instrument', type: 'balance', room: 'DSP-01' },
    { ...item('eq-str', 'STR-01', 'Stirrer'), kind: 'equipment', type: 'stirrer', room: 'GRN-01' },
    { ...item('eq-prs', 'PRS-01', 'Tablet press'), kind: 'equipment', type: 'tablet press', room: 'CMP-01' },
  );
  const people = {
    author: ['truebatch.master.author', 'truebatch.view'], issuer: ['truebatch.batch.issue'], viewer: ['truebatch.view'],
    asha: ['truebatch.batch.operate', 'truebatch.batch.check'], ravi: ['truebatch.batch.check'], meera: ['truebatch.qa.release'],
    sam: ['truebatch.batch.supervise'], quinn: ['truebatch.qc.approve'],
  } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(() => t.close());

const as = (who: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: object) => call(t.app, cookies[who]!, method as 'GET', url, body);
async function effectiveMaster(change?: (d: ReturnType<typeof tablet>) => void, doc = tablet()) {
  change?.(doc);
  const res = await as('author', 'POST', '/api/masters', { doc });
  expect(res.statusCode).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  return id;
}
async function issue(masterVersionId: number) {
  const res = await as('issuer', 'POST', '/api/batches', { masterVersionId, proof: proofFor('issuer') });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: number; batchNo: string };
}
const batch = async (id: number, who = 'asha') => (await as(who, 'GET', `/api/batches/${id}`)).json() as {
  stages: { key: string; open: boolean; closed: boolean; blocked?: string }[];
  steps: { id: string; state: string; actions: string[]; contentHash: string; results: Record<string, { ok: boolean; check?: { pass: boolean } }>; problems: string[]; blocked?: string }[];
  timers: { id: string; state: string }[];
};
const stepOf = async (id: number, key: string, who = 'asha') => (await batch(id, who)).steps.find((s) => s.id === key)!;
const act = (who: string, id: number, key: string, action: string, body: object = {}) => as(who, 'POST', `/api/batches/${id}/steps/${key}/${action}`, body);
const sign = async (who: string, id: number, key: string, action: string, extra: object = {}) =>
  act(who, id, key, action, { proof: proofFor(who), contentHash: (await stepOf(id, key, who)).contentHash, ...extra });

// The text of a PDF document definition, in order: page header, content, and the footer of page 1 of 3 (TB-22).
function pdfText(def: TDocumentDefinitions): string {
  const walk = (c: unknown): string => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(walk).join('');
    if (!c || typeof c !== 'object') return '';
    const o = c as { text?: unknown; stack?: unknown[]; table?: { body: unknown[][] }; decoration?: string };
    if (o.stack) return o.stack.map(walk).join('\n');
    if (o.table) return o.table.body.map((r) => r.map((x) => walk(x).trim()).join(' | ')).join('\n');
    const t = walk(o.text);
    return o.decoration === 'lineThrough' ? `~${t}~` : t;
  };
  const footer = typeof def.footer === 'function' ? def.footer(1, 3, { width: 0, height: 0 } as never) : def.footer;
  return [def.header, ...(def.content as Content[]), footer].map(walk).join('\n');
}
const recordText = async (id: number) => pdfText(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!), 'VIEWER'));

describe('master versions', () => {
  it('a new master is version 1, a draft; the draft can be changed and checked', async () => {
    const res = await as('author', 'POST', '/api/masters', { doc: tablet() });
    const { id, versionNo } = res.json() as { id: number; versionNo: number };
    expect(versionNo).toBe(1);
    const doc = tablet();
    doc.header.batchSize = '50000';
    expect((await as('author', 'PUT', `/api/master-versions/${id}`, { doc })).statusCode).toBe(200);
    expect(((await as('viewer', 'GET', `/api/master-versions/${id}`)).json() as { doc: typeof doc }).doc.header.batchSize).toBe('50000');
    // The fixture names no rooms for its stages (TB-11): only that is left to fix.
    expect((await as('viewer', 'GET', `/api/master-versions/${id}/checks`)).json().problems.map((p: { path: string }) => p.path)).toEqual([0, 1, 2, 3].map((i) => `stages[${i}].roomTypes`));
    expect(await t.owner`select 1 from audit_log where action = 'master.updated' and object_id = ${String(id)}`).toHaveLength(1);
    expect((await as('viewer', 'PUT', `/api/master-versions/${id}`, { doc })).statusCode).toBe(403);
  });

  it('PL-08 the product and materials must be active in master data', async () => {
    const doc = tablet();
    doc.formula[0]!.materialItemId = 'nowhere';
    expect((await as('author', 'POST', '/api/masters', { doc })).statusCode).toBe(409);
  });

  it('only a draft is editable: a version out of draft is locked by the database', async () => {
    const { id, masterId } = (await as('author', 'POST', '/api/masters', { doc: tablet() })).json() as { id: number; masterId: number };
    expect((await as('author', 'POST', `/api/masters/${masterId}/versions`, {})).statusCode).toBe(409);
    await t.owner`update master_versions set state = 'in_review' where id = ${id}`;
    expect((await as('author', 'PUT', `/api/master-versions/${id}`, { doc: tablet() })).json()).toMatchObject({ error: 'locked' });
    expect(await code(t.sql`update master_versions set doc = '{}' where id = ${id}`)).toBe('P0001');
    await t.owner`update master_versions set state = 'approved' where id = ${id}`;
    expect(await code(t.owner`update master_versions set state = 'draft' where id = ${id}`)).toBe('P0001');
    expect(await code(t.owner`update master_versions set doc = '{}' where id = ${id}`)).toBe('P0001');
    expect(await code(t.owner`delete from master_versions where id = ${id}`)).toBe('P0001');
    const next = await as('author', 'POST', `/api/masters/${masterId}/versions`, {});
    expect(next.json()).toMatchObject({ masterId, versionNo: 2 });
  });
});

describe('issuing a batch', () => {
  it('TB-03 batch numbers come from the year counter with the fixed prefix, in order, never reused', async () => {
    const mv = await effectiveMaster();
    const a = await issue(mv);
    const b = await issue(mv);
    expect(a.batchNo).toMatch(/^TB\d{2}\d{4}$/);
    expect(Number(b.batchNo.slice(4))).toBe(Number(a.batchNo.slice(4)) + 1);
    expect(await code(t.sql`insert into batches (batch_no, master_version_id, issued_by) values (${a.batchNo}, ${mv}, 1)`)).toBe('23505');
    expect(await t.owner`select 1 from signatures where object_type = 'batch' and object_id = ${a.id} and meaning = 'issued'`).toHaveLength(1);
  });

  it('only an effective master version is issued, and only with the issue permission', async () => {
    const { id } = (await as('author', 'POST', '/api/masters', { doc: tablet() })).json() as { id: number };
    expect((await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') })).json()).toMatchObject({ error: 'not_effective' });
    expect((await as('asha', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('asha') })).statusCode).toBe(403);
    const bad = await effectiveMaster((d) => { d.stages[1]!.steps[0]!.checker = false; });
    expect((await as('issuer', 'POST', '/api/batches', { masterVersionId: bad, proof: proofFor('issuer') })).json())
      .toMatchObject({ error: 'master_has_errors', problems: ['stages[1].steps[0]: A weighing step needs a second-person check'] });
  });
});

describe('walking a stage', () => {
  let id: number;
  beforeAll(async () => { id = (await issue(await effectiveMaster())).id; });

  it('the first step of the preparation is open; everything else waits, with the reason', async () => {
    const b = await batch(id);
    expect(b.steps[0]).toMatchObject({ id: '0.1.0.1', state: 'open', actions: ['start', 'note'] });
    expect(b.steps.find((s) => s.id === '1.1.0.1')!.blocked).toBe('Waits for the preparation Binder solution to close');
  });

  it('TB-07 start → record (the templates compute) → done (signed performed) → checked by another person (signed verified)', async () => {
    expect((await act('asha', id, '0.1.0.1', 'start')).statusCode).toBe(200);
    // 10.0 mg × 100 000 = 1.000 kg target; 1.350 − 0.350 = 1.000 kg net.
    const rec = await act('asha', id, '0.1.0.1', 'record', { values: { lot: 'PVP-2611', ...handLabels('lot', 'lot'), balance: 'eq-bal', ...handLabels('balance', 'machine'), gross: '1.350', tare: '0.350' } });
    expect(rec.statusCode).toBe(200);
    const s = await stepOf(id, '0.1.0.1');
    expect(s.results.net).toMatchObject({ ok: true, value: '1' });
    expect(s.results.netCheck?.check?.pass).toBe(true);
    expect(s.problems).toEqual([]);
    const done = await sign('asha', id, '0.1.0.1', 'done');
    expect(done.statusCode).toBe(200);
    const { eventId } = done.json() as { eventId: number };
    expect(await t.owner`select 1 from signatures where object_type = 'step_event' and object_id = ${eventId} and meaning = 'performed'`).toHaveLength(1);
    expect((await stepOf(id, '0.1.0.1')).state).toBe('done_awaiting_check');
    expect((await sign('ravi', id, '0.1.0.1', 'check')).statusCode).toBe(200);
    expect((await stepOf(id, '0.1.0.1')).state).toBe('checked');
    expect(await t.owner`select 1 from audit_log where action = 'step.checked' and object_id = ${String(id)}`).toHaveLength(1);
  });

  it('TB-10 the line clearance offers the previous product and batch of a room or machine from the batches that used it (pull, don\'t type)', async () => {
    const later = await issue(await effectiveMaster());
    const r = (await as('asha', 'GET', `/api/batches/${later.id}/previous-use?item=eq-bal`)).json() as { previous: { batchNo: string; text: string } | null };
    const first = ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { batch: { batchNo: string } }).batch.batchNo;
    expect(r.previous).toMatchObject({ batchNo: first, text: `PRD-001 · Examplol 100 mg film-coated tablets, batch ${first}` });
    // Nothing used it before the first batch: typed by hand.
    expect(((await as('asha', 'GET', `/api/batches/${id}/previous-use?item=eq-bal`)).json() as { previous: unknown }).previous).toBeNull();
  });

  it('a mix cannot be done before its minimum time; after it, the preparation closes and the next stage opens', async () => {
    expect((await act('asha', id, '0.1.1.1', 'start')).statusCode).toBe(200);
    await act('asha', id, '0.1.1.1', 'record', { values: { machine: 'eq-str', ...handLabels('machine', 'machine'), speed: '300' } });
    const early = await sign('asha', id, '0.1.1.1', 'done');
    expect(early.statusCode).toBe(409);
    expect(early.json().problems[0]).toMatch(/^The minimum time is 10 min/);
    // As if the mix had started 11 minutes ago.
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, person_id, at)
      select ${id}, 0, 1, 1, 1, 'started', person_id, now() - interval '11 minutes' from step_events where batch_id = ${id} and kind = 'started' limit 1`;
    expect((await sign('asha', id, '0.1.1.1', 'done')).statusCode).toBe(200);
    // The stirrer was entered by hand (no Logbook link): a second person checks the step.
    expect((await stepOf(id, '0.1.1.1')).state).toBe('done_awaiting_check');
    expect((await sign('ravi', id, '0.1.1.1', 'check')).statusCode).toBe(200);
    const b = await batch(id);
    expect(b.stages[0]).toMatchObject({ key: 'binder', closed: true });
    // The check that closed the preparation recorded it once (equipment_use_v1 reads it to end the batch's uses).
    expect(await t.owner`select payload from batch_events where batch_id = ${id} and kind = 'stage_closed'`).toEqual([{ payload: { stage: 0 } }]);
    expect(b.steps.find((s) => s.id === '1.1.0.1')!.state).toBe('open');
    expect(b.timers).toMatchObject([{ id: 'hold:0:1', state: 'running' }]);
  });

  it('refused: the wrong state, a missing permission, a stale screen, a machine the stage does not allow', async () => {
    expect((await act('asha', id, '1.1.0.1', 'record', { values: { lot: 'X' } })).json()).toMatchObject({ error: 'wrong_state' });
    expect((await sign('ravi', id, '1.1.0.1', 'check')).json()).toMatchObject({ error: 'wrong_state' });
    expect((await act('ravi', id, '1.1.0.1', 'start')).json()).toMatchObject({ error: 'forbidden' });
    expect((await act('viewer', id, '1.1.0.1', 'note', { text: 'x' })).statusCode).toBe(403);
    expect((await act('asha', id, '9.1.0.1', 'start')).json()).toMatchObject({ error: 'no_such_step' });
    await act('asha', id, '1.1.0.1', 'start');
    const press = await act('asha', id, '1.1.0.1', 'record', { values: { balance: 'eq-prs', gross: 'heavy' } });
    expect(press.json()).toMatchObject({ error: 'invalid_values', problems: ['PRS-01 is not a balance (master data: tablet press)', 'Gross weight: type a number, e.g. "50.300"'] });
    await act('asha', id, '1.1.0.1', 'record', { values: { lot: 'API-2611', ...handLabels('lot', 'lot'), balance: 'eq-bal', ...handLabels('balance', 'machine'), assay: '99.0', lod: '0.5', gross: '11.000', tare: '0.850' } });
    const stale = await act('asha', id, '1.1.0.1', 'done', { proof: proofFor('asha'), contentHash: '0'.repeat(64) });
    expect(stale.json()).toMatchObject({ error: 'content_changed' });
  });

  it('TB-11 a machine not active in master data, or of a type the stage does not allow, is refused', async () => {
    t.master.equipment_.push({ ...item('eq-old', 'BAL-09', 'Old balance'), active: false, kind: 'instrument', type: 'balance', room: 'DSP-01' });
    expect((await act('asha', id, '1.1.0.1', 'record', { values: { balance: 'eq-old' } })).json()).toMatchObject({ error: 'inactive_item' });
    expect((await act('asha', id, '1.1.0.1', 'record', { values: { balance: 'eq-prs' } })).json()).toMatchObject({ error: 'invalid_values' });
  });

  it('TB-11 a machine field takes only the type it asks for, in a room the stage allows; a room only of the stage\'s areas or rooms', () => {
    const stage = { ...tablet().stages[1]!, machineTypes: ['Balance', 'Vessel'], roomTypes: ['Granulation', 'DSP-01'] };
    const balance = findBlock({ id: 'weigh', version: 1 })!.fields.find((f) => f.name === 'balance')!;
    const rooms = [{ code: 'GRN-01', area: 'Granulation' }, { code: 'DSP-01', area: 'Dispensing' }, { code: 'QCL-02', area: 'QC laboratory' }, { code: 'BL-GRN', area: 'Beta-lactam' }];
    const m = (code: string, type: string, room: string | null) => machineRefusal(stage, balance, { code, type, room }, rooms, ['DSP-01']);
    expect([m('BAL-01', 'Balance', 'DSP-01'), m('BAL-03', 'balance', 'GRN-01')]).toEqual([null, null]);
    expect(m('BAL-02', 'balance', null)).toBe('BAL-02 stands in no room in master data, so it is not in a room this stage allows (Granulation, DSP-01)');
    expect(m('SPV-01', 'Vessel', 'GRN-01')).toBe('SPV-01 is not a balance (master data: Vessel)');
    expect(m('BAL-06', 'Balance', 'QCL-02')).toBe('BAL-06 stands in QCL-02 (QC laboratory), a laboratory area: weigh with a balance of a dispensing room of the master or of a room this stage allows');
    expect(m('BAL-07', 'Balance', 'BL-GRN')).toBe('BAL-07 stands in BL-GRN, neither in a dispensing room of the master nor in a room this stage allows (Granulation, DSP-01)');
    const press = findBlock({ id: 'compress', version: 1 })!.fields.find((f) => f.name === 'machine')!;
    expect(machineRefusal(stage, press, { code: 'PRS-01', type: 'Tablet press', room: 'GRN-01' }, rooms)).toBe('PRS-01 is not one of the machine types this stage allows (Balance, Vessel)');
    expect(rooms.map((r) => roomRefusal(stage, r))).toEqual([null, null, 'QCL-02 is not one of the rooms this stage allows (Granulation, DSP-01)', 'BL-GRN is not one of the rooms this stage allows (Granulation, DSP-01)']);
  });

  it('TB-04 each entry is saved at once, with the person and the server time', async () => {
    const [e] = await t.owner<{ person: string; fresh: boolean }[]>`
      select u.username as person, now() - e.at < interval '1 minute' as fresh from step_events e join users u on u.id = e.person_id
      where e.batch_id = ${id} order by e.id desc limit 1`;
    expect(e).toEqual({ person: 'asha', fresh: true });
  });

  it('TB-08 the person who performed a step cannot check it', async () => {
    expect((await sign('asha', id, '1.1.0.1', 'done')).statusCode).toBe(200);
    expect((await stepOf(id, '1.1.0.1')).actions).not.toContain('check');
    const own = await sign('asha', id, '1.1.0.1', 'check');
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ error: 'own_work' });
  });

  it('send back, correct with a reason, sign again, check: the original value stays in the record', async () => {
    expect((await act('ravi', id, '1.1.0.1', 'send-back', { reason: 'Tare looks wrong' })).statusCode).toBe(200);
    expect((await act('asha', id, '1.1.0.1', 'record', { values: { tare: '0.849' } })).json()).toMatchObject({ error: 'wrong_state' });
    expect((await act('asha', id, '1.1.0.1', 'correct', { values: { tare: '0.849' } })).statusCode).toBe(400);
    expect((await act('asha', id, '1.1.0.1', 'correct', { values: { tare: '0.849' }, reason: 'Tare misread' })).statusCode).toBe(200);
    const s = (await stepOf(id, '1.1.0.1')) as unknown as { needsResign: boolean; replaced?: unknown; results: Record<string, { value: string }> };
    expect(s.needsResign).toBe(true);
    expect(s.replaced).toBeUndefined();
    expect(s.results.net!.value).toBe('10.151');
    const history = (await as('viewer', 'GET', `/api/batches/${id}/steps/1.1.0.1/events`)).json() as { events: { kind: string }[]; replaced: unknown };
    expect(history.replaced).toMatchObject([{ field: 'tare', was: { value: '0.850' }, now: { value: '0.849' }, reason: 'Tare misread' }]);
    expect(history.events.map((e) => e.kind)).toEqual(['started', 'value', 'done', 'sent_back', 'corrected']);
    expect((await sign('asha', id, '1.1.0.1', 'done')).statusCode).toBe(200);
    expect((await sign('ravi', id, '1.1.0.1', 'check')).statusCode).toBe(200);
  });

  it('TB-06 a correction reaches the step that used the value: it shows the new result and who changed it, and is signed and checked again', async () => {
    expect((await act('asha', id, '1.1.1.1', 'start')).statusCode).toBe(200);
    await act('asha', id, '1.1.1.1', 'record', { values: { lot: 'LAC-2611', ...handLabels('lot', 'lot'), balance: 'eq-bal', ...handLabels('balance', 'machine'), gross: '12.700', tare: '0.850' } });
    expect((await sign('asha', id, '1.1.1.1', 'done')).statusCode).toBe(200);
    expect((await sign('ravi', id, '1.1.1.1', 'check')).statusCode).toBe(200);
    const before = (await stepOf(id, '1.1.1.1')).results as unknown as { target: { value: string } };
    // The API's assay is corrected after the lactose target (T10) was worked out from it.
    expect((await act('asha', id, '1.1.0.1', 'correct', { values: { assay: '98.0' }, reason: 'Assay typed from the old certificate' })).statusCode).toBe(200);
    const s = (await stepOf(id, '1.1.1.1')) as unknown as { state: string; needsResign: boolean; inputChanged: { kind: string; personName: string; payload: { reason: string } }[]; results: { target: { value: string } } };
    expect([s.state, s.needsResign]).toEqual(['in_progress', true]);
    expect(s.inputChanged).toMatchObject([{ kind: 'corrected', personName: 'ASHA', payload: { reason: 'Assay typed from the old certificate' } }]);
    expect(Number(s.results.target.value)).toBeLessThan(Number(before.target.value));
    // Signed again with the new target, then checked again. 11.850 kg is now 0.9 % over the new target: a note first.
    await sign('asha', id, '1.1.0.1', 'done');
    await sign('ravi', id, '1.1.0.1', 'check');
    expect((await sign('asha', id, '1.1.1.1', 'done')).json()).toMatchObject({ error: 'not_ready', problems: ['Out of limits: Net against target. Add a deviation note first.'] });
    await act('asha', id, '1.1.1.1', 'note', { text: 'Lactose 0.9 % over the corrected target', reference: 'DEV-26-003' });
    expect((await sign('asha', id, '1.1.1.1', 'done')).statusCode).toBe(200);
    expect((await stepOf(id, '1.1.1.1')).state).toBe('done_awaiting_check');
    expect((await sign('ravi', id, '1.1.1.1', 'check')).statusCode).toBe(200);
    const after = (await stepOf(id, '1.1.1.1')) as unknown as { inputChanged: unknown[]; results: { target: { value: string } } };
    expect([after.inputChanged, after.results.target.value]).toEqual([[], s.results.target.value]);
  });

  it('TB-22 the batch record PDF shows the corrected value struck through with its reason, the worked lines, limits, notes and who did what', async () => {
    const text = await recordText(id);
    expect(text).toMatch(/^TrueBatch Tablets · Batch record TB\d{6} · PRD-001 Examplol 100 mg film-coated tablets/);
    expect(text).toContain('Status | In production');
    expect(text).toContain('Changed values | marked CHANGED');
    expect(text).toContain('Tare weight: 0.849 kg  CHANGED');
    expect(text).toMatch(/was ~0\.850 kg~ · reason: Tare misread · ASHA, \d+ \w+ 2026, \d\d:\d\d IST/);
    // A figure leads, its worked line follows (17 Nov 2026 run, F30): one verdict, on its own line.
    expect(text).toContain('Net weight: 10.151 kg\n11.000 kg − 0.849 kg = 10.151 kg');
    // The label questions typed by hand by their labels, never their names.
    expect(text).toContain('Balance: the calibration label is in date: yes');
    expect(text).not.toMatch(/\b(?:balance|lot|machine|room)\.[a-zA-Z]/);
    expect(text).toContain('(limit ± 0.5 %)');
    // Machines and rooms by code and name, without master data's version.
    expect(text).toContain('Balance: BAL-01 · Balance 60 kg');
    expect(text).not.toMatch(/ \(v\d+\)/);
    expect(text).not.toContain('within limits\nPASS');
    expect(text).toContain('FAIL: out of limits');
    expect(text).toContain('MAT-001 · Examplol | API · intragranular | 100.0 | 10.000 kg | Lot API-2611: 10.151 kg (target');
    expect(text).toMatch(/Checked: RAVI, .* IST · signed "Verified \(second person\)"/);
    expect(text).toMatch(/Sent back: RAVI, .* · reason: Tare looks wrong/);
    expect(text).toMatch(/DEV-26-003 \(typed by hand\) \| Granulation · 2\.2 Weigh a material: Lactose monohydrate \| Lactose 0\.9 % over the corrected target \| ASHA, .* \| OPEN/);
    expect(text).toContain('This copy was made while the batch is in production: it is not a released record.');
    expect(text).toMatch(/Generated .* IST by VIEWER · true copy of the electronic record · page 1 of 3$/);
  });

  it('GET /api/batches/:id shows each step\'s last events only', async () => {
    const b = (await as('viewer', 'GET', `/api/batches/${id}`)).json() as { steps: { id: string; events: unknown[] }[] };
    const all = (await as('viewer', 'GET', `/api/batches/${id}/steps/1.1.0.1/events`)).json() as { events: unknown[] };
    expect(all.events.length).toBeGreaterThan(5);
    expect(b.steps.find((x) => x.id === '1.1.0.1')!.events).toEqual(all.events.slice(-5));
    expect((await as('viewer', 'GET', `/api/batches/${id}/steps/9.1.0.1/events`)).statusCode).toBe(404);
  });

  it('TB-06 step events are insert-only: the app role cannot change or delete them, nor can the owner', async () => {
    expect(await code(t.sql`update step_events set kind = 'checked'`)).toBe('42501');
    expect(await code(t.sql`delete from step_events`)).toBe('42501');
    expect(await code(t.owner`update step_events set payload = '{}'`)).toBe('42501');
    expect(await code(t.owner`delete from step_events`)).toBe('42501');
    expect(await code(t.sql`insert into step_events (batch_id, stage, sub, step, round, kind, person_id, at) values (${id}, 0, 1, 0, 1, 'note', 1, now() - interval '1 day')`)).toBe('42501');
  });
});

describe('production approval, QC approval and QA release', () => {
  let id: number;
  let note: number;
  const full = async () => (await as('viewer', 'GET', `/api/batches/${id}`)).json() as { batch: { status: string; contentHash: string; actions: string[]; open: string[] } };
  const batchAct = (who: string, action: string, body: object) => as(who, 'POST', `/api/batches/${id}/${action}`, body);
  const batchSign = async (who: string, action: string, extra: object = {}) => batchAct(who, action, { proof: proofFor(who), contentHash: (await full()).batch.contentHash, ...extra });
  beforeAll(async () => {
    t.master.products_.push({ ...item('p', 'P', 'P'), strength: null, dosageForm: 'tablet' });
    t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
    // One pH check and the stage yield, checked by a second person.
    const doc = small([{ steps: [{}, { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]);
    id = (await issue(await effectiveMaster(undefined, doc))).id;
  });

  it('TB-20 production cannot sign while anything in the record is open', async () => {
    expect((await batchSign('sam', 'production-approve')).json()).toMatchObject({ error: 'not_ready', problems: ['Stage 0 › Check a value against limits: pH is not started', 'Stage 0 › Stage yield is not started', 'Stage Stage 0 is not closed'] });
    await act('asha', id, '0.1.0.1', 'start');
    await act('asha', id, '0.1.0.1', 'record', { values: { reading: '6.0' } });
    expect((await sign('asha', id, '0.1.0.1', 'done')).statusCode).toBe(200);
    await act('asha', id, '0.1.1.1', 'start');
    await act('asha', id, '0.1.1.1', 'record', { values: { output: '0.099', samples: '0.000', rejects: '0.001' } });
    expect((await sign('asha', id, '0.1.1.1', 'done')).statusCode).toBe(200);
    expect((await batchSign('sam', 'production-approve')).json()).toMatchObject({ problems: ['Stage 0 › Stage yield is waiting for its check', 'Stage Stage 0 is not closed'] });
    expect((await sign('ravi', id, '0.1.1.1', 'check')).statusCode).toBe(200);
    expect((await full()).batch).toMatchObject({ status: 'manufacturing complete', open: [] });
  });

  it('TB-07 production approval is an e-signature on the record as shown; the record is then closed to changes', async () => {
    expect((await batchAct('sam', 'production-approve', { proof: proofFor('sam'), contentHash: '0'.repeat(64) })).json()).toMatchObject({ error: 'content_changed' });
    const ok = await batchSign('sam', 'production-approve');
    expect(ok.statusCode).toBe(200);
    const { eventId } = ok.json() as { eventId: number };
    expect(await t.owner`select 1 from signatures where object_type = 'batch_event' and object_id = ${eventId} and meaning = 'production_approved'`).toHaveLength(1);
    expect((await full()).batch.status).toBe('production approved');
    expect((await act('asha', id, '0.1.0.1', 'correct', { values: { reading: '6.1' }, reason: 'x' })).json()).toMatchObject({ error: 'batch_closed' });
    const n = await act('asha', id, '0.1.0.1', 'note', { text: 'pH meter found out of calibration', reference: 'DEV-26-010' });
    expect(n.statusCode).toBe(200);
    note = (n.json() as { eventId: number }).eventId;
  });

  const toReview = async (who: string) => ((await as(who, 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string; openDeviations: number }[]).filter((b) => b.id === id);
  it('TB-21 the To review list: QC sees the production-approved batch, QA only once QC has approved; others may not look', async () => {
    expect(await toReview('quinn')).toMatchObject([{ waiting: 'QC', openDeviations: 1 }]);
    expect(await toReview('meera')).toEqual([]);
    expect((await as('asha', 'GET', '/api/batches/to-review')).statusCode).toBe(403);
  });

  it('TB-21 QC approves with its report number; QA releases only once the linked deviations are closed', async () => {
    expect((await batchSign('quinn', 'qc-approve')).statusCode).toBe(400);
    expect((await batchSign('meera', 'release')).json()).toMatchObject({ problems: ['Not possible while the batch is production approved.'] });
    expect((await batchSign('quinn', 'qc-approve', { reportNo: 'QC-26-0042' })).statusCode).toBe(200);
    expect([await toReview('quinn'), await toReview('meera')]).toMatchObject([[], [{ waiting: 'QA', openDeviations: 1 }]]);
    expect((await batchSign('meera', 'reject', {})).statusCode).toBe(400);
    expect((await batchSign('meera', 'release')).json()).toMatchObject({ error: 'not_ready', problems: ['Deviation DEV-26-010 (Stage 0 › Check a value against limits: pH) is open'] });
    expect((await batchAct('quinn', 'close-deviation', { note, reason: 'x' })).statusCode).toBe(403);
    expect((await batchAct('meera', 'close-deviation', { note, reason: 'Meter recalibrated; results confirmed by a second meter' })).statusCode).toBe(200);
    expect((await batchAct('meera', 'close-deviation', { note, reason: 'again' })).statusCode).toBe(409);
    expect((await batchSign('meera', 'release')).statusCode).toBe(200);
    expect((await full()).batch).toMatchObject({ status: 'released', actions: [] });
    // batch_fact_v1 says who released the batch (the name as signed) and when (the release event's time).
    const [ev] = await t.owner<{ at: Date }[]>`select at from batch_events where batch_id = ${id} and kind = 'released'`;
    const [f] = await t.owner.unsafe(`select status, released, released_at, released_by from ${t.schema}_report.batch_fact_v1 where batch_number = (select batch_no from batches where id = $1)`, [id]);
    expect(f).toEqual({ status: 'RELEASED', released: true, released_at: ev!.at, released_by: 'MEERA' });
  });

  it('TB-21 the review list shows the deviations with their status and every signature of the batch', async () => {
    const r = (await as('viewer', 'GET', `/api/batches/${id}/review`)).json() as { status: string; deviations: unknown[]; signatures: { meaning: string; printedName: string }[] };
    expect(r.status).toBe('released');
    expect(r.deviations).toMatchObject([{ reference: 'DEV-26-010', open: false, closed: { personName: 'MEERA' } }]);
    expect(r.signatures.map((x) => `${x.meaning} ${x.printedName}`)).toEqual(['issued ISSUER', 'performed ASHA', 'performed ASHA', 'verified RAVI', 'production_approved SAM', 'qc_approved QUINN', 'released MEERA']);
  });

  it('TB-22 the batch record PDF is produced, with the QC report, the release decision and every signature with its meaning', async () => {
    const res = await as('viewer', 'GET', `/api/batches/${id}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="batch-record-TB\d{6}\.pdf"$/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await as('viewer', 'GET', '/api/batches/999999/pdf')).statusCode).toBe(404);
    const text = await recordText(id);
    expect(text).toContain('Status | Released');
    expect(text).toMatch(/QC approved: QUINN, .* IST · QC report QC-26-0042/);
    expect(text).toMatch(/Released: MEERA, .* IST/);
    expect(text).toMatch(/DEV-26-010 \(typed by hand\) \| .* \| pH meter found out of calibration \| ASHA, .* \| closed by MEERA, .*: Meter recalibrated; results confirmed by a second meter/);
    expect(text).toContain('Stage · yield 99.0 %');
    for (const m of ['Issued | ISSUER', 'Performed | ASHA', 'Verified (second person) | RAVI', 'Production approved | SAM', 'QC approved | QUINN', 'Released | MEERA']) expect(text).toContain(m);
    expect(text).not.toContain('not a released record');
  });

  it('TB-05 every step and batch action is in TrueBatch\'s own audit trail', async () => {
    const rows = await t.owner<{ action: string }[]>`select distinct action from audit_log where object_type = 'batch' and object_id = ${String(id)} order by action`;
    expect(rows.map((r) => r.action)).toEqual(['batch.deviation_closed', 'batch.issued', 'batch.production_approved', 'batch.qc_approved', 'batch.released', 'batch.stage_closed', 'signed.issued',
      'step.checked', 'step.done', 'step.note', 'step.started', 'step.value']);
  });

  it('TB-19 a released batch takes no more entries or decisions: rework is a new batch from an effective master', async () => {
    expect((await act('asha', id, '0.1.0.1', 'note', { text: 'x' })).json()).toMatchObject({ error: 'batch_closed', problems: ['The batch is released.'] });
    expect((await batchSign('meera', 'reject', { reason: 'x' })).json()).toMatchObject({ problems: ['Not possible while the batch is released.'] });
    const [m] = await t.owner<{ id: string }[]>`select id from users where username = 'meera'`;
    expect(await code(t.owner`insert into batch_events (batch_id, kind, person_id) values (${id}, 'rejected', ${m!.id})`)).toBe('23505');
    expect(await code(t.sql`update batch_events set kind = 'rejected'`)).toBe('42501');
  });
});

describe('QA terminates a batch that cannot be finished (owner, 16 Nov 2026)', () => {
  let id: number;
  const full = async (who = 'viewer') => (await as(who, 'GET', `/api/batches/${id}`)).json() as {
    batch: { status: string; contentHash: string; actions: string[]; terminated: { personName: string; payload: { reason: string } } | null; issued: object[] };
    steps: { actions: string[] }[]; timers: unknown[] };
  const back = (value: string) => [{ lot: 'PVP-2611', value, unit: 'kg' }];
  const terminate = async (who: string, extra: object = { reason: 'The stirrer broke down; the binder cannot be made', returns: back('0.250') }) =>
    as(who, 'POST', `/api/batches/${id}/terminate`, { proof: proofFor(who), contentHash: (await full()).batch.contentHash, ...extra });
  const uses = () => t.owner.unsafe(`select equipment_code, ended_at from ${t.schema}_report.equipment_use_v1 where batch_number = (select batch_no from batches where id = $1)`, [id]);
  beforeAll(async () => {
    id = (await issue(await effectiveMaster())).id;
    // The binder: weighed, then the stirrer in use and the mix running.
    await act('asha', id, '0.1.0.1', 'start');
    await act('asha', id, '0.1.0.1', 'record', { values: { lot: 'PVP-2611', ...handLabels('lot', 'lot'), balance: 'eq-bal', ...handLabels('balance', 'machine'), gross: '1.350', tare: '0.350' } });
    await sign('asha', id, '0.1.0.1', 'done');
    await sign('ravi', id, '0.1.0.1', 'check');
    await act('asha', id, '0.1.1.1', 'start');
    await act('asha', id, '0.1.1.1', 'record', { values: { machine: 'eq-str', ...handLabels('machine', 'machine'), speed: '300' } });
  });

  it('TB-21 QA sees the batch in production on its To review list and may terminate it, with a reason; nobody else may', async () => {
    const rows = ((await as('meera', 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string; actions: string[] }[]).filter((b) => b.id === id);
    expect(rows).toMatchObject([{ waiting: 'production', actions: ['terminate'] }]);
    expect((await full('meera')).batch.actions).toEqual(['terminate']);
    expect((await full('sam')).batch.actions).toEqual([]);
    // Without qa.release at core, the signature itself is refused.
    expect((await terminate('sam')).statusCode).toBe(401);
    expect((await terminate('meera', {})).statusCode).toBe(400);
    expect(await uses()).toEqual([{ equipment_code: 'STR-01', ended_at: null }]);
  });

  it('TB-21 terminating asks how much of each lot the batch used went back to stores unused: 0 up to what was used', async () => {
    expect((await full('meera')).batch.issued).toEqual([{ lot: 'PVP-2611', material: expect.stringContaining('Povidone'), value: '1', unit: 'kg' }]);
    const refused = async (returns?: object[]) => (await terminate('meera', { reason: 'x', ...(returns ? { returns } : {}) })).json() as { error: string; problems: string[] };
    expect(await refused()).toMatchObject({ error: 'invalid_values', problems: ['Say how much of lot PVP-2611 (MAT-003 · Povidone K30) went back to stores unused: 0 if none.'] });
    expect(await refused(back('1.5'))).toMatchObject({ problems: ['Lot PVP-2611: 1 kg was issued to this batch; 1.5 kg cannot have gone back to stores.'] });
    expect(await refused([...back('0'), { lot: 'MCC-1', value: '1', unit: 'kg' }])).toMatchObject({ problems: ['Lot MCC-1 (kg) was not issued to this batch.'] });
    expect((await terminate('meera', { reason: 'x', returns: back('-1') })).statusCode).toBe(400);
    expect((await full()).batch.status).toBe('in production');
    // In production the record says what is still to come.
    const live = await recordText(id);
    for (const t of ['not weighed yet · 2.1 Weigh a material: Examplol', '1.2 Mix for a time\nin progress |', '2.1 Weigh a material: Examplol\nnot started |']) expect(live).toContain(t);
  });

  it('TB-21 terminate frees the uses: a signed rejection; equipment_use_v1 ends every open use then, batch_fact_v1 says REJECTED', async () => {
    const res = await terminate('meera');
    expect(res.statusCode).toBe(200);
    const { eventId } = res.json() as { eventId: number };
    expect(await t.owner`select 1 from signatures where object_type = 'batch_event' and object_id = ${eventId} and meaning = 'rejected'`).toHaveLength(1);
    const [e] = await t.owner<{ at: Date; payload: object }[]>`select at, payload from batch_events where id = ${eventId}`;
    expect(e!.payload).toEqual({ terminated: true, reason: 'The stirrer broke down; the binder cannot be made',
      returns: [{ lot: 'PVP-2611', material: expect.stringContaining('Povidone'), value: '0.250', unit: 'kg' }] });
    // material_use_v1 gives back what went back to stores: MMS has it available again.
    expect(await t.owner.unsafe(`select lot_number, quantity::text, unit from ${t.schema}_report.material_use_v1 where batch_number = (select batch_no from batches where id = $1)`, [id]))
      .toEqual([{ lot_number: 'PVP-2611', quantity: '0.750', unit: 'kg' }]);
    expect(await uses()).toEqual([{ equipment_code: 'STR-01', ended_at: e!.at }]);
    const [f] = await t.owner.unsafe(`select status, released_at, released_by from ${t.schema}_report.batch_fact_v1 where batch_number = (select batch_no from batches where id = $1)`, [id]);
    expect(f).toEqual({ status: 'REJECTED', released_at: null, released_by: null });
    const b = await full();
    expect(b.batch).toMatchObject({ status: 'rejected', actions: [], terminated: { personName: 'MEERA', payload: { reason: 'The stirrer broke down; the binder cannot be made' } } });
    expect(b.steps.every((s) => !s.actions.length)).toBe(true);
    expect(b.timers).toEqual([]);
  });

  it('TB-21 actions are refused after termination; the record is kept and leaves My work and the To review list', async () => {
    expect((await act('asha', id, '0.1.1.1', 'record', { values: { speed: '310' } })).json()).toMatchObject({ error: 'batch_closed', problems: ['The batch is terminated.'] });
    expect((await act('asha', id, '0.1.1.1', 'note', { text: 'x' })).json()).toMatchObject({ error: 'batch_closed' });
    expect((await terminate('meera')).json()).toMatchObject({ error: 'not_ready', problems: ['The batch is rejected.'] });
    expect((await as('meera', 'POST', `/api/batches/${id}/reject`, { proof: proofFor('meera'), contentHash: (await full()).batch.contentHash, reason: 'x' })).statusCode).toBe(409);
    expect(((await as('meera', 'GET', '/api/batches/to-review')).json() as { id: number }[]).some((b) => b.id === id)).toBe(false);
    expect(((await as('asha', 'GET', '/api/batches')).json() as { id: number }[]).some((b) => b.id === id)).toBe(false);
    expect(await t.owner`select 1 from step_events where batch_id = ${id}`).not.toHaveLength(0);
  });

  it('TB-22 the PDF and the review show "Terminated by … at …: reason"', async () => {
    const text = await recordText(id);
    expect(text).toContain('Status | Rejected');
    expect(text.match(/Terminated by MEERA at \d{1,2} \w{3} 20\d\d, \d\d:\d\d IST: The stirrer broke down; the binder cannot be made/g)).toHaveLength(2);
    expect(text).toContain('Rejected | MEERA');
    // Nothing it never did reads as still to come (owner, 16 Nov 2026).
    for (const t of ['not weighed (terminated) · 2.1 Weigh a material: Examplol', '1.2 Mix for a time\nterminated, not finished |', '2.1 Weigh a material: Examplol\nterminated, not started |']) expect(text).toContain(t);
    expect(text).not.toMatch(/\byet\b|\nnot started|\nin progress/);
    const r = (await as('viewer', 'GET', `/api/batches/${id}/review`)).json() as { status: string; batchEvents: { kind: string; payload: object; personName: string }[] };
    expect(r).toMatchObject({ status: 'rejected', batchEvents: [{ kind: 'rejected', payload: { terminated: true }, personName: 'MEERA' }] });
  });
});

describe('the timer job', () => {
  it('TB-17 a hold time that ran out is recorded late once, and blocks the using stage until a deviation note', async () => {
    const { id } = await issue(await effectiveMaster());
    // The binder solution was made 25 hours ago (hold time 24 h).
    const [p] = await t.owner<{ id: string }[]>`select id from users where username = 'asha'`;
    const [r] = await t.owner<{ id: string }[]>`select id from users where username = 'ravi'`;
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, person_id, at) values
      (${id}, 0, 1, 0, 1, 'started', ${p!.id}, now() - interval '26 hours'), (${id}, 0, 1, 0, 1, 'done', ${p!.id}, now() - interval '26 hours'),
      (${id}, 0, 1, 0, 1, 'checked', ${r!.id}, now() - interval '26 hours'),
      (${id}, 0, 1, 1, 1, 'started', ${p!.id}, now() - interval '26 hours'), (${id}, 0, 1, 1, 1, 'done', ${p!.id}, now() - interval '25 hours')`;
    const b = await batch(id);
    expect(b.stages[1]!.blocked).toBe('Hold time of binder solution (24 h) before Granulation ran out: a deviation note is needed');
    expect(b.steps.find((s) => s.id === '1.1.0.1')!.state).toBe('waiting');
    expect(await recordLate(t.sql)).toBeGreaterThanOrEqual(1);
    expect(await recordLate(t.sql)).toBe(0);
    expect(await t.owner`select 1 from step_events where batch_id = ${id} and kind = 'late' and payload->>'timer' = 'hold:0:1' and person_id is null`).toHaveLength(1);
    expect(await code(t.sql`insert into step_events (batch_id, stage, sub, step, round, kind, payload) values (${id}, 1, 1, 0, 1, 'late', '{"timer": "hold:0:1"}')`)).toBe('23505');
    expect((await act('asha', id, '1.1.0.1', 'note', { text: 'Binder solution held 25 h; deviation raised' })).statusCode).toBe(200);
    expect((await stepOf(id, '1.1.0.1')).state).toBe('open');
  });

  it('skips a batch that is released or rejected', async () => {
    const { id } = await issue(await effectiveMaster());
    const [p] = await t.owner<{ id: string }[]>`select id from users where username = 'asha'`;
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, person_id, at) values
      (${id}, 0, 1, 1, 1, 'started', ${p!.id}, now() - interval '26 hours'), (${id}, 0, 1, 1, 1, 'done', ${p!.id}, now() - interval '25 hours')`;
    await t.owner`insert into batch_events (batch_id, kind, person_id) values (${id}, 'rejected', ${p!.id})`;
    await recordLate(t.sql);
    expect(await t.owner`select 1 from step_events where batch_id = ${id} and kind = 'late'`).toHaveLength(0);
  });
});
