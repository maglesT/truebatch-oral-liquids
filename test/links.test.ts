import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links, namesProduct, type Links } from '../server/links.js';
import { findBlock } from '../shared/blocks/index.js';
import { batchRefusal, batchView, deviationText, fieldLabel, filedKey, handFields, type BatchEvent } from '../shared/engine/index.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { at, ev, small, tablet, placed } from './engine-fixture.js';
import { inLogbook } from '../shared/engine/picks.js';

// The links to Deviations, QMS, Logbook and MMS (owner 15 Nov 2026), each read through a fake provider schema in the
// test database with TrueBatch's restricted login, as on the platform: absent (no URL), down (refused or not
// answering: people go on by hand with a second-person check) and ok (pulled, never typed over). And the views
// TrueBatch publishes for the Logbook and Deviations.

let t: TestApp;
let provider: Sql;
const S: Record<'dv' | 'qms' | 'lb' | 'mms', string> = { dv: '', qms: '', lb: '', mms: '' };
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });

beforeAll(async () => {
  t = await freshApp(async (db) => {
    for (const k of Object.keys(S) as (keyof typeof S)[]) S[k] = `${db.schema}_${k}`;
    // The planned and published views, as tables with the same columns (the providers' own contracts).
    await db.owner.unsafe(`
      create schema ${S.dv}; create schema ${S.qms}; create schema ${S.lb}; create schema ${S.mms};
      create table ${S.dv}.deviation_v1 (number text, status text, classification text, opened_at timestamptz, closed_at timestamptz, product text, batch text,
        batch_norm text, outcome text, read_at timestamptz default now(), data_as_of timestamptz default now(), title text, source_ref text);
      create table ${S.qms}.change_v1 (number text, status text, title text, products text, qa_approved_at timestamptz, closed_at timestamptz,
        read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${S.lb}.equipment_status_v1 (master_id text, code text, kind text, state text, fit_for_use boolean, blockers text[], warnings text[],
        in_use_batch text, clean_until timestamptz, cleaned_at timestamptz, cleaned_by text, calibration_due date, qualification text,
        checked_at timestamptz default now(), read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${S.mms}.lot_v1 (lot_number text, kind text, material_master_id text, material_code text, product_code text, status text, status_since timestamptz,
        expiry_date date, retest_date date, manufacturer_batch text, supplier_code text, qc_report_ref text, qc_conclusion text,
        read_at timestamptz default now(), data_as_of timestamptz default now(), stock numeric, unit text);
      create table ${S.mms}.lot_test_v1 (lot_number text, report_ref text, test text, specification text, result text, value numeric, unit text, basis text,
        tested_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now());
      grant usage on schema ${S.dv}, ${S.qms}, ${S.lb}, ${S.mms} to truebatch_app;
      grant select on all tables in schema ${S.dv}, ${S.qms}, ${S.lb}, ${S.mms} to truebatch_app;
      insert into ${S.qms}.change_v1 (number, status, title, products, qa_approved_at) values
        ('CC-2026-0001', 'implementation', 'New supplier of lactose', 'PRD-001', now()), ('CC-2026-0002', 'qa', 'Press speed', null, null),
        ('CC-2026-0003', 'rejected', 'Drop the coating', null, now()),
        ('CC-2026-0004', 'implementation', 'Larger batch of paracetamol', 'FG-PCM500 Paracetamol 500 mg tablets', now()),
        ('CC-2026-0005', 'closure', 'New sifter screen', null, now());
      insert into ${S.lb}.equipment_status_v1 (master_id, code, kind, state, fit_for_use, blockers, warnings, in_use_batch, cleaned_at, cleaned_by, checked_at) values
        ('eq-str', 'STR-01', 'equipment', 'clean', true, '{}', '{"Use allowed under exception EXC-7"}', null, null, null, now()),
        ('eq-str2', 'STR-02', 'equipment', 'dirty', false, '{"Dirty: clean and verify before the next use.","Calibration overdue."}', '{}', null, null, null, now()),
        ('eq-str3', 'STR-03', 'equipment', 'in use', true, '{}', '{}', 'XB26001', null, null, now()),
        ('eq-str4', 'STR-04', 'equipment', 'clean', true, '{}', '{}', null, null, null, now() - interval '10 minutes'),
        ('eq-bal', 'BAL-01', 'instrument', 'clean', true, '{}', '{}', null, null, null, now()),
        ('eq-rmg', 'RMG-01', 'equipment', 'clean', true, '{}', '{}', null, null, null, now()),
        ('rm-1', 'GRN-01', 'area', 'clean', true, '{}', '{}', null, '2026-11-15 05:30+00', 'CLEANER ONE', now());
      insert into ${S.mms}.lot_v1 (lot_number, kind, material_master_id, material_code, status, expiry_date, retest_date, qc_report_ref) values
        ('API-OK', 'material', 'mat-api', 'MAT-001', 'approved', '2099-01-31', null, 'QC-26-101'),
        ('API-Q', 'material', 'mat-api', 'MAT-001', 'quarantine', '2099-01-31', null, null),
        ('API-EXP', 'material', 'mat-api', 'MAT-001', 'approved', '2020-01-31', null, 'QC-19-001'),
        ('API-RT', 'material', 'mat-api', 'MAT-001', 'approved', '2099-01-31', '2021-06-30', 'QC-20-001'),
        ('API-ASIS', 'material', 'mat-api', 'MAT-001', 'approved', '2099-01-31', null, 'QC-26-102'),
        ('LAC-1', 'material', 'mat-lac', 'MAT-002', 'approved', '2099-01-31', null, 'QC-26-103');
      update ${S.mms}.lot_v1 set stock = 25, unit = 'kg' where lot_number = 'API-OK';
      insert into ${S.mms}.lot_test_v1 (lot_number, report_ref, test, result, value, unit, basis) values
        ('API-OK', 'QC-26-101', 'Assay', '99.1 %', 99.1, '%', 'dried'), ('API-OK', 'QC-26-101', 'LOD', '0.4 %', 0.4, '%', 'as is'),
        ('API-OK', 'QC-26-101', 'Identity', 'complies', null, null, null), ('API-ASIS', 'QC-26-102', 'Assay', '98.0 %', 98.0, '%', 'as is');`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_app', link: true });
    return links({ deviations: provider, qms: provider, logbook: provider, mms: provider }, { deviations: S.dv, qms: S.qms, logbook: S.lb, mms: S.mms });
  });
  t.master.products_.push({ ...item('prd-1', 'PRD-001', 'Examplol 100 mg film-coated tablets'), strength: '100 mg', dosageForm: 'tablet' },
    { ...item('p', 'P', 'P'), strength: null, dosageForm: 'tablet' });
  for (const l of tablet().formula) t.master.materials_.push({ ...item(l.materialItemId, l.code, l.name), category: null, unit: 'kg' });
  t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
  t.master.equipment_.push(...['', '2', '3', '4', '5'].map((n) => ({ ...item(`eq-str${n}`, `STR-0${n || 1}`, 'Stirrer'), kind: 'equipment' as const, type: 'stirrer', room: 'GRN-01' })),
    { ...item('eq-bal', 'BAL-01', 'Balance 60 kg'), kind: 'instrument', type: 'balance', room: 'DSP-01' },
    { ...item('eq-rmg', 'RMG-01', 'Granulator'), kind: 'equipment', type: 'granulator', room: 'GRN-01' });
  t.master.rooms_.push({ ...item('rm-1', 'GRN-01', 'Granulation room 1'), area: 'granulation', grade: 'D' });
  const people = {
    author: ['truebatch.master.author'], checker: ['truebatch.master.check'], quality: ['truebatch.master.approve'], quality2: ['truebatch.master.approve'],
    issuer: ['truebatch.batch.issue'], asha: ['truebatch.batch.operate', 'truebatch.batch.check'], ravi: ['truebatch.batch.check'],
    meera: ['truebatch.qa.release'], mona: ['truebatch.qa.release', 'truebatch.batch.operate'],
  } as const;
  for (const [name, perms] of Object.entries(people)) {
    ids[name] = await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => {
  await provider?.end();
  for (const s of Object.values(S)) if (s) await t.owner.unsafe(`drop schema if exists ${s} cascade`);
  await t?.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const cut = (schema: string) => t.owner.unsafe(`revoke select on all tables in schema ${schema} from truebatch_app`);
const restore = (schema: string) => t.owner.unsafe(`grant select on all tables in schema ${schema} to truebatch_app`);
async function issue(doc: ReturnType<typeof small>) {
  const res = await as('author', 'POST', '/api/masters', { doc });
  expect(res.statusCode).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') });
  expect(b.statusCode).toBe(200);
  return b.json() as { id: number; batchNo: string };
}
type StepJson = { id: string; state: string; values: Record<string, unknown>; source: Record<string, { from: string; state?: string; shown?: string }>;
  handFields: { name: string }[]; problems: string[]; contentHash: string; results: Record<string, { ok: boolean; message?: string }> };
const stepOf = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: StepJson[] }).steps.find((s) => s.id === key)!;
const act = (who: string, id: number, key: string, action: string, body: object = {}) => as(who, 'POST', `/api/batches/${id}/steps/${key}/${action}`, body);
const record = (id: number, key: string, values: object) => act('asha', id, key, 'record', { values });
const sign = async (who: string, id: number, key: string, action: string) => act(who, id, key, action, { proof: proofFor(who), contentHash: (await stepOf(id, key)).contentHash });
const problems = async (p: ReturnType<typeof record>) => ((await p).json() as { problems: string[] }).problems;
const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };

describe('the link client: absent, down (refused or not answering) and ok', () => {
  const reads = (l: Links) => [l.deviations.byNumbers(['DEV-1']), l.qms.change('CC-2026-0001'), l.logbook.status('eq-str'), l.mms.lot('API-OK')];

  it('absent: no URL (not licensed, or the link is off) reads nothing', async () => {
    expect((await Promise.all(reads(links()))).map((r) => r.state)).toEqual(['absent', 'absent', 'absent', 'absent']);
  });

  it('ok: the rows as the provider has them now, nothing copied', async () => {
    const [d, q, l, m] = await Promise.all(reads(t.app.links));
    expect([d!.state, q!.state, l!.state, m!.state]).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(q).toMatchObject({ value: { number: 'CC-2026-0001', status: 'implementation', title: 'New supplier of lactose' } });
    expect(l).toMatchObject({ value: { code: 'STR-01', fitForUse: true, warnings: ['Use allowed under exception EXC-7'] } });
    expect(m).toMatchObject({ value: { lotNumber: 'API-OK', status: 'approved', tests: [{ test: 'Assay', value: '99.1', basis: 'dried' }, { test: 'LOD', value: '0.4' }] } });
    await t.owner.unsafe(`update ${S.qms}.change_v1 set title = 'Second lactose supplier' where number = 'CC-2026-0001'`);
    expect(await t.app.links.qms.change('CC-2026-0001')).toMatchObject({ value: { title: 'Second lactose supplier' } });
  });

  it('down: a refused read (grant revoked, view missing) or a provider that does not answer', async () => {
    for (const s of Object.values(S)) await cut(s);
    try {
      expect((await Promise.all(reads(t.app.links))).map((r) => r.state)).toEqual(['down', 'down', 'down', 'down']);
    } finally {
      for (const s of Object.values(S)) await restore(s);
    }
    const gone = links({ deviations: provider, qms: provider, logbook: provider, mms: provider }, { deviations: 'nope', qms: 'nope', logbook: 'nope', mms: 'nope' });
    expect((await Promise.all(reads(gone))).map((r) => r.state)).toEqual(['down', 'down', 'down', 'down']);
    const nowhere = connect('postgres://truebatch_app:x@127.0.0.1:1/x', { link: true });
    expect((await Promise.all(reads(links({ deviations: nowhere, qms: nowhere, logbook: nowhere, mms: nowhere })))).map((r) => r.state)).toEqual(['down', 'down', 'down', 'down']);
    await nowhere.end();
  });
});

describe('the labels people saw', () => {
  it('a label question shows its label, not its name, wherever it is listed, and whether the link is back or not', () => {
    const weigh = findBlock({ id: 'weigh', version: 1 })!.fields;
    expect(fieldLabel(weigh, 'balance')).toBe('Balance');
    expect(fieldLabel(weigh, 'balance.inService')).toBe('Balance: not tagged out of service, maintenance in date');
    expect(fieldLabel(weigh, 'lot.expiry')).toBe('Lot: expiry or retest date on the label, whichever is first');
    // The same text as the question the operator answered.
    const hand = handFields(weigh, { balance: { from: 'hand', link: 'logbook', state: 'down' }, lot: { from: 'hand', link: 'mms', state: 'absent' } });
    for (const q of hand) expect(fieldLabel(weigh, q.name)).toBe(q.label);
    expect(fieldLabel(weigh, 'balance.unknown')).toBe('balance.unknown');
  });
});

describe('TB-11 Logbook: equipment and rooms fit for use', () => {
  let b: { id: number; batchNo: string };
  beforeAll(async () => {
    b = await issue(small([{ machineTypes: ['stirrer'], steps: [{ block: { id: 'line-clearance', version: 1 }, checker: true, settings: {} },
      { block: { id: 'mix', version: 1 }, settings: {} }, yieldStep] }]));
  });

  it('TB-10 line clearance: the room\'s cleaning facts are pulled from the Logbook and cannot be typed over', async () => {
    await act('asha', b.id, '0.1.0.1', 'start');
    expect((await record(b.id, '0.1.0.1', { room: 'rm-1' })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values).toMatchObject({ room: { code: 'GRN-01' }, clean: 'yes', cleanedBy: 'CLEANER ONE' });
    expect(s.values.cleanedOn).toMatch(/^2026-11-15 05:30/);
    expect(s.source.cleanedBy).toMatchObject({ from: 'logbook' });
    expect(s.handFields).toEqual([]);
    expect(await problems(record(b.id, '0.1.0.1', { cleanedBy: 'SOMEONE ELSE' }))).toEqual(['Cleaned by (name on the label) comes from Logbook and cannot be typed over']);
    expect((await record(b.id, '0.1.0.1', { previousRemoved: 'yes', noOther: 'yes' })).statusCode).toBe(200);
    expect((await sign('asha', b.id, '0.1.0.1', 'done')).statusCode).toBe(200);
  });

  it('TB-11 while the Logbook answers, the machine and room pickers offer only what it has (an empty one names the rest); absent or down, every one', async () => {
    const read = async () => (await as('asha', 'GET', '/api/logbook/items')).json() as { link: string; items: string[] };
    const r = await read();
    expect(r.link).toBe('ok');
    expect([...r.items].sort()).toEqual(['eq-bal', 'eq-rmg', 'eq-str', 'eq-str2', 'eq-str3', 'eq-str4', 'rm-1']);
    const stirrers = t.master.equipment_.filter((m) => m.type === 'stirrer');
    const picks = inLogbook(stirrers, r.items);
    expect(picks.offered.map((m) => m.code)).toEqual(['STR-01', 'STR-02', 'STR-03', 'STR-04']);
    // A picker with choices has no note; an empty one names what the Logbook does not have.
    expect(picks.note).toBeNull();
    expect(inLogbook(stirrers.filter((m) => m.code === 'STR-05'), r.items)).toEqual({ offered: [],
      note: 'Not offered, because the Logbook does not have it: STR-05. Only what the Logbook has can be used while it is linked.' });
    expect(inLogbook(t.master.rooms_, r.items).offered.map((x) => x.code)).toEqual(['GRN-01']);
    await cut(S.lb);
    try {
      expect(await read()).toEqual({ link: 'down', items: [] });
    } finally { await restore(S.lb); }
    expect(inLogbook(stirrers, null)).toEqual({ offered: stirrers, note: null });
    expect((await call(t.app, '', 'GET', '/api/logbook/items')).statusCode).toBe(401);
  });

  it('TB-11 a machine the Logbook says is not fit for use is refused with the Logbook\'s reasons; one in use by another batch too', async () => {
    await act('asha', b.id, '0.1.1.1', 'start');
    expect(await problems(record(b.id, '0.1.1.1', { machine: 'eq-str2' }))).toEqual(['STR-02 is not fit for use (Logbook): Dirty: clean and verify before the next use; Calibration overdue.']);
    expect(await problems(record(b.id, '0.1.1.1', { machine: 'eq-str3' }))).toEqual(['STR-03 is in use by batch XB26001 (Logbook).']);
    expect(await problems(record(b.id, '0.1.1.1', { machine: 'eq-str5' }))).toEqual(['STR-05 is not in the Logbook, so it cannot be used.']);
  });

  it('TB-11 a machine fit for use is pulled with its status: no label questions, no extra check', async () => {
    expect((await record(b.id, '0.1.1.1', { machine: 'eq-str', speed: '300' })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.1.1');
    expect(s.source.machine).toMatchObject({ from: 'logbook', shown: 'STR-01: clean; Use allowed under exception EXC-7' });
    expect(s.handFields).toEqual([]);
    expect((await sign('asha', b.id, '0.1.1.1', 'done')).statusCode).toBe(200);
    expect((await stepOf(b.id, '0.1.1.1')).state).toBe('done');
  });

  it('TB-11 Logbook down or its status too old: the label questions, answered yes, and a second-person check', async () => {
    const c = await issue(small([{ machineTypes: ['stirrer'], steps: [{ block: { id: 'mix', version: 1 }, settings: {} }, yieldStep] }]));
    await act('asha', c.id, '0.1.0.1', 'start');
    expect((await record(c.id, '0.1.0.1', { machine: 'eq-str4', speed: '300' })).statusCode).toBe(200);
    expect((await stepOf(c.id, '0.1.0.1')).source.machine).toEqual({ from: 'hand', link: 'logbook', state: 'down' });
    await cut(S.lb);
    try {
      expect((await record(c.id, '0.1.0.1', { machine: 'eq-str' })).statusCode).toBe(200);
    } finally { await restore(S.lb); }
    const s = await stepOf(c.id, '0.1.0.1');
    expect(s.handFields.map((f) => f.name)).toEqual(['machine.clean', 'machine.calibrated', 'machine.inService', 'machine.qualified']);
    expect(s.problems).toContain('Mixer: the calibration label is in date is not recorded');
    expect(await problems(record(c.id, '0.1.0.1', { 'machine.calibrated': 'no' }))).toEqual(['Mixer: the calibration label is in date: if not, do not use it; use another, or raise a deviation.']);
    expect((await record(c.id, '0.1.0.1', handLabels('machine', 'machine'))).statusCode).toBe(200);
    expect((await sign('asha', c.id, '0.1.0.1', 'done')).statusCode).toBe(200);
    expect((await stepOf(c.id, '0.1.0.1')).state).toBe('done_awaiting_check');
    expect((await sign('asha', c.id, '0.1.0.1', 'check')).json()).toMatchObject({ error: 'own_work' });
    expect((await sign('ravi', c.id, '0.1.0.1', 'check')).statusCode).toBe(200);
    // QA sees every hand entry and why.
    const r = (await as('meera', 'GET', `/api/batches/${c.id}/review`)).json() as { hand: { step: string; field: string; link: string; state: string; personName: string }[] };
    expect(r.hand).toMatchObject([{ step: '0.1.0.1', field: 'machine', link: 'logbook', state: 'down', personName: 'ASHA' }, { field: 'machine', state: 'down' }]);
  });

  it('TB-11 after an antibiotic only that product may follow until the Logbook verifies a product-changeover cleaning (its only_product); a view without the column reads as any product', async () => {
    // The stand-in view has no only_product yet (as the Logbook's before it was appended): read as null.
    expect(await t.app.links.logbook.status('eq-str')).toMatchObject({ state: 'ok', value: { code: 'STR-01', onlyProduct: null } });
    await t.owner.unsafe(`alter table ${S.lb}.equipment_status_v1 add column only_product text`);
    try {
      await t.owner.unsafe(`update ${S.lb}.equipment_status_v1 set only_product = 'FG-PWD-EXC1' where master_id = 'eq-str'`);
      const c = await issue(small([{ machineTypes: ['stirrer'], steps: [{ block: { id: 'mix', version: 1 }, settings: {} }, yieldStep] }]));
      await act('asha', c.id, '0.1.0.1', 'start');
      expect(await problems(record(c.id, '0.1.0.1', { machine: 'eq-str' }))).toEqual(
        ['STR-01 was last used for an antibiotic (FG-PWD-EXC1): a product-changeover cleaning is needed in the Logbook before P.']);
      // The same product follows: allowed, pulled.
      await t.owner.unsafe(`update ${S.lb}.equipment_status_v1 set only_product = 'P' where master_id = 'eq-str'`);
      expect((await record(c.id, '0.1.0.1', { machine: 'eq-str', speed: '300' })).statusCode).toBe(200);
      expect((await stepOf(c.id, '0.1.0.1')).source.machine).toMatchObject({ from: 'logbook' });
      // Logbook down: by hand, as before.
      await t.owner.unsafe(`update ${S.lb}.equipment_status_v1 set only_product = 'FG-PWD-EXC1' where master_id = 'eq-str'`);
      await cut(S.lb);
      try {
        expect((await record(c.id, '0.1.0.1', { machine: 'eq-str' })).statusCode).toBe(200);
      } finally { await restore(S.lb); }
      expect((await stepOf(c.id, '0.1.0.1')).source.machine).toEqual({ from: 'hand', link: 'logbook', state: 'down' });
    } finally {
      await t.owner.unsafe(`alter table ${S.lb}.equipment_status_v1 drop column only_product`);
    }
  });
});

describe('TB-12 MMS: only released, in-date lots of the material; certificate values pulled', () => {
  let b: { id: number; batchNo: string };
  const granulation = () => {
    const d = tablet();
    const g = d.stages[1]!;
    d.stages = [{ ...g, uses: [], steps: [g.steps[0]!, g.steps[2]!, g.steps[6]!] }];
    return d;
  };
  beforeAll(async () => {
    b = await issue(granulation());
    await act('asha', b.id, '0.1.0.1', 'start');
  });

  it.each([
    ['NOPE', 'Lot NOPE is not in MMS.'],
    ['LAC-1', 'Lot LAC-1 is MAT-002 in MMS, not MAT-001 Examplol.'],
    ['API-Q', 'Lot API-Q is in quarantine in MMS: only a released lot may be used.'],
    ['API-EXP', 'Lot API-EXP expired on 31 Jan 2020.'],
    ['API-RT', 'Lot API-RT is past its retest date 30 Jun 2021.'],
    ['API-ASIS', "MMS gives the assay of lot API-ASIS on the as is basis; the master's line is on the dried basis."],
  ])('TB-12 lot %s is refused: %s', async (lot, why) => {
    expect(await problems(record(b.id, '0.1.0.1', { lot }))).toContain(why);
  });

  it('TB-13 a released lot brings its assay and LOD from MMS (pull only): they cannot be typed', async () => {
    expect(await problems(record(b.id, '0.1.0.1', { assay: '99.0' }))).toEqual(['Assay (certificate): record the lot first']);
    expect((await record(b.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '11.000', tare: '0.850' })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values).toMatchObject({ lot: 'API-OK', assay: { value: '99.1', unit: '%' }, lod: { value: '0.4', unit: '%' } });
    expect(s.source.lot).toMatchObject({ from: 'mms', shown: 'MMS lot API-OK: approved, expiry 2099-01-31, retest —, QC report QC-26-101' });
    expect(s.source.assay).toMatchObject({ from: 'mms', shown: 'assay 99.1 % (dried), report QC-26-101' });
    expect(s.results.target).toMatchObject({ ok: true });
    expect(s.handFields).toEqual([]);
    expect(await problems(record(b.id, '0.1.0.1', { assay: '101.0' }))).toEqual(['Assay (certificate) comes from MMS and cannot be typed over']);
    expect(await problems(record(b.id, '0.1.0.1', { water: '1.0' }))).toEqual(['Water content (certificate) comes from MMS with the lot and cannot be typed']);
  });

  it('the pick list offers the lots of the material MMS has released and in date', async () => {
    const r = (await as('asha', 'GET', '/api/mms/lots?material=mat-api')).json() as { link: string; lots: { lotNumber: string }[] };
    expect(r).toMatchObject({ link: 'ok' });
    expect(r.lots.map((l) => l.lotNumber)).toEqual(['API-ASIS', 'API-OK']);
  });

  it('TB-12 MMS down: the lot is typed with its label status and date, refused when expired or not released, and checked', async () => {
    expect((await sign('asha', b.id, '0.1.0.1', 'done')).statusCode).toBe(200);
    await act('asha', b.id, '0.1.1.1', 'start');
    await cut(S.mms);
    try {
      const charge = { lot: 'API-OK', machine: 'eq-rmg', allCharged: 'yes' };
      expect(await problems(record(b.id, '0.1.1.1', { ...charge, 'lot.released': 'yes', 'lot.expiry': '2020-01-31' })))
        .toEqual(['The lot expired or passed its retest date on 31 Jan 2020: it may not be used.']);
      expect(await problems(record(b.id, '0.1.1.1', { ...charge, 'lot.released': 'no', 'lot.expiry': '2099-01-31' })))
        .toEqual(['Lot charged: the label says RELEASED (approved by QC): if not, do not use it; use another, or raise a deviation.']);
      expect((await record(b.id, '0.1.1.1', { ...charge, ...handLabels('lot', 'lot') })).statusCode).toBe(200);
    } finally { await restore(S.mms); }
    const s = await stepOf(b.id, '0.1.1.1');
    expect(s.source.lot).toEqual({ from: 'hand', link: 'mms', state: 'down' });
    expect(s.values).toMatchObject({ 'lot.released': 'yes', 'lot.expiry': '2099-12-31' });
    const r = (await as('meera', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string }[] };
    expect(r.hand).toMatchObject([{ field: 'lot', link: 'mms' }]);
  });

  it('TB-12 a lot typed by hand after an MMS lot: its certificate values are typed from its label, not refused as the earlier lot\'s from MMS', async () => {
    const c = await issue(granulation());
    await act('asha', c.id, '0.1.0.1', 'start');
    expect((await record(c.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '1.000', tare: '0.850' })).statusCode).toBe(200);
    expect((await stepOf(c.id, '0.1.0.1')).source.assay).toMatchObject({ from: 'mms' });
    await cut(S.mms);
    try {
      const r = await record(c.id, '0.1.0.1', { lot: 'API-OK', ...handLabels('lot', 'lot'), assay: '98.5' });
      expect(r.statusCode, r.body).toBe(200);
    } finally { await restore(S.mms); }
    const s = await stepOf(c.id, '0.1.0.1');
    expect(s.source.lot).toEqual({ from: 'hand', link: 'mms', state: 'down' });
    expect(s.source.assay).toBeUndefined();   // typed from the label, no longer MMS's
    expect(s.values).toMatchObject({ assay: { value: '98.5', unit: '%' } });
  });

  it('TB-12 the previous lot\'s certificate value is never signed with a new lot: the step waits until it is recorded for it', async () => {
    const c = await issue(granulation());
    await act('asha', c.id, '0.1.0.1', 'start');
    expect((await record(c.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '1.000', tare: '0.850' })).statusCode).toBe(200);
    await cut(S.mms);
    try {
      // Only the new lot typed, with its label: the step still holds API-OK's assay and LOD from MMS.
      expect((await record(c.id, '0.1.0.1', { lot: 'API-NEW', ...handLabels('lot', 'lot') })).statusCode).toBe(200);
      const stale = JSON.stringify((await sign('asha', c.id, '0.1.0.1', 'done')).json());
      expect(stale).toMatch(/Assay \(certificate\) is the previous lot's: record it for lot API-NEW/);
      // Typed from the new lot's label (allowed while the lot is typed by hand); the same lot picked again is not a new lot.
      { const r = await record(c.id, '0.1.0.1', { assay: '98.5', lod: '0.5' }); expect(r.statusCode, r.body).toBe(200); }
      expect((await record(c.id, '0.1.0.1', { lot: 'API-NEW' })).statusCode).toBe(200);
      expect(JSON.stringify((await sign('asha', c.id, '0.1.0.1', 'done')).json())).not.toMatch(/previous lot/);
    } finally { await restore(S.mms); }
    const s = await stepOf(c.id, '0.1.0.1');
    expect(s.source.lot).toEqual({ from: 'hand', link: 'mms', state: 'down' });
    expect(s.values).toMatchObject({ lot: 'API-NEW', assay: { value: '98.5', unit: '%' } });
  });

  it('TB-12 a second lot typed by hand after a first one: its label date is the first lot\'s until recorded again', async () => {
    const c = await issue(granulation());
    await act('asha', c.id, '0.1.0.1', 'start');
    await cut(S.mms);
    try {
      expect((await record(c.id, '0.1.0.1', { lot: 'API-A', ...handLabels('lot', 'lot'), assay: '99.0', lod: '0.4', balance: 'eq-bal', gross: '1.000', tare: '0.850' })).statusCode).toBe(200);
      expect((await record(c.id, '0.1.0.1', { lot: 'API-B' })).statusCode).toBe(200);
      expect(JSON.stringify((await sign('asha', c.id, '0.1.0.1', 'done')).json())).toMatch(/is the previous lot's: record it for lot API-B/);
    } finally { await restore(S.mms); }
  });

  it('TB-11 a balance is shared by the batches weighing on it: it is no use in equipment_use_v1, so the next weighing on it is not refused', async () => {
    const uses = async (code: string) => (await t.owner.unsafe(`select batch_number from ${t.schema}_report.equipment_use_v1 where equipment_code = $1`, [code])).map((r) => r.batch_number);
    // The weighing above was signed on BAL-01; the charge's mixer is a use of the batch.
    expect(await uses('BAL-01')).toEqual([]);
    expect(await uses('RMG-01')).toEqual([b.batchNo]);
    // Another batch weighs on BAL-01 at once, and the Logbook (its status unchanged: clean, in use by no batch) lets it.
    const other = await issue(granulation());
    await act('asha', other.id, '0.1.0.1', 'start');
    expect((await record(other.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '11.000', tare: '0.850' })).statusCode).toBe(200);
    expect((await stepOf(other.id, '0.1.0.1')).values.balance).toMatchObject({ code: 'BAL-01', type: 'balance' });
    expect(await uses('BAL-01')).toEqual([]);
  });

  it('TB-12 a weighing takes no more of a lot than MMS shows available: its stock less what TrueBatch Tablets already dispensed (signed) from it', async () => {
    // API-OK: 25 kg in MMS; 10.150 kg dispensed above (signed done); the other batch's weighing is not signed yet.
    const third = await issue(granulation());
    await act('asha', third.id, '0.1.0.1', 'start');
    expect(await problems(record(third.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '16.000', tare: '0.850' }))).toEqual([
      'Lot API-OK has 14.85 kg available in MMS (25 kg in stock less 10.15 kg already used in TrueBatch Tablets): 15.15 kg cannot be taken from it. Take at most 14.85 kg, or another lot.']);
    expect((await record(third.id, '0.1.0.1', { lot: 'API-OK', balance: 'eq-bal', gross: '15.000', tare: '0.850' })).statusCode).toBe(200);
  });
});

describe('TB-21 Deviations: the deviation number and its status come from the Deviations system', () => {
  let b: { id: number; batchNo: string };
  const devs = async () => ((await as('meera', 'GET', `/api/batches/${b.id}`)).json() as { batch: { deviations: { reference: string; open: boolean; status?: string }[]; deviationsLink: string } }).batch;
  beforeAll(async () => {
    b = await issue(small([{ steps: [{ checker: true }, yieldStep] }]));
    await t.owner.unsafe(`insert into ${S.dv}.deviation_v1 (number, status, batch, batch_norm, title) values
      ('DEV-26-0001', 'investigation', '${b.batchNo}', '${b.batchNo.toLowerCase()}', 'pH out of limits'),
      ('DEV-26-0099', 'classification', '${b.batchNo}', '${b.batchNo.toLowerCase()}', 'Label torn'),
      ('DEV-26-0500', 'closed', 'OTHER1', 'other1', 'Another batch')`);
  });

  it('a note\'s reference must be a deviation in the Deviations system; the pick list holds the deviations naming the batch', async () => {
    const picks = (await as('asha', 'GET', `/api/batches/${b.id}/deviations`)).json() as { link: string; deviations: { number: string }[] };
    expect(picks.deviations.map((d) => d.number)).toEqual(['DEV-26-0001', 'DEV-26-0099']);
    expect((await act('asha', b.id, '0.1.0.1', 'note', { text: 'pH 7.4', reference: 'DEV-26-9999' })).json())
      .toMatchObject({ error: 'unknown_deviation', problems: ['DEV-26-9999 is not in the Deviations system: pick one of the deviations of this batch, or check the number.'] });
    expect((await act('asha', b.id, '0.1.0.1', 'note', { text: 'pH 7.4', reference: 'DEV-26-0001' })).statusCode).toBe(200);
  });

  it('TB-21 its status is Deviations\' while the link answers: QA cannot close it by hand, and an unlinked deviation is shown', async () => {
    expect(await devs()).toMatchObject({ deviationsLink: 'ok', deviations: [{ reference: 'DEV-26-0001', open: true, status: 'investigation' }] });
    const note = ((await as('meera', 'GET', `/api/batches/${b.id}/review`)).json() as { deviations: { note: number }[]; unlinked: { number: string }[] });
    expect(note.unlinked.map((d) => d.number)).toEqual(['DEV-26-0099']);
    expect((await as('meera', 'POST', `/api/batches/${b.id}/close-deviation`, { note: note.deviations[0]!.note, reason: 'Closed' })).json())
      .toMatchObject({ problems: ['The status of DEV-26-0001 comes from the Deviations system (now under investigation): it is closed there.'] });
    await t.owner.unsafe(`update ${S.dv}.deviation_v1 set status = 'closed', closed_at = now() where number = 'DEV-26-0001'`);
    expect(await devs()).toMatchObject({ deviations: [{ reference: 'DEV-26-0001', open: false, status: 'closed' }] });
  });

  it('TB-21 release is blocked until Deviations has the deviation closed (the server passes the statuses in)', () => {
    const doc = small([{ steps: [{ checker: true }] }]);
    const events = [ev('started', '0.1.0.1', { min: 1 }), ev('done', '0.1.0.1', { min: 2 }), ev('checked', '0.1.0.1', { person: 2, min: 3 }),
      ev('note', '0.1.0.1', { min: 4, payload: { text: 'pH', reference: 'DEV-26-001' } })];
    const approved: BatchEvent[] = [{ id: 1, kind: 'production_approved', payload: {}, person: 3, at: at(5) }, { id: 2, kind: 'qc_approved', payload: { reportNo: 'QC-1' }, person: 4, at: at(6) }];
    const qa = { id: 9, permissions: ['truebatch.qa.release'] };
    const release = (status: string) => batchRefusal('release', batchView(doc, events, approved, at(10), new Map([['DEV-26-001', { status, closedAt: null }]])), qa)?.problems ?? null;
    expect(release('investigation')).toEqual(['Deviation DEV-26-001 (Stage 0 › Check a value against limits: pH) is still open in the Deviations system (under investigation): it is closed there first']);
    expect(release('closed')).toBeNull();
    expect(release('rejected')).toBeNull();
  });

  it('TB-21 Deviations down: the number is typed, and a QA person other than the one who typed it closes it by hand', async () => {
    await cut(S.dv);
    try {
      expect((await act('mona', b.id, '0.1.0.1', 'note', { text: 'Second pH reading', reference: 'DEV-PAPER-7' })).statusCode).toBe(200);
      const d = await devs();
      expect(d.deviationsLink).toBe('down');
      const typed = d.deviations.find((x) => x.reference === 'DEV-PAPER-7') as unknown as { note: number; open: boolean };
      expect(typed.open).toBe(true);
      expect((await as('mona', 'POST', `/api/batches/${b.id}/close-deviation`, { note: typed.note, reason: 'Closed on paper' })).json())
        .toMatchObject({ error: 'own_work', problems: ['You typed this deviation number: another QA person closes it.'] });
      expect((await as('meera', 'POST', `/api/batches/${b.id}/close-deviation`, { note: typed.note, reason: 'Closed in the deviation system on 15 Nov' })).statusCode).toBe(200);
      const r = (await as('meera', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string; state: string; personName: string }[] };
      expect(r.hand).toMatchObject([{ field: 'reference', link: 'deviations', state: 'down', personName: 'MONA' }]);
    } finally { await restore(S.dv); }
  });
});

describe('TB-02 QMS: a new master version needs a QA-approved change control', () => {
  const draft = async () => {
    const { id } = (await as('author', 'POST', '/api/masters', { doc: placed(tablet()) })).json() as { id: number };
    const hash = async (who: string) => ((await as(who, 'GET', `/api/master-versions/${id}/review`)).json() as { contentHash: string }).contentHash;
    const review = async (who: string, action: string, extra: object = {}) =>
      as(who, 'POST', `/api/master-versions/${id}/${action}`, { proof: proofFor(who), contentHash: await hash(who), ...extra });
    await review('author', 'submit');
    await review('checker', 'pass');
    return { id, review };
  };

  it('TB-02 the change control must be in QMS and approved by QA; its title and approval are kept', async () => {
    const { id, review } = await draft();
    expect((await review('quality', 'approve', { changeControl: 'CC-404' })).json()).toMatchObject({ error: 'unknown_change_control' });
    expect((await review('quality', 'approve', { changeControl: 'CC-2026-0002' })).json())
      .toMatchObject({ error: 'change_not_approved', message: 'CC-2026-0002 is at the step “qa” in QMS and not approved by QA: only a QA-approved change control (implementation, closure, closed) can carry a new version.' });
    expect((await review('quality', 'approve', { changeControl: 'CC-2026-0003' })).json()).toMatchObject({ error: 'change_not_approved' });
    expect((await review('quality', 'approve', { changeControl: 'CC-2026-0001' })).statusCode).toBe(200);
    const [e] = await t.owner<{ payload: { source: { changeControl: { from: string; shown: string } } } }[]>`
      select payload from master_events where version_id = ${id} and kind = 'approved'`;
    expect(e!.payload.source.changeControl).toMatchObject({ from: 'qms', shown: expect.stringMatching(/^CC-2026-0001: Second lactose supplier \(implementation, QA approved /) });
    // Pulled from QMS: the approver may make it effective.
    expect((await as('quality', 'POST', `/api/master-versions/${id}/make-effective`, {})).statusCode).toBe(200);
    const picks = (await as('quality', 'GET', '/api/change-controls')).json() as { changes: { number: string }[] };
    expect(picks.changes.map((c) => c.number)).toEqual(['CC-2026-0005', 'CC-2026-0004', 'CC-2026-0001']);
  });

  it('TB-02 only a change control naming the master\'s product is offered and accepted; one naming no product is taken with a warning', async () => {
    const { id, review } = await draft();
    const picks = (await as('quality', 'GET', `/api/change-controls?version=${id}`)).json() as { changes: { number: string; names: string }[] };
    expect(picks.changes.map((c) => [c.number, c.names])).toEqual([['CC-2026-0005', 'none'], ['CC-2026-0001', 'yes']]);
    expect((await review('quality', 'approve', { changeControl: 'CC-2026-0004' })).json()).toMatchObject({ error: 'other_product',
      message: 'CC-2026-0004 is for FG-PCM500 Paracetamol 500 mg tablets in QMS, not for PRD-001 Examplol 100 mg film-coated tablets: pick the change control of this product.' });
    expect((await review('quality', 'approve', { changeControl: 'CC-2026-0005' })).statusCode).toBe(200);
    const [e] = await t.owner<{ payload: { source: { changeControl: { shown: string } } } }[]>`select payload from master_events where version_id = ${id} and kind = 'approved'`;
    expect(e!.payload.source.changeControl.shown).toMatch(/QMS names no product: QA checked that it covers PRD-001$/);
    const c = (products: string | null) => ({ number: 'CC', status: 'closed', title: null, qaApprovedAt: 'x', products });
    const prd = { productCode: 'FG-ATV20', productName: 'Atorvastatin calcium tablets 20 mg' };
    expect([c('fg-atv20, FG-ATV40'), c('ATORVASTATIN CALCIUM TABLETS 20 MG'), c('FG-ATV200'), c(' '), c(null)].map((x) => namesProduct(x, prd))).toEqual(['yes', 'yes', 'no', 'none', 'none']);
  });

  it('TB-02 QMS down: the number is typed, and another person makes the version effective', async () => {
    const { id, review } = await draft();
    await cut(S.qms);
    try {
      expect((await review('quality', 'approve', { changeControl: 'CC-PAPER-9' })).statusCode).toBe(200);
    } finally { await restore(S.qms); }
    expect((await as('quality', 'POST', `/api/master-versions/${id}/make-effective`, {})).json()).toMatchObject({ error: 'same_person' });
    expect((await as('quality2', 'POST', `/api/master-versions/${id}/make-effective`, {})).statusCode).toBe(200);
  });
});

describe('the views TrueBatch publishes', () => {
  const rep = () => `${t.schema}_report`;
  const columns = async (view: string) => (await t.owner<{ c: string }[]>`
    select column_name || ' ' || data_type as c from information_schema.columns where table_schema = ${rep()} and table_name = ${view} order by ordinal_position`).map((r) => r.c);

  it('batch_fact_v1 and equipment_use_v1 have the names and columns of Batchwright\'s, as the Logbook and Deviations read them', async () => {
    // Batchwright's columns, in its order, as on the platform demo database; then TrueBatch's own manufactured_on, added
    // at the end only (0007), so every reader that selects Batchwright's named columns reads TrueBatch unchanged.
    const batchwright = ['batch_id uuid', 'batch_number text', 'product_code text', 'strength text', 'mbr_version_id uuid', 'family_code text',
      'record_kind text', 'status text', 'issued_at timestamp with time zone', 'completed_at timestamp with time zone', 'released boolean',
      'read_at timestamp with time zone', 'data_as_of timestamp with time zone'];
    expect(await columns('batch_fact_v1')).toEqual([...batchwright, 'manufactured_on date', 'product_name text', 'master_version integer',
      'good_quantity numeric', 'good_unit text', 'yield_percent numeric', 'released_at timestamp with time zone', 'released_by text']);
    expect(await columns('equipment_use_v1')).toEqual(['batch_number text', 'equipment_code text', 'equipment_type text', 'room_code text', 'step text',
      'started_at timestamp with time zone', 'ended_at timestamp with time zone', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone', 'step_name text']);
    expect(await columns('deviation_note_v1')).toEqual(['note_id bigint', 'source_ref text', 'batch_number text', 'product_code text', 'step text', 'note text',
      'reference text', 'status text', 'noted_at timestamp with time zone', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone']);
  });

  it('the Logbook\'s and Deviations\' own queries read TrueBatch batches, the equipment they used and the notes', async () => {
    const r = rep();
    // The Logbook's batch list (server/batches.ts COLS and IN_PRODUCTION) and "used on".
    const batches = await t.owner.unsafe(`select batch_number, product_code, strength, status, issued_at::text, completed_at::text, coalesce(released, false) as released,
      (completed_at is null and not coalesce(released, false) and status !~* '(complete|review|releas|reject|cancel|clos|destroy|abort)') as in_production
      from ${r}.batch_fact_v1 order by issued_at desc nulls last, batch_number limit 500`);
    expect(batches.length).toBeGreaterThanOrEqual(4);
    expect(batches[0]).toMatchObject({ product_code: 'P', status: 'IN_PRODUCTION', released: false, in_production: true, completed_at: null });
    const used = await t.owner.unsafe(`select distinct batch_number from ${r}.equipment_use_v1 where upper(equipment_code) = any($1) or upper(room_code) = any($1)`, [['STR-01']]);
    expect(used.length).toBeGreaterThanOrEqual(2);
    // Deviations' batch findings (server/readers/batchwright.ts).
    const uses = await t.owner.unsafe(`select batch_number, equipment_code, equipment_type, room_code, step, started_at, ended_at from ${r}.equipment_use_v1 x
      where equipment_code = 'STR-01' order by batch_number, started_at nulls last limit 1000`);
    expect(uses[0]).toMatchObject({ equipment_code: 'STR-01', equipment_type: 'stirrer', room_code: 'GRN-01', step: 's0/t1' });
    expect(uses[0]!.started_at).toBeInstanceOf(Date);
    const facts = await t.owner.unsafe(`select batch_number, product_code, strength, family_code, status, issued_at, completed_at, released from ${r}.batch_fact_v1`);
    expect(facts.length).toBe(batches.length);
    const notes = await t.owner.unsafe(`select source_ref, step, note, reference, status from ${r}.deviation_note_v1 where reference is not null order by note_id`);
    expect(notes.map((n) => [n.reference, n.status])).toEqual([['DEV-26-0001', 'open'], ['DEV-PAPER-7', 'closed']]);
    expect(notes[0]!.source_ref).toMatch(/^truebatch:note:\d+$/);
    // A deviation filed from a note is titled with where it was written, in words, not the master's keys.
    expect(notes[0]!.step).toBe('Stage 0 › Check a value against limits: pH');
  });

  it('TB-P8 batch_fact_v1.manufactured_on, the date of manufacture, is the plant-time date the first processing step started, not the issue date; null before any step started', async () => {
    const [b] = await t.owner<{ mv: number; by: number }[]>`select master_version_id::int as mv, issued_by::int as by from batches order by id limit 1`;
    const made = async (batchNo: string) => (await t.owner<{ id: number }[]>`
      insert into batches (batch_no, master_version_id, issued_by, issued_at) values (${batchNo}, ${b!.mv}, ${b!.by}, '2026-10-30 10:00+00') returning id::int`)[0]!.id;
    const started = await made('MFG-STARTED');
    await made('MFG-NOT-STARTED');
    // A timer finding before the first start is no start; the first start is 20:00 UTC on 2 Nov, 01:30 on 3 Nov in plant time.
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at) values
      (${started}, 0, 1, 0, 1, 'late', '{"timer":"mfg-test"}', null, '2026-10-31 08:00+00'),
      (${started}, 1, 1, 0, 1, 'started', '{}', ${b!.by}, '2026-11-04 08:00+00'),
      (${started}, 0, 1, 0, 1, 'started', '{}', ${b!.by}, '2026-11-02 20:00+00'),
      (${started}, 0, 1, 0, 1, 'value', '{}', ${b!.by}, '2026-11-02 21:00+00')`;
    const rows = await t.owner.unsafe(`select batch_number, issued_at::date::text as issued, manufactured_on::text from ${rep()}.batch_fact_v1 where batch_number like 'MFG-%' order by batch_number`);
    expect(rows).toEqual([{ batch_number: 'MFG-NOT-STARTED', issued: '2026-10-30', manufactured_on: null }, { batch_number: 'MFG-STARTED', issued: '2026-10-30', manufactured_on: '2026-11-03' }]);
  });

  it('batch_fact_v1 gives the batch\'s output (for OEE and packing): the good tablets and the yield of its tablet reconciliation, once that step is done; null before', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    // Only what the view reads of a master: a stage yield, then the tablet reconciliation (the batch's).
    const doc = { header: { productCode: 'OUT', productName: 'Output' }, stages: [{ key: 'c', steps: [{ key: 'y', block: { id: 'stage-yield', version: 1 } },
      { key: 'r', block: { id: 'tablet-reconciliation', version: 1 } }] }] };
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${u!.id}) returning id::int`;
    const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values ('OUT-1', ${v!.id}, ${u!.id}) returning id::int`;
    const res = (good: string, y: string) => ({ results: { goodTablets: { ok: true, value: good, unit: 'tablets', shown: '' }, yield: { ok: true, value: y, unit: '%', shown: '' },
      accountability: { ok: false, message: 'not yet' } } });
    const add = (step: number, kind: string, payload: object) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
      values (${b!.id}, 0, 1, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id})`;
    const out = async () => (await t.owner.unsafe(`select good_quantity::text, good_unit, yield_percent::text from ${rep()}.batch_fact_v1 where batch_number = 'OUT-1'`))[0];
    await add(0, 'value', { results: { yield: { ok: true, value: '99', unit: '%', shown: '' } } });
    await add(0, 'done', {});
    await add(1, 'value', res('198765.4', '99.382716'));
    // Recorded but not signed: not yet the batch's output.
    expect(await out()).toEqual({ good_quantity: null, good_unit: 'tablets', yield_percent: null });
    await add(1, 'done', {});
    expect(await out()).toEqual({ good_quantity: '198765', good_unit: 'tablets', yield_percent: '99.38' });
    // Sent back: null again until signed again; a correction after that gives the corrected figures.
    await add(1, 'sent_back', { reason: 'recount' });
    expect((await out())!.good_quantity).toBeNull();
    await add(1, 'value', res('197000', '98.5'));
    await add(1, 'done', {});
    await add(1, 'corrected', res('197500', '98.75'));
    expect(await out()).toEqual({ good_quantity: '197500', good_unit: 'tablets', yield_percent: '98.75' });
  });

  it('batch_fact_v1 names the product and gives the master version as its number', async () => {
    const [f] = await t.owner.unsafe(`select f.family_code, f.product_name, f.master_version from ${rep()}.batch_fact_v1 f
      join batches b on b.batch_no = f.batch_number join master_versions v on v.id = b.master_version_id order by b.id limit 1`);
    expect(f).toEqual({ family_code: '1', product_name: 'P', master_version: 1 });
  });

  it('material_use_v1 publishes what was dispensed, for MMS to reduce the lot\'s stock: lot, material, net quantity; a correction shows the corrected quantity', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(tablet() as never)}, ${u!.id}) returning id::int`;
    const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values ('MAT-USE-1', ${v!.id}, ${u!.id}) returning id::int`;
    const net = (value: string) => ({ ok: true, value, unit: 'kg', shown: `${value} kg` });
    const e = (step: number, kind: string, payload: object, at: string) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at)
      values (${b!.id}, 1, 1, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id}, ${at})`;
    // Granulation: weigh the API (signed, then its tare corrected) and the lactose (recorded, not signed: not dispensed yet).
    await e(0, 'started', {}, '2026-11-15 08:00+00');
    await e(0, 'value', { values: { lot: 'API-L1', gross: { value: '10.652', unit: 'kg' }, tare: { value: '0.500', unit: 'kg' } }, results: { net: net('10.152') } }, '2026-11-15 08:05+00');
    await e(0, 'done', {}, '2026-11-15 08:06+00');
    await e(1, 'value', { values: { lot: 'LAC-L1' }, results: { net: net('11.800') } }, '2026-11-15 08:10+00');
    const rows = async () => t.owner.unsafe(`select batch_number, lot_number, material_code, material_master_id, quantity::text, unit, dispensed_at, step, status
      from ${rep()}.material_use_v1 where batch_number = 'MAT-USE-1'`);
    expect(await rows()).toEqual([{ batch_number: 'MAT-USE-1', lot_number: 'API-L1', material_code: 'MAT-001', material_master_id: 'mat-api', quantity: '10.152', unit: 'kg',
      dispensed_at: new Date('2026-11-15T08:06:00Z'), step: 'granulation/weigh-api', status: 'dispensed' }]);
    await e(0, 'corrected', { values: { tare: { value: '0.502', unit: 'kg' } }, results: { net: net('10.150') }, reason: 'Tare misread' }, '2026-11-15 08:20+00');
    expect(await rows()).toMatchObject([{ lot_number: 'API-L1', quantity: '10.150', status: 'corrected' }]);
    expect(await columns('material_use_v1')).toEqual(['batch_number text', 'lot_number text', 'material_code text', 'material_master_id text', 'quantity numeric', 'unit text',
      'dispensed_at timestamp with time zone', 'step text', 'event_id bigint', 'status text', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone', 'step_name text']);
  });

  it('material_use_v1 gives MMS the quantity in the material\'s unit in master data, read at signing: grams exactly in kg; without it, the step\'s unit', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(tablet() as never)}, ${u!.id}) returning id::int`;
    const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values ('MAT-USE-2', ${v!.id}, ${u!.id}) returning id::int`;
    const e = (step: number, kind: string, payload: object) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
      values (${b!.id}, 1, 1, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id})`;
    await e(0, 'started', { where: 'Granulation › Weigh a material: Examplol' });
    await e(0, 'value', { values: { lot: 'API-G1' }, results: { net: { ok: true, value: '600.5', unit: 'g', shown: '600.5 g' } } });
    await e(0, 'done', { stockUnit: 'kg' });
    await e(1, 'started', {});
    await e(1, 'value', { values: { lot: 'LAC-G1' }, results: { net: { ok: true, value: '12.5', unit: 'mg', shown: '12.5 mg' } } });
    await e(1, 'done', {});
    const rows = await t.owner.unsafe(`select lot_number, quantity::text, unit, step_name from ${rep()}.material_use_v1 where batch_number = 'MAT-USE-2' order by lot_number`);
    expect(rows).toEqual([{ lot_number: 'API-G1', quantity: '0.6005', unit: 'kg', step_name: 'Granulation › Weigh a material: Examplol' },
      { lot_number: 'LAC-G1', quantity: '12.5', unit: 'mg', step_name: 'Granulation › weigh-lactose' }]);
  });

  it('equipment_use_v1: one use per batch and machine or room, open across the stages of the batch that name it or may run in its room; another batch, another use; a balance, none', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    // The binder preparation runs in RM-104; the granulation in the Granulation area, RM-104's area; the balance stands in dispensing.
    const doc = tablet();
    doc.stages[0]!.roomTypes = ['RM-104'];
    doc.stages[1]!.roomTypes = ['Granulation'];
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${u!.id}) returning id::int`;
    const batch = async (no: string) => (await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values (${no}, ${v!.id}, ${u!.id}) returning id::int`)[0]!.id;
    const [b1, b2] = [await batch('EQ-USE-1'), await batch('EQ-USE-2')];
    const room = { itemId: 'rm-104', code: 'RM-104', name: 'Granulation room 4', version: 1, type: 'Granulation', room: 'RM-104', area: 'Granulation' };
    const bal = { itemId: 'eq-bal', code: 'BAL-01', name: 'Balance', version: 1, type: 'Platform balance', room: 'DSP-01', area: 'Dispensing' };
    const e = (b: number, stage: number, sub: number, step: number, kind: string, payload: object, at: string) => t.owner`
      insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at)
      values (${b}, ${stage}, ${sub}, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id}, ${at})`;
    const closed = (b: number, stage: number, at: string) => t.owner`
      insert into batch_events (batch_id, kind, payload, person_id, at) values (${b}, 'stage_closed', ${t.owner.json({ stage } as never)}, ${u!.id}, ${at})`;
    const rows = (no: string) => t.owner.unsafe(`select equipment_code, step, step_name, started_at, ended_at from ${rep()}.equipment_use_v1
      where batch_number = $1 order by equipment_code`, [no]);
    const ends = async (no: string) => (await rows(no)).map((r) => [r.equipment_code, r.ended_at]);
    await e(b1, 0, 1, 0, 'started', { where: 'Binder solution › Weigh a material: Povidone K30' }, '2026-11-15 08:00+00');
    await e(b1, 0, 1, 0, 'value', { values: { room, balance: bal } }, '2026-11-15 08:01+00');
    await e(b1, 0, 1, 0, 'done', {}, '2026-11-15 08:05+00');
    // The balance the weighing names is no use (shared by the batches weighing on it); the room is, from the time it was
    // recorded on the step, not the step's start (whole-suite run, S17: a room refused until its cleaning was done).
    expect(await rows('EQ-USE-1')).toEqual([
      { equipment_code: 'RM-104', step: 'binder/weigh-pvp', step_name: 'Binder solution › Weigh a material: Povidone K30', started_at: new Date('2026-11-15T08:01:00Z'), ended_at: null }]);
    // The binder preparation closes: the granulation, still to run, may run in RM-104 (its area), so the room stays in use by the
    // batch, not dirty.
    await closed(b1, 0, '2026-11-15 08:30+00');
    expect(await ends('EQ-USE-1')).toEqual([['RM-104', null]]);
    // The granulation names it again, in two sub-batch rows too: still one use, open until the granulation closes.
    await e(b1, 1, 1, 0, 'started', {}, '2026-11-15 09:00+00');
    await e(b1, 1, 1, 0, 'value', { values: { room, balance: bal } }, '2026-11-15 09:01+00');
    await e(b1, 1, 2, 1, 'started', {}, '2026-11-15 09:10+00');
    await e(b1, 1, 2, 1, 'value', { values: { room } }, '2026-11-15 09:11+00');
    await e(b1, 1, 2, 1, 'done', {}, '2026-11-15 09:20+00');
    // Its step is the one that named it last (17 Nov 2026 run, F41): the Logbook's "last used by … (stage › step)".
    const last = `${doc.stages[1]!.key}/${doc.stages[1]!.steps[1]!.key}`;
    expect(await rows('EQ-USE-1')).toMatchObject([{ equipment_code: 'RM-104', step: last, step_name: `${doc.stages[1]!.name} › ${doc.stages[1]!.steps[1]!.key}`,
      started_at: new Date('2026-11-15T08:01:00Z'), ended_at: null }]);
    // Dirty after the last stage that names it.
    await closed(b1, 1, '2026-11-15 10:00+00');
    expect(await ends('EQ-USE-1')).toEqual([['RM-104', new Date('2026-11-15T10:00:00Z')]]);
    await expect(t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${b1}, 'stage_closed', '{"stage":0}', ${u!.id})`).rejects.toMatchObject({ code: '23505' });
    // Another batch in the same room is another use; rejected before its stages closed, its use ends then.
    await e(b2, 0, 1, 0, 'started', {}, '2026-11-15 11:00+00');
    await e(b2, 0, 1, 0, 'value', { values: { room, balance: bal } }, '2026-11-15 11:01+00');
    expect(await rows('EQ-USE-2')).toMatchObject([{ equipment_code: 'RM-104', started_at: new Date('2026-11-15T11:01:00Z'), ended_at: null }]);
    expect(await ends('EQ-USE-1')).toEqual([['RM-104', new Date('2026-11-15T10:00:00Z')]]);
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id, at) values (${b2}, 'rejected', '{}', ${u!.id}, '2026-11-15 12:00+00')`;
    expect(await ends('EQ-USE-2')).toEqual([['RM-104', new Date('2026-11-15T12:00:00Z')]]);
  });

  it('equipment_use_v1: a room or machine named only in line clearance steps was used by the stage: its step_name is the stage (17 Nov 2026 run, F3)', async () => {
    const [u] = await t.owner<{ id: number }[]>`select id::int from users order by id limit 1`;
    // Every stage starts with a line clearance (step 0); the binder preparation weighs in step 1.
    const doc = placed(tablet());
    const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${u!.id}) returning id::int`;
    const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values ('EQ-USE-3', ${v!.id}, ${u!.id}) returning id::int`;
    const e = (stage: number, step: number, kind: string, payload: object, at: string) => t.owner`
      insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at)
      values (${b!.id}, ${stage}, 1, ${step}, 1, ${kind}, ${t.owner.json(payload as never)}, ${u!.id}, ${at})`;
    const room = { itemId: 'rm-105', code: 'RM-105', name: 'Granulation room 5', version: 1, type: 'Binder solution', room: 'RM-105', area: 'Binder solution' };
    const stirrer = { itemId: 'eq-str', code: 'STR-01', name: 'Stirrer', version: 1, type: 'stirrer', room: 'RM-105', area: 'Binder solution' };
    // The room in the clearance of the binder stage only; the stirrer in its clearance and then in a process step.
    await e(0, 0, 'started', {}, '2026-11-16 08:00+00');
    await e(0, 0, 'value', { values: { room, machine: stirrer } }, '2026-11-16 08:01+00');
    await e(0, 2, 'started', {}, '2026-11-16 08:10+00');
    await e(0, 2, 'value', { values: { machine: stirrer } }, '2026-11-16 08:11+00');
    const rows = await t.owner.unsafe(`select equipment_code, step, step_name from ${rep()}.equipment_use_v1 where batch_number = 'EQ-USE-3' order by equipment_code`);
    const st = doc.stages[0]!;
    expect(st.steps[0]!.block.id).toBe('line-clearance');
    expect(rows).toEqual([
      { equipment_code: 'RM-105', step: `${st.key}/${st.steps[0]!.key}`, step_name: st.name },
      { equipment_code: 'STR-01', step: `${st.key}/${st.steps[2]!.key}`, step_name: `${st.name} › ${st.steps[2]!.key}` }]);
  });

  it('nobody reads the views without a link: the app login itself has no grant', async () => {
    await expect(t.sql.unsafe(`select * from ${rep()}.batch_fact_v1`)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('the deviation number flows back to the batch record (owner, 17 Nov 2026)', () => {
  type Dev = { note: number; step: string; reference: string; open: boolean; status?: string; filed?: boolean; typed?: boolean };
  let b: { id: number; batchNo: string };
  const devs = async () => ((await as('meera', 'GET', `/api/batches/${b.id}`)).json() as { batch: { deviations: Dev[]; deviationsLink: string } }).batch;
  beforeAll(async () => { b = await issue(small([{ steps: [{ checker: true }, yieldStep] }])); });

  it('a note written without a number takes the number of the deviation Deviations filed from it (deviation_v1.source_ref), with its status, read live', async () => {
    expect((await act('asha', b.id, '0.1.0.1', 'note', { text: 'Torn label on the drum' })).statusCode).toBe(200);
    // Not filed yet: a note, no deviation.
    expect(await devs()).toMatchObject({ deviationsLink: 'ok', deviations: [] });
    const [n] = await t.owner.unsafe(`select note_id::int as id, source_ref from ${t.schema}_report.deviation_note_v1 where batch_number = $1`, [b.batchNo]);
    await t.owner.unsafe(`insert into ${S.dv}.deviation_v1 (number, status, batch, batch_norm, title, source_ref) values
      ('DEV-26-0123', 'investigation', '${b.batchNo}', '${b.batchNo.toLowerCase()}', 'Torn label', '${n!.source_ref as string}')`);
    const d = await devs();
    expect(d.deviations).toEqual([expect.objectContaining({ note: n!.id, step: '0.1.0.1', reference: 'DEV-26-0123', open: true, status: 'investigation', filed: true })]);
    expect(deviationText(d.deviations[0]!)).toBe('DEV-26-0123 (filed in Deviations from this note) · under investigation (Deviations)');
    // Open in Deviations: QA cannot close it by hand; the review lists it as linked, not as a deviation no note links.
    expect((await as('meera', 'POST', `/api/batches/${b.id}/close-deviation`, { note: n!.id, reason: 'Closed' })).json())
      .toMatchObject({ problems: ['The status of DEV-26-0123 comes from the Deviations system (now under investigation): it is closed there.'] });
    const r = (await as('meera', 'GET', `/api/batches/${b.id}/review`)).json() as { deviations: Dev[]; unlinked: { number: string }[] };
    expect([r.deviations.map((x) => x.reference), r.unlinked]).toEqual([['DEV-26-0123'], []]);
    await t.owner.unsafe(`update ${S.dv}.deviation_v1 set status = 'closed', closed_at = now() where number = 'DEV-26-0123'`);
    expect((await devs()).deviations).toMatchObject([{ reference: 'DEV-26-0123', open: false, status: 'closed' }]);
  });

  it('Deviations down: a number typed with the note says "typed by hand"; the filed number is not shown (never stale)', async () => {
    await cut(S.dv);
    try {
      expect((await act('mona', b.id, '0.1.0.1', 'note', { text: 'Second label torn', reference: 'DEV-PAPER-9' })).statusCode).toBe(200);
      const d = await devs();
      expect(d).toMatchObject({ deviationsLink: 'down', deviations: [{ reference: 'DEV-PAPER-9', open: true, typed: true }] });
      expect(d.deviations[0]!.filed).toBeUndefined();
      expect(deviationText(d.deviations[0]!)).toBe('DEV-PAPER-9 (typed by hand) · open');
    } finally { await restore(S.dv); }
  });

  it('the batch record PDF shows the number and status on the step where the note was written, and in its deviation notes', async () => {
    const l = (await loadBatch(t.sql, b.id))!;
    const note = l.events.find((e) => e.kind === 'note' && !e.payload.reference)!;
    const pdf = JSON.stringify(batchRecordDoc({ ...await recordInput(t.sql, l), deviationsRead: new Map([[filedKey(note.id), { status: 'capa', closedAt: null, number: 'DEV-26-0123' }]]) }, 'QA'));
    expect(pdf).toContain('deviation DEV-26-0123 (filed in Deviations from this note) · waiting for its CAPA (Deviations): Torn label on the drum');
    expect(pdf).toContain('deviation DEV-PAPER-9 (typed by hand) · open: Second label torn');
    expect(pdf).toContain('"DEV-26-0123 (filed in Deviations from this note)"');
    expect(pdf).toContain('OPEN: waiting for its CAPA in the Deviations system');
  });
});
