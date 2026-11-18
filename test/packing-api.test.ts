import { plantDate } from '../shared/plant-time.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { bulkDeviations, loadBatch, recordInput } from '../server/routes/batches.js';
import { PACKING } from '../packing/product.js';
import { PACKING_APP_ROLE } from '../packing/migrate.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { packing } from './packing-fixture.js';
import { openSteps, returnsOf, usesOfLot } from '../shared/engine/index.js';

// TrueBatch Liquids Packing through its own server: its own permission codes, a packing batch issued from a RELEASED
// bulk batch read from TrueBatch Liquids' batch_fact_v1 (a fake provider schema, read with packing's restricted login),
// the hand fallback with a second person, one active order per line, the whole record run to QC approval and QA release,
// the packing record PDF, its published view, and its insert-only tables.

let t: TestApp;
let provider: Sql;
let TB = '';
const cookies: Record<string, string> = {};
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });
const P = (...codes: string[]) => codes.map((c) => `truebatch_liquids_packing.${c}` as const);

beforeAll(async () => {
  t = await freshApp(async (db) => {
    TB = `${db.schema}_tb`;
    // TrueBatch Liquids' published batch_fact_v1, as a table with its columns. manufactured_on (the date the first
    // processing step started) is not the issue date: TL260001 was issued on 31 Oct and started on 3 Nov.
    await db.owner.unsafe(`
      create schema ${TB};
      -- bulk_ready_at and bulk_hold_hours (TL-17): when the bulk was ready and its hold, relative to now so the test never
      -- rots. good_quantity and good_unit are added later (a view without them reads as null: the bulk issued is typed).
      create table ${TB}.batch_fact_v1 (batch_id uuid, batch_number text, product_code text, strength text, mbr_version_id uuid, family_code text, record_kind text,
        status text, issued_at timestamptz, completed_at timestamptz, released boolean, read_at timestamptz default now(), data_as_of timestamptz default now(), manufactured_on date,
        bulk_ready_at timestamptz, bulk_hold_hours numeric);
      -- TrueBatch Liquids' deviation_note_v1 and the Deviations system's deviation_v1 (in the same fake schema): the bulk
      -- batch's open deviations block packing release (whole-suite run, S24).
      create table ${TB}.deviation_note_v1 (note_id bigint, source_ref text, batch_number text, product_code text, step text, note text, reference text, status text,
        noted_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${TB}.deviation_v1 (number text, status text, classification text, opened_at timestamptz, closed_at timestamptz, product text, batch text,
        batch_norm text, outcome text, read_at timestamptz default now(), data_as_of timestamptz default now(), title text, source_ref text);
      grant usage on schema ${TB} to ${PACKING_APP_ROLE};
      grant select on all tables in schema ${TB} to ${PACKING_APP_ROLE};
      insert into ${TB}.batch_fact_v1 (batch_number, product_code, record_kind, status, issued_at, released, manufactured_on, bulk_ready_at, bulk_hold_hours) values
        ('TL260001', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-10-31 06:00+00', true, '2026-11-03', now() - interval '1 day', 720),
        ('TL260002', 'PRD-001', 'PROCESSING', 'QC_APPROVED', '2026-11-05 06:00+00', false, '2026-11-05', now() - interval '1 day', 720),
        ('TL260003', 'PRD-002', 'PROCESSING', 'RELEASED', '2026-11-04 06:00+00', true, '2026-11-04', now() - interval '1 day', 720),
        ('TL260004', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-06 06:00+00', true, '2026-11-06', now() - interval '1 day', 720),
        ('TL260005', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-07 06:00+00', true, null, null, null);`);
    provider = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, link: true });
    return links({ truebatch_liquids: provider, deviations: provider }, { truebatch_liquids: TB, deviations: TB });
  }, PACKING);
  t.master.products_.push({ ...item('pk-1', 'PK-001', 'Examplol 120 mg/5 mL syrup, 60 mL bottle'), strength: '120 mg/5 mL', dosageForm: 'syrup' },
    { ...item('prd-1', 'PRD-001', 'Examplol 120 mg/5 mL syrup'), strength: '120 mg/5 mL', dosageForm: 'syrup' });
  for (const m of packing().pack!.materials) t.master.materials_.push({ ...item(m.materialItemId, m.code, m.name), category: 'packing', unit: m.unit === 'units' ? 'nos' : m.unit });
  t.master.equipment_.push({ ...item('ln-1', 'FL-01', 'Filling line 1'), kind: 'equipment', type: 'filling line', room: 'PK-01' },
    { ...item('ln-2', 'FL-02', 'Filling line 2'), kind: 'equipment', type: 'filling line', room: 'PK-02' },
    { ...item('ln-3', 'FL-03', 'Filling line 3'), kind: 'equipment', type: 'filling line', room: 'PK-03' },
    // The machines of the filling line 1's room: the air rinser, the filling machine and the capping machine.
    { ...item('rn-1', 'AR-01', 'Bottle air rinser 1'), kind: 'equipment', type: 'air jet rinser', room: 'PK-01' },
    { ...item('fm-1', 'FM-01', 'Filling machine 1'), kind: 'equipment', type: 'filling machine', room: 'PK-01' },
    { ...item('cp-1', 'CP-01', 'Capping machine 1'), kind: 'equipment', type: 'capping machine', room: 'PK-01' });
  const people = {
    author: P('master.author', 'view'), issuer: P('batch.issue'), op1: P('batch.operate'), chk1: P('batch.check'), sup1: P('batch.supervise'), qc1: P('qc.approve'), qa1: P('qa.release'),
  };
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, perms);
    cookies[name] = (await login(t.app, name)).cookie;
  }
  await seedUser(t.owner, 'liquids', ['truebatch_liquids.batch.operate', 'truebatch_liquids.qa.release']);
});
afterAll(async () => {
  await provider?.end();
  await t.owner.unsafe(`drop schema if exists ${TB} cascade`);
  await t.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
type Batch = { batch: { status: string; contentHash: string; actions: string[] }; steps: { id: string; state: string; actions: string[]; contentHash: string; values: Record<string, unknown>;
  source: Record<string, { from: string }>; handFields: { name: string }[]; results: Record<string, { ok: boolean; shown?: string; check?: { pass: boolean } }>; problems: string[] }[] };
const get = async (id: number, who = 'op1') => (await as(who, 'GET', `/api/batches/${id}`)).json() as Batch;
let mv = 0;
async function effective() {
  const res = await as('author', 'POST', '/api/masters', { doc: packing() });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  return id;
}
// No Logbook link here: the line's status labels are answered at issue (TL-11).
const issue = (values: Record<string, unknown>) => as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer'), values: { ...handLabels('line', 'machine'), ...values } });

describe('TrueBatch Liquids Packing: its own product on the platform', () => {
  it('PL-01 packing reads only its own permission codes from core, each as the shared code of the same thing', async () => {
    const me = (await as('op1', 'GET', '/api/me')).json() as { permissions: string[] };
    expect(me.permissions).toEqual(['truebatch_liquids.batch.operate']);
    const refused = await login(t.app, 'liquids');
    expect(refused.res.statusCode).toBe(403);
    expect(refused.res.body).toContain('You have no right to use TrueBatch Liquids Packing.');
  });

  it('PL-01 the packing draft manifest declares exactly the packing permission codes and labels, in the platform format', () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/packing.manifest.draft.json'), 'utf8')) as { product: string; database: string; permissions: { code: string; label: string }[]; reads: Record<string, string[]>; publishes: string[] };
    expect(Object.fromEntries(m.permissions.map((p) => [p.code, p.label]))).toEqual(PACKING.permissions);
    expect([m.product, m.database]).toEqual(['truebatch_liquids_packing', 'truebatch_liquids_packing']);
    for (const p of m.permissions) expect(p.code).toMatch(/^truebatch_liquids_packing(\.[a-z0-9_]+)+$/);
    // deviation_note_v1: the bulk batch's deviation notes, for QA's release review (whole-suite run, S24).
    expect(m.reads.truebatch_liquids).toEqual(['batch_fact_v1', 'deviation_note_v1']);
    expect(m.publishes).toEqual(['packing_batch_v1', 'equipment_use_v1', 'material_use_v1', 'deviation_note_v1']);
  });

  it('PL-06 the packing app login keeps the step events and signatures insert-only', async () => {
    mv = await effective();
    await expect(t.sql`update step_events set kind = 'done'`).rejects.toMatchObject({ code: '42501' });
    await expect(t.sql`delete from signatures`).rejects.toMatchObject({ code: '42501' });
  });
});

describe('a packing batch from a released bulk batch', () => {
  let first = 0;
  it('TL-P2 the issue screen offers the RELEASED bulk batches of the pack\'s bulk product, read from TrueBatch Liquids', async () => {
    const r = (await as('issuer', 'GET', '/api/bulk-batches?product=PRD-001')).json() as { link: string; batches: { batchNo: string }[] };
    expect([r.link, ...r.batches.map((b) => b.batchNo)]).toEqual(['ok', 'TL260005', 'TL260004', 'TL260001']);
    expect((await as('op1', 'GET', '/api/bulk-batches?product=PRD-001')).statusCode).toBe(403);
  });

  it('TL-P2 a packing batch is issued from a RELEASED bulk batch of TrueBatch Liquids: line, bulk and litres recorded, the date of manufacture, ready time and hold pulled (the date its first step started, not its issue date)', async () => {
    const res = await issue({ line: 'ln-1', bulk: 'TL260001', quantity: '615' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ batchNo: expect.stringMatching(/^TLP\d{6}$/) });
    first = (res.json() as { id: number }).id;
    const s = (await get(first)).steps[0]!;
    expect(s).toMatchObject({ state: 'in_progress', values: { bulk: 'TL260001', mfgDate: '2026-11-03', line: { code: 'FL-01' }, quantity: { value: '615', unit: 'L' }, holdHours: '720',
      readyAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/) },
    source: { bulk: { from: 'truebatch_liquids' }, mfgDate: { from: 'truebatch_liquids' }, readyAt: { from: 'truebatch_liquids' }, holdHours: { from: 'truebatch_liquids' } } });
    expect(s.results.expiry).toMatchObject({ ok: true, shown: expect.stringContaining('expiry 10/2028') });
    expect(s.results.packs).toMatchObject({ ok: true, shown: '615 L ÷ 61.5 mL = 10000 packs' });
    // The pulled date and hold cannot be typed over.
    const r = await as('op1', 'POST', `/api/batches/${first}/steps/0.1.0.1/record`, { values: { mfgDate: '2026-11-01', holdHours: '9999' } });
    expect(r.json()).toMatchObject({ problems: ['Date of manufacture of the bulk comes from TrueBatch Liquids and cannot be typed over', 'Bulk hold (hours, from the master of the bulk) comes from TrueBatch Liquids and cannot be typed over'] });
  });

  it('TL-P2 bulk must be released: a bulk batch not released, of another product, unknown or past its hold is refused', async () => {
    const no = async (bulk: string) => (await issue({ line: 'ln-2', bulk, quantity: '100' })).json() as { problems: string[] };
    expect((await no('TL260002')).problems).toEqual(['Bulk batch TL260002 is qc approved in TrueBatch Liquids: only a released bulk batch may be filled.']);
    expect((await no('TL260003')).problems).toEqual(['Bulk batch TL260003 is PRD-002 in TrueBatch Liquids, not PRD-001 Examplol 120 mg/5 mL syrup.']);
    expect((await no('TL269999')).problems).toEqual(['Bulk batch TL269999 is not in TrueBatch Liquids.']);
    expect((await no('TL260005')).problems).toEqual(['Bulk batch TL260005 has no date of manufacture in TrueBatch Liquids (no processing step started).']);
    expect((await issue({ line: 'ln-2', bulk: 'TL260001' })).json()).toMatchObject({ problems: ['Bulk issued is not recorded'] });
    // TL-17: a bulk past its hold (720 h from when it was ready) is not issued for filling.
    await t.owner.unsafe(`update ${TB}.batch_fact_v1 set bulk_ready_at = now() - interval '40 days' where batch_number = 'TL260004'`);
    try {
      expect((await no('TL260004')).problems).toEqual([expect.stringMatching(/^Bulk batch TL260004 was ready at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z and its hold of 720 h ended at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z: it may not be issued for filling\.$/)]);
    } finally {
      await t.owner.unsafe(`update ${TB}.batch_fact_v1 set bulk_ready_at = now() - interval '1 day' where batch_number = 'TL260004'`);
    }
  });

  it('TL-P7 one active packing order per line: a line with a batch being packed takes no other', async () => {
    const res = await issue({ line: 'ln-1', bulk: 'TL260004', quantity: '300' });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: 'line_in_use', problems: [expect.stringMatching(/^Line FL-01 has an active packing order: batch TLP\d{6} \(PK-001\) is still being packed\. One packing order per line\.$/)] });
  });

  it('TL-P2 without the TrueBatch Liquids link the bulk is typed from its labels (RELEASED), with its ready time and hold, and a second person checks it', async () => {
    await t.owner.unsafe(`revoke select on ${TB}.batch_fact_v1 from ${PACKING_APP_ROLE}`);
    try {
      const typed = { line: 'ln-2', bulk: 'TL260004', quantity: '300', readyAt: '2026-11-06T18:00:00Z', holdHours: '720', 'bulk.released': 'yes', 'bulk.product': 'yes' };
      // TL-P8: a typed date of manufacture is a real date, never in the future (plant time).
      const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const future = await issue({ ...typed, mfgDate: tomorrow });
      expect(future.statusCode).toBe(400);
      expect(future.json()).toMatchObject({ problems: [`The date of manufacture ${plantDate(tomorrow)} is in the future: give the date on the bulk labels.`] });
      expect((await issue({ ...typed, mfgDate: '6/11/2026' })).json())
        .toMatchObject({ problems: ['Date of manufacture of the bulk: give a date, e.g. 2026-11-15.'] });
      // The ready time and the hold are typed too (from the bulk's record), when the link is down.
      expect((await issue({ ...typed, mfgDate: '2026-11-06', readyAt: undefined, holdHours: undefined })).json())
        .toMatchObject({ problems: expect.arrayContaining([expect.stringMatching(/^Bulk ready .* is not recorded$/), expect.stringMatching(/^Bulk hold .* is not recorded$/)]) });
      const notReleased = await issue({ ...typed, mfgDate: '2026-11-06', 'bulk.released': 'no' });
      expect(notReleased.json()).toMatchObject({ problems: [expect.stringContaining('the bulk container labels say RELEASED (QA) for this batch number: if not, do not use it')] });
      const res = await issue({ ...typed, mfgDate: '2026-11-06' });
      expect(res.statusCode, res.body).toBe(200);
      const id = (res.json() as { id: number }).id;
      const s = (await get(id)).steps[0]!;
      expect(s.source.bulk).toEqual({ from: 'hand', link: 'truebatch_liquids', state: 'down' });
      expect(s.values).toMatchObject({ quantity: { value: '300', unit: 'L' }, readyAt: '2026-11-06T18:00:00Z', holdHours: '720' });
      expect(s.handFields.map((f) => f.name)).toEqual(expect.arrayContaining(['bulk.released', 'bulk.product']));
      // The issuer cannot check it; the review lists the hand entry for QA.
      const review = (await as('qa1', 'GET', `/api/batches/${id}/review`)).json() as { hand: { field: string; link: string }[] };
      expect(review.hand.map((h) => `${h.field} ${h.link}`)).toContain('bulk truebatch_liquids');
      const done = await as('op1', 'POST', `/api/batches/${id}/steps/0.1.0.1/record`, { values: { received: 'yes' } });
      expect(done.statusCode).toBe(200);
      const signed = await as('op1', 'POST', `/api/batches/${id}/steps/0.1.0.1/done`, { proof: proofFor('op1'), contentHash: (await get(id)).steps[0]!.contentHash });
      expect(signed.statusCode, signed.body).toBe(200);
      expect((await get(id, 'chk1')).steps[0]).toMatchObject({ state: 'done_awaiting_check', actions: ['check', 'send-back', 'note'] });
    } finally {
      await t.owner.unsafe(`grant select on ${TB}.batch_fact_v1 to ${PACKING_APP_ROLE}`);
    }
  });

  it('TL-21 QA terminates a packing batch in production (owner, 16 Nov 2026): rejected with its reason, its line use ended, the line takes the next order', async () => {
    const id = (await t.owner<{ id: number }[]>`select id::int from batches order by id desc limit 1`)[0]!.id;
    expect((await issue({ line: 'ln-2', bulk: 'TL260004', quantity: '300' })).json()).toMatchObject({ error: 'line_in_use' });
    // The bulk checked, then bottles and caps issued before the line broke down.
    expect((await as('chk1', 'POST', `/api/batches/${id}/steps/0.1.0.1/check`, { proof: proofFor('chk1'), contentHash: (await get(id)).steps[0]!.contentHash })).statusCode).toBe(200);
    for (const [key, values] of [['0.1.1.1', { lot: 'BTL-9', issued: '5000' }], ['0.1.2.1', { lot: 'CAP-9', issued: '4900' }]] as const) {
      expect((await as('op1', 'POST', `/api/batches/${id}/steps/${key}/start`)).statusCode).toBe(200);
      const rec = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/record`, { values: { ...values, ...handLabels('lot', 'lot'), matches: 'yes' } });
      expect(rec.statusCode, rec.body).toBe(200);
      const done = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/done`, { proof: proofFor('op1'), contentHash: (await get(id)).steps.find((x) => x.id === key)!.contentHash });
      expect(done.statusCode, done.body).toBe(200);
    }
    const b = await get(id, 'qa1');
    expect(b.batch.actions).toEqual(['terminate']);
    // In production the packing record says what is still to come.
    const live = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!), 'QA1'));
    for (const text of ['not reconciled yet', '"not started"']) expect(live).toContain(text);
    // The window asks, per lot issued, what went back to stores unused: up to what was issued, in the published unit.
    // The bulk issued comes first: what went back of it can be issued to another packing batch (bulkLeft).
    expect((b.batch as unknown as { issued: object[] }).issued).toEqual([{ lot: 'TL260004', material: 'bulk PRD-001 · Examplol 120 mg/5 mL syrup', value: '300', unit: 'L' },
      { lot: 'BTL-9', material: 'PM-201 · Amber PET bottle 60 mL', value: '5000', unit: 'nos' }, { lot: 'CAP-9', material: expect.stringMatching(/^PM-202 · /), value: '4900', unit: 'nos' }]);
    const terminate = (returns?: object[]) => as('qa1', 'POST', `/api/batches/${id}/terminate`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash, reason: 'Filling line 2 down for repair', ...(returns ? { returns } : {}) });
    expect((await terminate()).json()).toMatchObject({ error: 'invalid_values', problems: ['Say how much of lot TL260004 (bulk PRD-001 · Examplol 120 mg/5 mL syrup) went back to stores unused: 0 if none.',
      expect.stringMatching(/^Say how much of lot BTL-9 /), expect.stringMatching(/^Say how much of lot CAP-9 /)] });
    const bulk = { lot: 'TL260004', value: '120', unit: 'L' };
    expect((await terminate([{ ...bulk, value: '300.5' }, { lot: 'BTL-9', value: '5001', unit: 'nos' }, { lot: 'CAP-9', value: '0', unit: 'nos' }])).json())
      .toMatchObject({ problems: ['Lot TL260004: 300 L was issued to this batch; 300.5 L cannot have gone back to stores.', 'Lot BTL-9: 5000 nos was issued to this batch; 5001 nos cannot have gone back to stores.'] });
    const r = await terminate([bulk, { lot: 'BTL-9', value: '1000', unit: 'nos' }, { lot: 'CAP-9', value: '0', unit: 'nos' }]);
    expect(r.statusCode, r.body).toBe(200);
    expect((await get(id)).batch).toMatchObject({ status: 'rejected', actions: [] });
    const no = (await t.owner<{ no: string }[]>`select batch_no as no from batches where id = ${id}`)[0]!.no;
    expect(await t.owner.unsafe(`select status from ${t.schema}_report.packing_batch_v1 where batch_number = $1`, [no])).toEqual([{ status: 'REJECTED' }]);
    // material_use_v1 gives back what went back to stores; the app counts the same (shared/engine/stock.ts).
    const used = await t.owner.unsafe(`select lot_number, quantity::text, unit from ${t.schema}_report.material_use_v1 where batch_number = $1 order by lot_number`, [no]);
    expect(used).toEqual([{ lot_number: 'BTL-9', quantity: '4000', unit: 'nos' }, { lot_number: 'CAP-9', quantity: '4900', unit: 'nos' }]);
    const l = (await loadBatch(t.sql, id))!;
    expect(['BTL-9', 'CAP-9'].map((lot) => usesOfLot(l.doc, openSteps(l.doc, l.events, l.now).steps, lot, returnsOf(l.batchEvents))[0]!.quantity.value)).toEqual(['4000', '4900']);
    const record = JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.app.master), 'QA1'));
    expect(record).toMatch(/Terminated by QA1 at [^"]* IST: Filling line 2 down for repair · Back to stores unused: lot TL260004 \(bulk PRD-001 · Examplol 120 mg\/5 mL syrup\) 120 L, lot BTL-9 \(PM-201 · Amber PET bottle 60 mL\) 1000 nos, lot CAP-9 \([^)]*\) 0 nos; the rest counts as used/);
    // The packing materials it stopped before issuing say so in plain words, not "Lot —: —".
    for (const text of ['Lot BTL-9: 5000 nos · 1.2 Issue Amber PET bottle 60 mL (PM-201)', 'not issued · 1.4 Issue Measuring cup 10 mL (PM-203)', 'not issued · 1.7 Issue Leaflet (PM-206)']) expect(record).toContain(text);
    expect(record).not.toContain('Lot —');
    // What it stopped before doing reads "terminated", never as still to come (owner, 16 Nov 2026).
    for (const text of ['"not reconciled (terminated)"', '"terminated, not started"']) expect(record).toContain(text);
    expect(record).not.toMatch(/\byet\b|"not started"|"in progress"/);
    expect((await issue({ line: 'ln-2', bulk: 'TL260004', quantity: '300' })).statusCode).toBe(200);
  });

  it('TL-P6 the packing record runs to the end: materials issued and reconciled, checks alongside the line, finished goods; QC approves it, then QA releases it, and the line is free again', async () => {
    const id = first;
    const step = async (key: string, values: Record<string, unknown>) => {
      let s = (await get(id)).steps.find((x) => x.id === key)!;
      if (s.actions.includes('start')) expect((await as('op1', 'POST', `/api/batches/${id}/steps/${key}/start`)).statusCode).toBe(200);
      const r = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/record`, { values });
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200);
      s = (await get(id)).steps.find((x) => x.id === key)!;
      const d = await as('op1', 'POST', `/api/batches/${id}/steps/${key}/done`, { proof: proofFor('op1'), contentHash: s.contentHash });
      expect(d.statusCode, `${key} done: ${d.body}`).toBe(200);
      s = (await get(id, 'chk1')).steps.find((x) => x.id === key)!;
      if (s.state === 'done_awaiting_check') {
        const c = await as('chk1', 'POST', `/api/batches/${id}/steps/${key}/check`, { proof: proofFor('chk1'), contentHash: s.contentHash });
        expect(c.statusCode, `${key} check: ${c.body}`).toBe(200);
      }
      return s;
    };
    const yes = (...names: string[]) => Object.fromEntries(names.map((n) => [n, 'yes']));
    const line = { line: 'ln-1', ...handLabels('line', 'machine') };
    await step('0.1.0.1', { received: 'yes' });
    const issued: Record<string, string> = { bottle: '10200', cap: '10200', cup: '10200', label: '10200', carton: '10200', leaflet: '10200' };
    for (const [i, k] of Object.keys(issued).entries()) await step(`0.1.${i + 1}.1`, { lot: `${k.toUpperCase()}-1`, ...handLabels('lot', 'lot'), issued: issued[k], matches: 'yes' });
    await step('1.1.0.1', { ...line, ...yes('noPrevious', 'coderCleared', 'rejectsEmpty', 'clean'), cleanedOn: '2026-11-15 07:00', cleanedBy: 'CLEANER ONE' });
    await step('1.1.1.1', yes('components', 'changeParts', 'coderSet', 'specimens'));
    await step('1.1.2.1', { washer: 'rn-1', ...handLabels('washer', 'machine'), method: 'air rinse', count: '10200', visual: 'yes' });
    // One fill round of 10 bottles, the last (filling finished); its time against the bulk's hold (ready 1 day ago, 720 h).
    const fill = await step('1.1.3.1', { machine: 'fm-1', ...handLabels('machine', 'machine'), round: 'end', checkedAt: 'now', fills: Array(10).fill('76.9'), counter: '10000', filling: 'finished' });
    expect(fill.values).toMatchObject({ fills: Array(10).fill({ value: '76.9', unit: 'g' }), counter: { value: '10000', unit: 'units' } });
    expect([fill.results.mean, fill.results.each, fill.results.holdCheck]).toMatchObject([{ check: { pass: true } }, { check: { pass: true } }, { check: { pass: true } }]);
    await step('1.1.4.1', { capper: 'cp-1', ...handLabels('capper', 'machine'), closure: 'child-resistant cap', checked: '20', defects: '0', seated: 'yes', crc: 'yes', capping: 'finished' });
    await step('1.1.5.1', { temperature: '25', running: 'finished' });
    const coding = await step('1.1.6.1', { printedBatch: 'TL260001', printedMfg: 'NOV.2026', printedExpiry: 'OCT.2028', printedMrp: 'Rs. 45.00', ...yes('legible', 'packingDone') });
    expect(coding.results.expiryCheck).toMatchObject({ check: { pass: true } });
    await step('1.1.7.1', yes('appearance', 'complete', 'samplesKept', 'packingDone'));
    await step('1.1.8.1', { cartons: '10', ...yes('leaflet', 'device', 'count', 'coded', 'packingDone') });
    // The filling stage is closed: the line stays in use by the batch (its reconciliation and line clearance run in the
    // packing rooms, PK-01's area), not dirty before the batch is finished with it.
    const lineUse = async () => (await t.owner.unsafe(`select ended_at is not null as ended from ${t.schema}_report.equipment_use_v1 where equipment_code = 'FL-01'
      and batch_number = (select batch_no from batches where id = $1)`, [id]))[0];
    expect(await t.owner`select 1 from batch_events where batch_id = ${id} and kind = 'stage_closed' and payload->>'stage' = '1'`).toHaveLength(1);
    expect(await lineUse()).toEqual({ ended: false });
    const fg = await step('2.1.0.1', { packs: '9800', cartons: '205', shippers: '205', samples: '40', rejects: '60', left: '5.0' });
    expect(fg.results.packed).toMatchObject({ ok: true, value: '602.7', unit: 'L' });
    expect(fg.results.yield).toMatchObject({ check: { pass: true } });
    expect(fg.results.accountability).toMatchObject({ check: { pass: true } });
    // Before the reconciliation MMS takes off the whole quantity issued.
    const usedOf = async (lot: string) => (await t.owner.unsafe(`select quantity::text from ${t.schema}_report.material_use_v1 where lot_number = $1
      and batch_number = (select batch_no from batches where id = $2)`, [lot, id]))[0]?.quantity as string | undefined;
    expect(await usedOf('LABEL-1')).toBe('10200');
    await step('2.1.1.1', { used: '9900', destroyed: '100', returned: '200' });
    // Once the reconciliation is signed, what went back to stores uncoded is no longer used (destroyed material is).
    expect(await usedOf('LABEL-1')).toBe('10000');
    await step('2.1.2.1', { used: '9840', destroyed: '60', returned: '300' });
    await step('2.1.3.1', { used: '9840', destroyed: '0', returned: '360' });
    await step('2.1.4.1', { what: 'Labels 100, cartons 60', method: 'shredded', destroyed: 'yes' });
    await step('2.1.5.1', { ...line, ...yes('noLeftover', 'coderCleared', 'leftoversDone') });

    let b = await get(id, 'sup1');
    expect(b.batch.status).toBe('manufacturing complete');
    expect((await as('sup1', 'POST', `/api/batches/${id}/production-approve`, { proof: proofFor('sup1'), contentHash: b.batch.contentHash })).statusCode).toBe(200);
    // TL-21: QC signs first (the finished packed product tested and complies, with the QC report number), then QA releases.
    b = await get(id, 'qa1');
    expect(b.batch).toMatchObject({ status: 'production approved', actions: [] });
    const early = await as('qa1', 'POST', `/api/batches/${id}/release`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ problems: ['Not possible while the batch is production approved.'] });
    expect(((await as('qa1', 'GET', '/api/batches/to-review')).json() as { id: number }[]).find((x) => x.id === id)).toBeUndefined();
    const forQc = (await as('qc1', 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string; actions: string[] }[];
    expect(forQc.find((x) => x.id === id)).toMatchObject({ waiting: 'QC', actions: ['qc-approve'] });
    b = await get(id, 'qc1');
    const qc = await as('qc1', 'POST', `/api/batches/${id}/qc-approve`, { proof: proofFor('qc1'), contentHash: b.batch.contentHash, reportNo: 'QC-26-0101' });
    expect(qc.statusCode, qc.body).toBe(200);
    const [qcRow] = await t.owner.unsafe(`select status from ${t.schema}_report.packing_batch_v1 where batch_number = $1`, [(await loadBatch(t.sql, id))!.batch.batchNo]);
    expect(qcRow).toEqual({ status: 'QC_APPROVED' });
    b = await get(id, 'qa1');
    expect(b.batch).toMatchObject({ status: 'QC approved', actions: ['release', 'reject'] });
    const toReview = (await as('qa1', 'GET', '/api/batches/to-review')).json() as { id: number; waiting: string }[];
    expect(toReview.find((x) => x.id === id)).toMatchObject({ waiting: 'QA' });
    // Whole-suite run, S24: the bulk batch's deviations still open are shown in QA's review and block release until they
    // are closed in the Deviations system: one by the number on its TrueBatch Liquids note, one Deviations filed from a
    // note written without a number (its source_ref), one only naming the bulk batch there. A closed one, a note without
    // a deviation, or another batch's deviation, does not.
    await t.owner.unsafe(`insert into ${TB}.deviation_note_v1 (note_id, source_ref, batch_number, step, note, reference, status) values
        (11, 'truebatch_liquids:note:11', 'TL260001', 'Manufacturing › Check the bulk', 'pH high at 10:00', 'DEV-2026-0045', 'open'),
        (12, 'truebatch_liquids:note:12', 'TL260001', 'Manufacturing › Dissolve', 'Room refused at line clearance', null, null),
        (13, 'truebatch_liquids:note:13', 'TL260001', 'Filtration › Filter', 'Filter changed', 'DEV-2026-0044', 'closed'),
        (14, 'truebatch_liquids:note:14', 'TL260001', 'Filtration › Filter', 'Just a remark', null, null),
        (15, 'truebatch_liquids:note:15', 'TL260003', 'Manufacturing › Dissolve', 'Another batch', 'DEV-2026-0046', 'open');
      insert into ${TB}.deviation_v1 (number, status, batch, batch_norm, title, source_ref, closed_at) values
        ('DEV-2026-0045', 'closure', 'TL260001', 'tl260001', 'High pH', null, null),
        ('DEV-2026-0047', 'investigation', 'TL260001', 'tl260001', 'Room refused', 'truebatch_liquids:note:12', null),
        ('DEV-2026-0044', 'closed', 'TL260001', 'tl260001', 'Filter changed', null, now()),
        ('DEV-2026-0048', 'capa', 'TL260001', 'tl260001', 'Label mix-up found at packing', null, null),
        ('DEV-2026-0046', 'investigation', 'TL260003', 'tl260003', 'Another bulk batch', null, null)`);
    const review = async () => ((await as('qa1', 'GET', `/api/batches/${id}/review`)).json() as { bulk: unknown }).bulk;
    expect(await review()).toEqual({ bulk: 'TL260001', state: 'ok', open: [
      { number: 'DEV-2026-0045', status: 'closure', title: 'High pH', step: 'Manufacturing › Check the bulk' },
      { number: 'DEV-2026-0047', status: 'investigation', title: 'Room refused', step: 'Manufacturing › Dissolve' },
      { number: 'DEV-2026-0048', status: 'capa', title: 'Label mix-up found at packing', step: null }] });
    const release = (extra: object = {}) => as('qa1', 'POST', `/api/batches/${id}/release`, { proof: proofFor('qa1'), contentHash: b.batch.contentHash, ...extra });
    const held = await release({ bulkChecked: 'typed is no way round an open deviation' });
    expect(held.statusCode).toBe(409);
    expect(held.json()).toMatchObject({ problems: [
      'Deviation DEV-2026-0045 of the bulk batch TL260001 (Manufacturing › Check the bulk) is still open in the Deviations system (waiting for closure): it is closed there first',
      'Deviation DEV-2026-0047 of the bulk batch TL260001 (Manufacturing › Dissolve) is still open in the Deviations system (under investigation): it is closed there first',
      'Deviation DEV-2026-0048 of the bulk batch TL260001 is still open in the Deviations system (waiting for its CAPA): it is closed there first'] });
    // The PDF lists them too.
    const open = JSON.stringify(batchRecordDoc({ ...await recordInput(t.sql, (await loadBatch(t.sql, id))!), bulk: await bulkDeviations(t.app, (await loadBatch(t.sql, id))!) }, 'QA'));
    for (const text of ['Open deviations of the bulk batch TL260001', 'Deviation DEV-2026-0047 of the bulk batch TL260001', 'Label mix-up found at packing']) expect(open).toContain(text);
    await t.owner.unsafe(`update ${TB}.deviation_v1 set status = 'closed', closed_at = now() where number in ('DEV-2026-0045', 'DEV-2026-0047', 'DEV-2026-0048')`);
    expect(await review()).toEqual({ bulk: 'TL260001', state: 'ok', open: [] });
    // The TrueBatch Liquids link does not answer (its view refused): the bulk deviations are not checked, and QA confirms
    // by hand, typed, before release.
    await t.owner.unsafe(`revoke select on ${TB}.deviation_note_v1 from ${PACKING_APP_ROLE}`);
    expect(await review()).toEqual({ bulk: 'TL260001', state: 'down', link: 'truebatch_liquids', open: [] });
    const unchecked = await release();
    expect(unchecked.statusCode).toBe(409);
    expect(unchecked.json()).toMatchObject({ problems: ['Bulk deviations not checked (TrueBatch Liquids link down): bulk batch TL260001. Check them in the Deviations system and type what you found.'] });
    const rel = await release({ bulkChecked: 'Checked in the Deviations system: none open for TL260001' });
    expect(rel.statusCode, rel.body).toBe(200);
    await t.owner.unsafe(`grant select on ${TB}.deviation_note_v1 to ${PACKING_APP_ROLE}`);
    const [relEv] = await t.owner`select payload from batch_events where batch_id = ${id} and kind = 'released'`;
    expect(relEv!.payload).toMatchObject({ bulk: { bulk: 'TL260001', state: 'down', link: 'truebatch_liquids', typed: 'Checked in the Deviations system: none open for TL260001' } });
    expect((await get(id, 'qa1')).batch.status).toBe('released');

    // TL-22 for packing: the packing record PDF, with the pack, the bulk and the packing materials.
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, (await loadBatch(t.sql, id))!, t.app.master), 'QA'));
    for (const text of ['Packing record TLP', 'TrueBatch Liquids Packing', 'batch TL260001 · 615 L issued · line FL-01', 'expiry 10/2028', 'QC report QC-26-0101', 'Packing materials',
      'bottle, child-resistant cap, measuring cup; fill 60 mL + 1.5 mL excess, 48 packs per shipper', 'Lot LABEL-1: 10200 nos', '9900 nos used',
      'Bulk deviations not checked (TrueBatch Liquids link down): bulk batch TL260001; QA confirmed by hand (typed): Checked in the Deviations system: none open for TL260001']) expect(pdf).toContain(text);
    // A count in master data's name for it (nos), as on screen and in MMS: per pack, the lots issued, the values.
    for (const text of ['"1 nos per pack"', 'Lot CARTON-1: 10200 nos', 'Quantity issued: 10200 nos', 'Used in good packs: 9840 nos']) expect(pdf).toContain(text);
    for (const text of ['"1 units per pack"', 'Lot CARTON-1: 10200 units', 'Quantity issued: 10200 units']) expect(pdf).not.toContain(text);
    // The reconciliation's worked line counts as its fields do, in the steps and in the packing materials table.
    expect(pdf).toMatch(/\(9840 nos used \+ \d+ nos destroyed \+ \d+ nos returned\) ÷ 10200 nos/);
    expect(pdf).not.toMatch(/\d+ units (used|destroyed|returned)|÷ 10200 units/);
    // The bulk in L, the bottles to fill (bulk ÷ fill target), the fill round and its time against the bulk hold, the
    // finished goods: the bulk in packs, samples and rejected bottles × the fill target, the yield in packs.
    for (const text of ['Bulk issued: 615 L', 'Theoretical packs (containers to fill): 10000 packs', '615 L ÷ 61.5 mL = 10000 packs', 'Bulk hold (hours, from the master of the bulk): 720',
      'Fill of 10 bottles: 76.9, 76.9, 76.9, 76.9, 76.9, 76.9, 76.9, 76.9, 76.9, 76.9 g', 'Mean fill: 76.9 g (limit 76.0 to 77.8 g)', 'Time since the bulk was ready: 24 h (limit not more than 720 h)',
      'Defective closures: 0 units; limit not more than 0 units', 'Room temperature: 25 °C (limit not more than 30 °C)', 'Cartons checked: 10 nos',
      'Good packs in finished cartons: 9800 packs', 'Filled containers rejected: 60 units', 'Bulk left (returned or destroyed): 5.0 L', '9800 packs ÷ 10000 packs × 100 = 98.0 %',
      '61.5 mL × 9800 packs = 602.70 L', 'Accountability of the bulk issued: 99.8 % (limit 99.5 to 100.5 %)']) expect(pdf).toContain(text);
    expect(pdf).not.toMatch(/Theoretical packs[^"]*: \d+ units|\d\.0+ packs|tablets ÷|blister/);
    // A check's line that states its own question says it once.
    expect(pdf).toContain('Packing finished: ');
    expect(pdf).not.toMatch(/Packing finished: Packing finished/i);
    const res = await as('qa1', 'GET', `/api/batches/${id}/pdf`);
    expect(res.headers['content-type']).toContain('application/pdf');

    // The published view, for MMS finished goods later.
    const [row] = await t.owner.unsafe(`select batch_number, coded_batch_number, product_code, bulk_product_code, pack_type, units_per_pack, mfg_date, expiry_month, packs::text, cartons::text, status, released, shippers::text,
        good_quantity::text, good_unit, yield_percent::text
      from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TL260001'`);
    // The output counts (for OEE): the good packs and the yield in packs of the finished goods step.
    expect(row).toMatchObject({ coded_batch_number: 'TL260001', product_code: 'PK-001', bulk_product_code: 'PRD-001', pack_type: 'bottle', units_per_pack: 1, mfg_date: '2026-11-03',
      expiry_month: '2028-10', packs: '9800', cartons: '205', status: 'RELEASED', released: true, shippers: '205', good_quantity: '9800', good_unit: 'packs', yield_percent: '98.00' });
    // For MMS (GMP traceability of the FG lot it receives): who released the batch, as signed, and when.
    const [relAt] = await t.owner<{ at: Date }[]>`select at from batch_events where batch_id = ${id} and kind = 'released'`;
    expect(await t.owner.unsafe(`select released_at, released_by from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TL260001'`))
      .toEqual([{ released_at: relAt!.at, released_by: 'QA1' }]);
    // For the Logbook: the line used, as TrueBatch Liquids publishes its machines. For MMS: the packing materials issued,
    // per lot, in the material's unit, as TrueBatch Liquids publishes what it dispensed.
    const batchNo = (await loadBatch(t.sql, id))!.batch.batchNo;
    expect(await lineUse()).toEqual({ ended: true });
    // One use of the line, for its whole filling stage (not the line named at issue, nor the clearance after packing);
    // named only in the line clearance, it was used by the stage: the Logbook reads "(Filling and packing)". The
    // machines named in a step (the rinser, the filling machine, the capper) were used by that step.
    const eq = await t.owner.unsafe(`select equipment_code, equipment_type, room_code, step, step_name, ended_at is not null as ended from ${t.schema}_report.equipment_use_v1 where batch_number = $1 order by equipment_code`, [batchNo]);
    expect(eq).toEqual([
      { equipment_code: 'AR-01', equipment_type: 'air jet rinser', room_code: 'PK-01', step: 'filling/wash', step_name: 'Filling and packing › Wash or air-rinse the containers: bottles', ended: true },
      { equipment_code: 'CP-01', equipment_type: 'capping machine', room_code: 'PK-01', step: 'filling/capping', step_name: 'Filling and packing › Cap and check the closures', ended: true },
      { equipment_code: 'FL-01', equipment_type: 'filling line', room_code: 'PK-01', step: 'filling/clearance', step_name: 'Filling and packing', ended: true },
      { equipment_code: 'FM-01', equipment_type: 'filling machine', room_code: 'PK-01', step: 'filling/fill', step_name: 'Filling and packing › Fill bottles with periodic fill checks', ended: true }]);
    // Whole-suite run, S17: the use starts when the line was recorded on the line clearance, not when that step started.
    const [use] = await t.owner.unsafe(`select started_at from ${t.schema}_report.equipment_use_v1 where batch_number = $1 and equipment_code = 'FL-01'`, [batchNo]);
    const [rec] = await t.owner<{ at: Date }[]>`select min(at) as at from step_events where batch_id = ${id} and stage = 1 and sub = 1 and step = 0 and kind = 'value'`;
    expect(use!.started_at).toEqual(rec!.at);
    const used = await t.owner.unsafe(`select lot_number, material_code, material_master_id, quantity::text, unit, step, status
      from ${t.schema}_report.material_use_v1 where batch_number = $1 order by lot_number`, [batchNo]);
    // A count in master data's unit (nos). A printed material: issued less returned to stores uncoded (labels 10200 − 200,
    // cartons 10200 − 300, leaflets 10200 − 360); the bottles, caps and cups, not reconciled, as issued.
    expect(used).toEqual([['BOTTLE-1', 'PM-201', 'pm-btl', '10200', 'nos', 'issue/issue-bottle'], ['CAP-1', 'PM-202', 'pm-cap', '10200', 'nos', 'issue/issue-cap'],
      ['CARTON-1', 'PM-205', 'pm-ctn', '9900', 'nos', 'issue/issue-carton'], ['CUP-1', 'PM-203', 'pm-cup', '10200', 'nos', 'issue/issue-cup'],
      ['LABEL-1', 'PM-204', 'pm-lbl', '10000', 'nos', 'issue/issue-label'], ['LEAFLET-1', 'PM-206', 'pm-lft', '9840', 'nos', 'issue/issue-leaflet']]
      .map(([lot_number, material_code, material_master_id, quantity, unit, step]) => ({ lot_number, material_code, material_master_id, quantity, unit, step, status: 'dispensed' })));
    // The app works out the same quantities when it compares a lot with MMS's stock (shared/engine/stock.ts).
    const done = (await loadBatch(t.sql, id))!;
    const steps = openSteps(done.doc, done.events, done.now).steps;
    for (const u of used as unknown as { lot_number: string; quantity: string }[]) expect(usesOfLot(done.doc, steps, u.lot_number).map((x) => x.quantity.value)).toEqual([u.quantity]);
    const cols = async (v: string) => (await t.owner.unsafe(`select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as c from information_schema.columns
      where table_schema = $1 and table_name = $2`, [`${t.schema}_report`, v]))[0]!.c as string;
    expect(await cols('material_use_v1')).toBe('batch_number text, lot_number text, material_code text, material_master_id text, quantity numeric, unit text, '
      + 'dispensed_at timestamp with time zone, step text, event_id bigint, status text, read_at timestamp with time zone, data_as_of timestamp with time zone, step_name text');
    expect(await cols('equipment_use_v1')).toBe('batch_number text, equipment_code text, equipment_type text, room_code text, step text, '
      + 'started_at timestamp with time zone, ended_at timestamp with time zone, read_at timestamp with time zone, data_as_of timestamp with time zone, step_name text');
    expect(await cols('deviation_note_v1')).toBe('note_id bigint, source_ref text, batch_number text, product_code text, step text, note text, reference text, status text, '
      + 'noted_at timestamp with time zone, read_at timestamp with time zone, data_as_of timestamp with time zone');

    // TL-P7: the line takes the next order once this one is finished.
    expect((await issue({ line: 'ln-1', bulk: 'TL260004', quantity: '300' })).statusCode).toBe(200);
    // Its shippers are not counted yet: null, so MMS asks for them (the last column, for MMS finished goods).
    expect(await t.owner.unsafe(`select distinct shippers from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TL260004'`)).toEqual([{ shippers: null }]);
    // Nor its output: null until the finished goods step is done.
    expect(await t.owner.unsafe(`select distinct good_quantity, good_unit, yield_percent from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TL260004'`))
      .toEqual([{ good_quantity: null, good_unit: 'packs', yield_percent: null }]);
    // Nor who released it: null until QA releases.
    expect(await t.owner.unsafe(`select distinct released_at, released_by from ${t.schema}_report.packing_batch_v1 where coded_batch_number = 'TL260004'`))
      .toEqual([{ released_at: null, released_by: null }]);
    expect((await cols('packing_batch_v1')).split(', ').slice(-6)).toEqual(['shippers numeric', 'good_quantity numeric', 'good_unit text', 'yield_percent numeric',
      'released_at timestamp with time zone', 'released_by text']);
  });

  it('pull, don\'t type: the bulk issued is what is left of the bulk batch\'s good quantity in L (batch_fact_v1.good_quantity, good_unit) less what other packing batches were issued; a part issue may be typed, more is refused', async () => {
    // TL260004: 180 L of the terminated batch (300 less 120 back), then 300 and 300 typed (no good quantity yet).
    await t.owner.unsafe(`alter table ${TB}.batch_fact_v1 add column good_quantity numeric, add column good_unit text;
      update ${TB}.batch_fact_v1 set good_quantity = 480, good_unit = 'L' where batch_number = 'TL260004';
      insert into ${TB}.batch_fact_v1 (batch_number, product_code, record_kind, status, issued_at, released, manufactured_on, bulk_ready_at, bulk_hold_hours, good_quantity, good_unit) values
        ('TL260006', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-08 06:00+00', true, '2026-11-08', now() - interval '1 day', 720, 480, 'L')`);
    t.master.equipment_.push({ ...item('ln-4', 'FL-04', 'Filling line 4'), kind: 'equipment', type: 'filling line', room: 'PK-01' },
      { ...item('ln-5', 'FL-05', 'Filling line 5'), kind: 'equipment', type: 'filling line', room: 'PK-02' });
    type Offer = { batchNo: string; goodQuantity: string | null; issued?: string; left?: string };
    const offers = async () => ((await as('issuer', 'GET', '/api/bulk-batches?product=PRD-001')).json() as { batches: Offer[] }).batches.map((b) => [b.batchNo, b.goodQuantity, b.issued, b.left]);
    expect(await offers()).toEqual([['TL260006', '480', '0', '480'], ['TL260005', null, undefined, undefined], ['TL260004', '480', '780', '0'], ['TL260001', null, undefined, undefined]]);
    // All of TL260004 is issued already.
    expect((await issue({ line: 'ln-3', bulk: 'TL260004' })).json()).toMatchObject({ problems: ['All 480 L of bulk batch TL260004 are already issued to other packing batches: nothing is left to issue.'] });
    // More than is left is refused; a part issue is taken.
    expect((await issue({ line: 'ln-3', bulk: 'TL260006', quantity: '500' })).json())
      .toMatchObject({ problems: ['Only 480 L of bulk batch TL260006 are left to issue (480 L good, 0 L already issued to other packing batches): issue 480 L or less.'] });
    const part = await issue({ line: 'ln-3', bulk: 'TL260006', quantity: '123' });
    expect(part.statusCode, part.body).toBe(200);
    const a = (part.json() as { id: number }).id;
    const s = (await get(a)).steps[0]!;
    expect(s).toMatchObject({ values: { quantity: { value: '123', unit: 'L' } }, source: { quantity: { from: 'truebatch_liquids' } } });
    expect(s.results.packs).toMatchObject({ ok: true, shown: '123 L ÷ 61.5 mL = 2000 packs' });
    // A second packing batch of the same bulk is offered what is left: 357 L.
    expect((await offers())[0]).toEqual(['TL260006', '480', '123', '357']);
    const rest = await issue({ line: 'ln-4', bulk: 'TL260006' });
    expect(rest.statusCode, rest.body).toBe(200);
    const b = (rest.json() as { id: number }).id;
    expect((await get(b)).steps[0]!.values.quantity).toEqual({ value: '357', unit: 'L' });
    expect((await issue({ line: 'ln-5', bulk: 'TL260006', quantity: '1' })).json()).toMatchObject({ problems: [expect.stringMatching(/^All 480 L of bulk batch TL260006 are already issued/)] });
    // The second is terminated: 357 L went back unused, so 357 L can be issued again.
    const qa = await get(b, 'qa1');
    const end = await as('qa1', 'POST', `/api/batches/${b}/terminate`, { proof: proofFor('qa1'), contentHash: (qa.batch as { contentHash: string }).contentHash, reason: 'Wrong line',
      returns: [{ lot: 'TL260006', value: '357', unit: 'L' }] });
    expect(end.statusCode, end.body).toBe(200);
    expect((await offers())[0]).toEqual(['TL260006', '480', '123', '357']);
    // The first batch's bulk corrected on the floor: up to what is left besides its own issue.
    const fix = (quantity: string) => as('op1', 'POST', `/api/batches/${a}/steps/0.1.0.1/record`, { values: { quantity } });
    expect((await fix('481')).json()).toMatchObject({ problems: [expect.stringMatching(/^Only 480 L of bulk batch TL260006 are left to issue \(480 L good, 0 L already issued/)] });
    const fixed = await fix('400');
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect((await get(a)).steps[0]!.values.quantity).toEqual({ value: '400', unit: 'L' });
    const again = await issue({ line: 'ln-4', bulk: 'TL260006' });
    expect(again.statusCode, again.body).toBe(200);
    expect((await get((again.json() as { id: number }).id)).steps[0]!.values.quantity).toEqual({ value: '80', unit: 'L' });
    // A bulk TrueBatch Liquids gives in another unit than the master fills is refused, never converted.
    await t.owner.unsafe(`update ${TB}.batch_fact_v1 set good_unit = 'kg' where batch_number = 'TL260006'`);
    expect((await issue({ line: 'ln-5', bulk: 'TL260006' })).json())
      .toMatchObject({ problems: ['Bulk batch TL260006 is given in kg in TrueBatch Liquids; this packing master fills a bulk in L.'] });
  });
});
