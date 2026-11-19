import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems, type Block } from '../shared/blocks/format.js';
import { coaRefusal, resultRefusal, type Coa, type QcResult } from '../shared/engine/lims.js';
import { qcReportText } from '../shared/engine/release.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { small } from './engine-fixture.js';

// Readers round 2: QC's certificate of analysis (CoA) and results from Medhanta LIMS (coa_v1, result_v1), read through
// a fake LIMS schema in the test database with TrueBatch's restricted login, as on the platform. While LIMS answers a
// QC result, the batch's QC approval and the QC report of a lot typed by hand are PICKED from an approved CoA of this
// batch or lot; absent or down, they are typed by hand as before.

const coa = (o: Partial<Coa> = {}): Coa => ({ coaId: 'c1', coaNumber: 'COA26001', sampleNumber: 'LS26001', lotNumber: 'TL260001', itemKind: 'PRODUCT', itemMasterId: 'p',
  itemCode: 'P', itemName: 'P', purpose: 'release', decision: 'APPROVED', decidedAt: '2026-11-19T06:00:00Z', decidedBy: 'QC ONE', specNumber: 'SPEC-P', specVersion: 1, ...o });
const batch = { kind: 'PRODUCT' as const, batchNo: 'TL260001', productCode: 'P' };
const lot = { kind: 'MATERIAL' as const, lot: 'LOT-1', materialId: 'm', materialCode: 'M' };

describe('the LIMS rules (shared/engine/lims.ts): only an approved CoA of this batch or lot', () => {
  it('TL-21 an approved release CoA of this batch, of its product, may be used; the batch number without case', () => {
    expect(coaRefusal(coa(), batch)).toBeNull();
    expect(coaRefusal(coa({ lotNumber: 'tl260001 ' }), batch)).toBeNull();
  });

  it.each([
    ['rejected', { decision: 'REJECTED', coaNumber: null }, 'CoA of sample LS26001 is not approved in LIMS (rejected): only an approved CoA may be used.'],
    ['approved, then rejected', { rejected: true }, 'CoA COA26001 is not approved in LIMS (approved): only an approved CoA may be used.'],
    ['of another batch', { lotNumber: 'TL260002' }, 'CoA COA26001 is for batch TL260002, not batch TL260001.'],
    ['of another product', { itemCode: 'Q' }, 'CoA COA26001 is of Q, not P.'],
    ['of a material', { itemKind: 'MATERIAL' }, 'CoA COA26001 is of a material sample, not of batch TL260001.'],
    ['of a stability sample', { purpose: 'stability' }, 'CoA COA26001 is of a stability sample: only the release CoA of batch TL260001 may be used.'],
  ] as [string, Partial<Coa>, string][])('TL-21 a CoA %s may not be used', (_, o, why) => {
    expect(coaRefusal(coa(o), batch)).toBe(why);
  });

  it('TL-12 a lot\'s CoA: approved, of this lot and the step\'s material, of a release or retest sample', () => {
    const m = (o: Partial<Coa> = {}) => coa({ lotNumber: 'LOT-1', itemKind: 'MATERIAL', itemMasterId: 'm', itemCode: 'M', ...o });
    expect(coaRefusal(m(), lot)).toBeNull();
    expect(coaRefusal(m({ purpose: 'retest' }), lot)).toBeNull();
    expect(coaRefusal(m({ itemMasterId: 'x', itemCode: 'X' }), lot)).toBe('CoA COA26001 is of X, not M.');
    expect(coaRefusal(m({ lotNumber: 'LOT-2' }), lot)).toBe('CoA COA26001 is for lot LOT-2, not lot LOT-1.');
    expect(coaRefusal(m({ decision: 'REJECTED' }), lot)).toMatch(/not approved in LIMS/);
  });

  it('TL-14 a QC result gives LIMS\'s reported figure, in the unit the step asks for', () => {
    const r = (o: Partial<QcResult> = {}): QcResult => ({ resultId: 'r1', coaId: 'c1', coaNumber: 'COA26001', testName: 'Assay', reported: '99.4', unit: '%', limitText: '95.0 - 105.0', analysisNumber: 'LA26001', outsideLab: null, ...o });
    expect(resultRefusal(r(), '%')).toBeNull();
    expect(resultRefusal(r({ reported: null }), '%')).toBe('Assay of CoA COA26001 has no reported figure in LIMS.');
    expect(resultRefusal(r({ reported: 'complies' }), '%')).toBe('Assay of CoA COA26001 has no reported figure in LIMS.');
    expect(resultRefusal(r({ unit: 'mg' }), '%')).toBe('Assay of CoA COA26001 is in mg, not in %.');
    // pH has no unit in LIMS: a pH field takes it; another field does not take a result without a unit.
    expect(resultRefusal(r({ testName: 'pH', reported: '5.1', unit: '' }), 'pH')).toBeNull();
    expect(resultRefusal(r({ testName: 'pH', reported: '5.1', unit: null }), 'pH')).toBeNull();
    expect(resultRefusal(r({ unit: '' }), '%')).toBe('Assay of CoA COA26001 is in no unit, not in %.');
  });

  it('a QC result field is a single number (the block check)', () => {
    const b = findBlock({ id: 'bulk-test', version: 1 })!;
    // The bulk's QC results; the sample and bioburden references and the appearance are not.
    expect(b.fields.filter((f) => f.qc).map((f) => f.name)).toEqual(['ph', 'density', 'viscosity', 'assay', 'ethanol', 'preservative']);
    expect(blockProblems(b)).toEqual([]);
    const bad: Block = { ...b, fields: b.fields.map((f) => (f.name === 'reference' ? { ...f, qc: true as const } : f)) };
    expect(blockProblems(bad)).toEqual(['field reference: only a single number is a QC result from LIMS']);
  });

  it('QC approval\'s report in words: from LIMS, or typed by hand', () => {
    expect(qcReportText({ reportNo: 'COA26001', source: { from: 'lims', asOf: null, shown: 'LIMS CoA COA26001: sample LS26001' } })).toBe('QC report COA26001 (LIMS CoA COA26001: sample LS26001)');
    expect(qcReportText({ reportNo: 'QC-1', source: { from: 'hand', link: 'lims', state: 'down' } })).toBe('QC report QC-1 (typed by hand: LIMS link down)');
    expect(qcReportText({ reportNo: 'QC-1' })).toBe('QC report QC-1');
  });
});

let t: TestApp;
let provider: Sql;
let L = '';
const cookies: Record<string, string> = {};

beforeAll(async () => {
  t = await freshApp(async (db) => {
    L = `${db.schema}_lims`;
    // LIMS's published views, as tables with the same columns (db/migrations 0009, 0018, 0022 of LIMS).
    await db.owner.unsafe(`
      create schema ${L};
      create table ${L}.coa_v1 (coa_id uuid, coa_number text, sample_number text, lot_number text, item_kind text, item_master_id text, item_code text,
        item_name text, purpose text, decision text, decided_at timestamptz, decided_by text, spec_number text, spec_version int, reason text,
        read_at timestamptz default now(), data_as_of timestamptz default now());
      create table ${L}.result_v1 (result_id uuid, coa_id uuid, coa_number text, sample_number text, lot_number text, item_master_id text, item_code text,
        test_key text, test_name text, value numeric, unit text, shown text, limit_text text, passed boolean, method_code text, analysis_number text,
        decision text, decided_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now(), reported text, outside_lab text);
      grant usage on schema ${L} to truebatch_liquids_app;
      grant select on all tables in schema ${L} to truebatch_liquids_app;`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_liquids_app', link: true });
    return links({ lims: provider }, { lims: L });
  });
  t.master.products_.push({ itemId: 'p', code: 'P', name: 'P', version: 1, active: true, strength: null, dosageForm: 'syrup' });
  t.master.materials_.push({ itemId: 'm', code: 'M', name: 'M', version: 1, active: true, category: null, unit: 'kg' });
  t.master.equipment_.push({ itemId: 'eq-bal', code: 'BAL-01', name: 'Balance', version: 1, active: true, kind: 'instrument', type: 'balance', room: 'DSP-01' });
  const people = { author: ['truebatch_liquids.master.author'], issuer: ['truebatch_liquids.batch.issue'], asha: ['truebatch_liquids.batch.operate', 'truebatch_liquids.batch.check'], quinn: ['truebatch_liquids.qc.approve'] } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => {
  await provider?.end();
  if (L) await t.owner.unsafe(`drop schema if exists ${L} cascade`);
  await t?.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const cut = () => t.owner.unsafe(`revoke select on all tables in schema ${L} from truebatch_liquids_app`);
const restore = () => t.owner.unsafe(`grant select on all tables in schema ${L} to truebatch_liquids_app`);
async function issue(steps: object[]) {
  const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
  const res = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [...steps, yieldStep] }]) });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  return b.json() as { id: number; batchNo: string };
}
type StepJson = { id: string; values: Record<string, unknown>; source: Record<string, { from: string; state?: string; link?: string; shown?: string }> };
const stepOf = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: StepJson[] }).steps.find((s) => s.id === key)!;
const record = (id: number, values: object) => as('asha', 'POST', `/api/batches/${id}/steps/0.1.0.1/record`, { values });
const problems = async (p: ReturnType<typeof record>) => ((await p).json() as { problems: string[] }).problems;
/** A decided LIMS sample of `lotNo` with its results (test name, reported figure, unit). */
let n = 0;
async function decided(lotNo: string, o: { kind?: string; item?: string; code?: string; purpose?: string; decision?: string; results?: [string, string | null, string][] } = {}) {
  n += 1;
  const number = `COA26${String(n).padStart(3, '0')}`;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const decision = o.decision ?? 'APPROVED';
  await t.owner.unsafe(`insert into ${L}.coa_v1 (coa_id, coa_number, sample_number, lot_number, item_kind, item_master_id, item_code, item_name, purpose, decision, decided_at, decided_by, spec_number, spec_version)
    values ($1, $2, $3, $4, $5, $6, $7, 'Item', $8, $9, now(), 'QC ONE', 'SPEC-1', 2)`,
  [id, decision === 'APPROVED' ? number : null, `LS26${String(n).padStart(3, '0')}`, lotNo, o.kind ?? 'PRODUCT', o.item ?? 'p', o.code ?? 'P', o.purpose ?? 'release', decision]);
  for (const [i, [test, reported, unit]] of (o.results ?? []).entries()) {
    await t.owner.unsafe(`insert into ${L}.result_v1 (result_id, coa_id, coa_number, lot_number, test_key, test_name, value, unit, limit_text, analysis_number, decision, decided_at, reported)
      values ($1, $2, $3, $4, $5, $5, $6, $7, '95.0 - 105.0', 'LA26001', $8, now(), $9)`,
    [`00000000-0000-0000-${String(n).padStart(4, '0')}-${String(i).padStart(12, '0')}`, id, decision === 'APPROVED' ? number : null, lotNo, test, reported ? Number(reported) + 0.004 : null, unit, decision, reported]);
  }
  return number;
}
type Picks = { link: string; coas: { coaNumber: string; shown: string }[]; results: { resultId: string; coaNumber: string; testName: string; reported: string; shown: string }[] };
const picks = async (id: number, q: string) => (await as('asha', 'GET', `/api/batches/${id}/lims${q}`)).json() as Picks;
const bulkTest = { block: { id: 'bulk-test', version: 1 }, checker: true, settings: { assayLimit: { low: '95.0', high: '105.0', unit: '%' }, phLimit: { low: '4.5', high: '5.5', unit: 'pH' } } };

describe('a QC result of the batch, picked from LIMS', () => {
  let b: { id: number; batchNo: string };
  let good = '';
  beforeAll(async () => {
    b = await issue([bulkTest]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {});
    good = await decided(b.batchNo, { results: [['Assay', '99.4', '%'], ['Viscosity', '95', 'mPa·s'], ['Water', null, '%'], ['pH', '5.1', '']] });
    await decided(b.batchNo, { decision: 'REJECTED', results: [['Assay', '91.0', '%']] });
    await decided(b.batchNo, { purpose: 'stability', results: [['Assay', '98.0', '%']] });
    await decided(b.batchNo, { code: 'Q', results: [['Assay', '97.0', '%']] });
    await decided('TL269999', { results: [['Assay', '96.0', '%']] });
  });

  it('TL-14 only the results in % of the approved release CoA of this batch, with a reported figure, are offered', async () => {
    const p = await picks(b.id, '?unit=%25');
    expect(p.link).toBe('ok');
    expect(p.results.map((r) => [r.coaNumber, r.testName, r.reported])).toEqual([[good, 'Assay', '99.4']]);
    expect(p.results[0]!.shown).toBe(`LIMS CoA ${good}: Assay 99.4 % as reported (limit 95.0 - 105.0), analysis LA26001`);
  });

  it('TL-14 while LIMS answers the assay is picked (its reported figure, kept with the CoA number); typing it is refused', async () => {
    expect(await problems(record(b.id, { assay: '99.0' }))).toEqual([`Assay (% of target) comes from LIMS: pick the result of the approved CoA of batch ${b.batchNo}.`]);
    expect(await problems(record(b.id, { assay: { lims: 'not-a-result' } }))).toEqual([`Assay (% of target): that result is not a result in % of an approved CoA of batch ${b.batchNo} in LIMS.`]);
    const [r] = (await picks(b.id, '?unit=%25')).results;
    expect((await record(b.id, { assay: { lims: r!.resultId } })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values.assay).toEqual({ value: '99.4', unit: '%' });
    expect(s.source.assay).toEqual({ from: 'lims', asOf: null, shown: `LIMS CoA ${good}: Assay 99.4 % as reported (limit 95.0 - 105.0), analysis LA26001` });
    // A pick may be picked again (another result, or the same); a typed number over it is still refused.
    expect((await record(b.id, { assay: { lims: r!.resultId } })).statusCode).toBe(200);
    expect(await problems(record(b.id, { assay: '98.0' }))).toEqual([`Assay (% of target) comes from LIMS: pick the result of the approved CoA of batch ${b.batchNo}.`]);
  });

  it('TL-14 the pH, kept without a unit in LIMS, is picked for the pH field', async () => {
    const p = await picks(b.id, '?unit=pH');
    expect(p.results.map((r) => [r.testName, r.reported])).toEqual([['pH', '5.1']]);
    expect((await record(b.id, { ph: { lims: p.results[0]!.resultId } })).statusCode).toBe(200);
    expect((await stepOf(b.id, '0.1.0.1')).values.ph).toEqual({ value: '5.1', unit: 'pH' });
  });

  it('TL-14 a rejected CoA, a stability sample, another product or another batch: their results cannot be picked', async () => {
    const ids = (await t.owner.unsafe(`select r.result_id::text as id from ${L}.result_v1 r join ${L}.coa_v1 c using (coa_id)
      where c.decision = 'REJECTED' or c.purpose = 'stability' or c.item_code = 'Q' or c.lot_number = 'TL269999'`)).map((x) => x.id as string);
    expect(ids).toHaveLength(4);
    for (const id of ids) expect(await problems(record(b.id, { assay: { lims: id } }))).toEqual([`Assay (% of target): that result is not a result in % of an approved CoA of batch ${b.batchNo} in LIMS.`]);
  });

  it('TL-14 LIMS down: the assay is typed from the QC report, marked typed by hand (a second person checks it); a pick is refused', async () => {
    await cut();
    try {
      expect((await picks(b.id, '?unit=%25')).link).toBe('down');
      expect(await problems(record(b.id, { assay: { lims: 'x' } }))).toEqual(['LIMS does not answer now: type Assay (% of target) from the QC report.']);
      expect((await record(b.id, { assay: '99.1' })).statusCode).toBe(200);
    } finally { await restore(); }
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values.assay).toEqual({ value: '99.1', unit: '%' });
    expect(s.source.assay).toEqual({ from: 'hand', link: 'lims', state: 'down' });
    const review = (await as('asha', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string }[] };
    expect(review.hand).toContainEqual(expect.objectContaining({ field: 'assay', link: 'lims' }));
  });
});

describe('QC approval of the batch with its CoA from LIMS', () => {
  let b: { id: number; batchNo: string };
  let good = '';
  let rejected = '';
  beforeAll(async () => {
    b = await issue([{}]);
    // The record is complete and production approved (the steps' own tests are elsewhere): its event, as the route writes it.
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${b.id}, 'production_approved', '{}', (select id from users where username = 'asha'))`;
    good = await decided(b.batchNo);
    rejected = await decided(b.batchNo, { decision: 'REJECTED' });
    await decided('TL269998');
  });
  const approve = async (reportNo: string) => as('quinn', 'POST', `/api/batches/${b.id}/qc-approve`,
    { proof: proofFor('quinn'), reportNo, contentHash: ((await as('quinn', 'GET', `/api/batches/${b.id}`)).json() as { batch: { contentHash: string } }).batch.contentHash });

  it('TL-21 QC picks the approved release CoA of this batch: only it is offered', async () => {
    const p = await picks(b.id, '');
    expect(p.coas.map((c) => c.coaNumber)).toEqual([good]);
    expect(p.coas[0]!.shown).toBe(`LIMS CoA ${good}: sample LS26${good.slice(5)}, P ${b.batchNo}, approved by QC ONE, specification SPEC-1 v2`);
    expect(rejected).toMatch(/^COA26/);
  });

  it('TL-21 while LIMS answers, a number that is not an approved CoA of this batch there is refused', async () => {
    expect((await approve('QC-26-0042')).json()).toMatchObject({ error: 'not_in_lims', problems: [`QC-26-0042 is not an approved CoA of batch ${b.batchNo} in LIMS: pick one.`] });
    // The rejected sample has no CoA number; another batch's CoA is not this batch's.
    expect((await approve('COA26' + String(Number(good.slice(5)) + 2).padStart(3, '0'))).json()).toMatchObject({ error: 'not_in_lims' });
  });

  it('TL-21 the picked CoA is kept with the approval (signed with it), on the release screen and in the PDF', async () => {
    const r = await approve(good.toLowerCase());
    expect(r.statusCode, r.body).toBe(200);
    const [e] = await t.owner<{ payload: { reportNo: string; source: { from: string; shown: string } } }[]>`select payload from batch_events where batch_id = ${b.id} and kind = 'qc_approved'`;
    // The CoA number as LIMS writes it.
    expect(e!.payload).toMatchObject({ reportNo: good, source: { from: 'lims', shown: expect.stringContaining(`LIMS CoA ${good}`) } });
    const l = (await loadBatch(t.sql, b.id))!;
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.master), 'QUINN', new Date(), false));
    expect(pdf).toContain(`QC report ${good} (LIMS CoA ${good}`);
  });

  it('TL-21 LIMS absent or down: the QC report number is typed, marked typed by hand', async () => {
    const c = await issue([{}]);
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${c.id}, 'production_approved', '{}', (select id from users where username = 'asha'))`;
    await cut();
    try {
      const hash = ((await as('quinn', 'GET', `/api/batches/${c.id}`)).json() as { batch: { contentHash: string } }).batch.contentHash;
      const r = await as('quinn', 'POST', `/api/batches/${c.id}/qc-approve`, { proof: proofFor('quinn'), reportNo: 'QC-26-0042', contentHash: hash });
      expect(r.statusCode, r.body).toBe(200);
    } finally { await restore(); }
    const [e] = await t.owner<{ payload: object }[]>`select payload from batch_events where batch_id = ${c.id} and kind = 'qc_approved'`;
    expect(e!.payload).toEqual({ reportNo: 'QC-26-0042', source: { from: 'hand', link: 'lims', state: 'down' } });
  });
});

describe('the QC report of a lot typed by hand, picked from LIMS', () => {
  const weigh = { block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'x' }, tolerance: '1.0' } };
  let b: { id: number; batchNo: string };
  let good = '';
  let other = '';
  beforeAll(async () => {
    b = await issue([weigh]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {});
    good = await decided('LOT-1', { kind: 'MATERIAL', item: 'm', code: 'M' });
    other = await decided('LOT-1', { kind: 'MATERIAL', item: 'x', code: 'X' });
  });

  it('TL-12 MMS not linked, LIMS answers: the lot\'s QC report is an approved CoA of this lot and material in LIMS', async () => {
    expect((await record(b.id, { lot: 'LOT-1', ...handLabels('lot', 'lot') })).statusCode).toBe(200);
    expect((await picks(b.id, '?key=0.1.0.1&lot=LOT-1')).coas.map((c) => c.coaNumber)).toEqual([good]);
    expect(await problems(record(b.id, { 'lot.report': 'SUP-123' }))).toEqual(['SUP-123 is not an approved CoA of lot LOT-1 in LIMS: pick one.']);
    expect(await problems(record(b.id, { 'lot.report': other }))).toEqual([`CoA ${other} is of X, not M.`]);
    expect((await record(b.id, { 'lot.report': good.toLowerCase() })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values['lot.report']).toBe(good);
    expect(s.source['lot.report']).toMatchObject({ from: 'lims', shown: expect.stringContaining(`LIMS CoA ${good}: sample`) });
    expect(s.source.lot).toEqual({ from: 'hand', link: 'mms', state: 'absent' });
  });

  it('TL-12 LIMS down too: the QC report number is typed as before', async () => {
    await cut();
    try { expect((await record(b.id, { 'lot.report': 'SUP-123' })).statusCode).toBe(200); } finally { await restore(); }
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values['lot.report']).toBe('SUP-123');
    expect(s.source['lot.report']).toEqual({ from: 'hand', link: 'lims', state: 'down' });
  });
});
