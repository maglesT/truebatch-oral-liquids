import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems, type Block, type BlockField } from '../shared/blocks/format.js';
import { answersField, coaRefusal, fieldRefusal, inProcessFit, inProcessText, labRequestId, labTests, requestFits, resultRefusal, sameUnit, type Coa, type QcResult } from '../shared/engine/lims.js';
import { Dec, roundHalfUp, t14ContentUniformity } from '../shared/templates/index.js';
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
    // round 41: the same unit written two ways matches (pH has no unit in LIMS); a different unit still does not
    expect(resultRefusal(r({ testName: 'pH', reported: '5.1', unit: '' }), 'pH')).toBeNull();
    expect(resultRefusal(r({ unit: null, testName: 'pH' }), 'pH')).toBeNull();
    expect(resultRefusal(r({ unit: 'pH', testName: 'pH' }), 'pH')).toBeNull();
    expect(resultRefusal(r({ unit: 'mPa.s', testName: 'Viscosity' }), 'mPa·s')).toBeNull();
    expect(resultRefusal(r({ unit: 'g/ml', testName: 'Density' }), 'g/mL')).toBeNull();
    expect(resultRefusal(r({ unit: '% v/v', testName: 'Alcohol' }), '%v/v')).toBeNull();
    expect(resultRefusal(r({ unit: '%w/v' }), '%w/w')).toBe('Assay of CoA COA26001 is in %w/v, not in %w/w.');
    expect(resultRefusal(r({ unit: '' }), '%')).toBe('Assay of CoA COA26001 is in no unit, not in %.');
  });

  it('a QC result field is a single number (the block check)', () => {
    const b = findBlock({ id: 'bulk-test', version: 1 })!;
    // The bulk's QC results (round 42: an in-process sample, before filling); the sample and bioburden references and the appearance are not.
    expect(b.fields.filter((f) => f.qc === 'in_process').map((f) => f.name)).toEqual(['ph', 'density', 'viscosity', 'assay', 'ethanol', 'preservative']);
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
        read_at timestamptz default now(), data_as_of timestamptz default now(), request_id text);
      create table ${L}.result_v1 (result_id uuid, coa_id uuid, coa_number text, sample_number text, lot_number text, item_master_id text, item_code text,
        test_key text, test_name text, value numeric, unit text, shown text, limit_text text, passed boolean, method_code text, analysis_number text,
        decision text, decided_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now(), reported text, outside_lab text,
        request_id text, individual_values numeric[], figure text);
      grant usage on schema ${L} to truebatch_liquids_app;
      grant select on all tables in schema ${L} to truebatch_liquids_app;`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_liquids_app', link: true });
    return links({ lims: provider }, { lims: L });
  });
  t.master.products_.push({ itemId: 'p', code: 'P', name: 'P', version: 1, active: true, strength: null, dosageForm: 'syrup' });
  t.master.materials_.push({ itemId: 'm', code: 'M', name: 'M', version: 1, active: true, category: null, unit: 'kg' });
  t.master.equipment_.push({ itemId: 'eq-bl', code: 'BL-01', name: 'Blender', version: 1, active: true, kind: 'equipment', type: 'bin blender', room: 'DSP-01' });
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
type Picks = { link: string; coas: { coaNumber: string; shown: string }[]; results: { resultId: string; coaNumber: string; testName: string; reported: string; unit: string | null; shown: string }[] };
const picks = async (id: number, q: string) => (await as('asha', 'GET', `/api/batches/${id}/lims${q}`)).json() as Picks;
const bulkTest = { block: { id: 'bulk-test', version: 1 }, checker: true, settings: { assayLimit: { low: '95.0', high: '105.0', unit: '%' }, phLimit: { low: '4.5', high: '5.5', unit: 'pH' } } };

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

// ---- Round 42: in-process lab tests picked from LIMS (the step's own lab request, lab_request_v1).

const L1_PASS = ['99.0', '100.0', '101.0', '98.5', '100.5', '99.5', '100.2', '99.8', '100.1', '99.9'];
const L1_FAIL = ['85.0', '115.0', '88.0', '112.0', '90.0', '110.0', '92.0', '108.0', '95.0', '105.0'];
const MORE = ['99.0', '101.0', '100.0', '99.5', '100.5', '98.0', '102.0', '99.0', '101.0', '100.0', '99.8', '100.2', '99.6', '100.4', '98.8', '101.2', '99.9', '100.1', '99.7', '100.3'];
const av = (values: string[]) => { const t = t14ContentUniformity({ method: 'content uniformity', coating: 'uncoated', results: { values, unit: '%' } }); if (!t.ok) throw new Error(t.message); return t.value.toFixed(1); };
const mean = (values: string[]) => roundHalfUp(values.reduce((a, v) => a.plus(v), new Dec(0)).div(values.length), 1).toFixed(1);

// Tablets' content uniformity block (Liquids has none): the engine's staged lists and acceptance value are the same
// code in every edition, tested here on its fields.
const CU: Block = {
  id: 'content-uniformity', version: 1, name: 'Content uniformity sampling', checker: true, instruction: 'Test fixture.',
  fields: [
    { name: 'results', label: 'Content of 10 tablets (% of label claim)', kind: 'number', unit: '%', count: 10, qc: 'in_process', figure: 'AV', nextStage: 'moreResults' },
    { name: 'moreResults', label: 'Content of 20 more tablets (% of label claim)', kind: 'number', unit: '%', count: 20, optional: true, qc: 'in_process', figure: 'AV' },
  ],
  settings: [{ name: 'coating', label: 'Coating', kind: 'text', options: ['uncoated', 'film-coated', 'sugar-coated', 'other coated'] }],
  calcs: [{ name: 'acceptance', label: 'Content uniformity', template: 'C6', args: { test: 'content uniformity', coating: '$coating', stages: ['$results', '$moreResults?'] } }],
};

describe('the in-process rules (shared/engine/lims.ts): this step\'s request, the values as LIMS keeps them', () => {
  const req = 'TL260001/0.1.0.1';
  const want = { ...batch, request: req };
  const ipr = (o: Partial<Coa> = {}) => coa({ coaNumber: 'IPR2600001', purpose: 'in_process', requestId: req, ...o });
  const cu = CU;
  const bt = findBlock({ id: 'bulk-test', version: 1 })!;
  const bu = findBlock({ id: 'blend-uniformity', version: 1 })!;
  const results = cu.fields.find((f) => f.name === 'results')!;
  const more = cu.fields.find((f) => f.name === 'moreResults')!;
  const r = (individual: string[] | null, o: Partial<QcResult> = {}): QcResult => ({ resultId: 'r', coaId: 'c', coaNumber: 'IPR2600001', testName: 'Content uniformity', reported: individual?.length === 10 || individual?.length === 30 ? av(individual) : '99.0',
    unit: '%', limitText: null, analysisNumber: 'LA26009', outsideLab: null, requestId: req, individual, figure: 'AV', ...o });

  it('TL-14 an approved in-process report of this step\'s request may be used; another request, a release CoA or an unapproved report not', () => {
    expect(coaRefusal(ipr(), want)).toBeNull();
    expect(coaRefusal(ipr({ requestId: 'TL260001/0.1.1.1' }), want)).toBe(`In-process report IPR2600001 is for request TL260001/0.1.1.1, not request ${req} (this step) or an earlier round of it.`);
    expect(coaRefusal(ipr({ purpose: 'release', requestId: null }), want)).toBe(`CoA IPR2600001 is of a release sample: only an in-process report of request ${req} (this step) may be used.`);
    expect(coaRefusal(ipr({ decision: 'REJECTED' }), want)).toMatch(/not approved in LIMS/);
    expect(coaRefusal(ipr({ lotNumber: 'TL260002' }), want)).toBe('CoA IPR2600001 is for batch TL260002, not batch TL260001.');
    // ... and an in-process report is never the batch's release CoA.
    expect(coaRefusal(ipr(), batch)).toBe('CoA IPR2600001 is of an in-process sample: only the release CoA of batch TL260001 may be used.');
    expect(labRequestId('TL260001', '0.1.0.1')).toBe(req);
  });

  it('round 43: a step takes its own request or an EARLIER round of the same step, never a later round, another step or batch', () => {
    expect(requestFits('TL260001/0.1.0.1', 'TL260001/0.1.0.1')).toBe(true);
    expect(requestFits('tl260001/0.1.0.1', 'TL260001/0.1.0.5')).toBe(true);
    expect(requestFits('TL260001/0.1.0.6', 'TL260001/0.1.0.5')).toBe(false);
    expect(requestFits('TL260001/0.1.1.1', 'TL260001/0.1.0.5')).toBe(false);
    expect(requestFits('TL260001/0.2.0.1', 'TL260001/0.1.0.5')).toBe(false);
    expect(requestFits('TL260002/0.1.0.1', 'TL260001/0.1.0.5')).toBe(false);
    expect(requestFits(null, req)).toBe(false);
    const w3 = { ...batch, request: 'TL260001/0.1.0.3' };
    expect(coaRefusal(ipr(), w3)).toBeNull();
    expect(coaRefusal(ipr({ requestId: 'TL260001/0.1.0.4' }), w3)).toBe('In-process report IPR2600001 is for request TL260001/0.1.0.4, not request TL260001/0.1.0.3 (this step) or an earlier round of it.');
  });

  it('round 43: the record says which round\'s sample was used and when it was sampled (a step without rounds: when its request opened)', () => {
    const x = r(L1_PASS);
    expect(inProcessText(x, req, { round: 1, at: '2026-11-19T05:10:00.000Z' })).toBe(`LIMS in-process report IPR2600001: Content uniformity (request ${req}, sampled in round 1 at 2026-11-19T05:10:00.000Z), 10 values, acceptance value ${av(L1_PASS)} % as reported, analysis LA26009`);
    expect(inProcessText(x, req, { at: '2026-11-19T05:10:00.000Z' })).toContain(`(request ${req}, requested 2026-11-19T05:10:00.000Z), 10 values`);
    expect(inProcessText(x, req)).toContain(`(request ${req}), 10 values`);
  });

  it('round 43: a field whose unit is not set is not asked for (none of Tablets\' in-process fields: their unit is fixed)', () => {
    expect(labTests(cu.fields, () => '')).toEqual([]);
    for (const b of [cu, bu, bt]) expect(b.fields.filter((f) => f.qc === 'in_process').every((f) => f.unit && !f.unit.startsWith('$'))).toBe(true);
  });

  it('TL-14 a list takes exactly its count of LIMS\'s values in order: 9 or 11 are refused, never padded or cut', () => {
    expect(inProcessFit(r(L1_PASS), results, '%', cu.fields)).toEqual({ take: { results: L1_PASS } });
    expect(inProcessFit(r(L1_PASS.slice(0, 9), { figure: null }), results, '%', cu.fields)).toEqual({ error: 'Content uniformity of in-process report IPR2600001 has 9 values in LIMS; Content of 10 tablets (% of label claim) takes exactly 10 (or 30 with content of 20 more tablets (% of label claim)). Values are never added or left out: ask QC to check the result in LIMS.' });
    expect(inProcessFit(r([...L1_PASS, '99.0'], { figure: null }), results, '%', cu.fields)).toMatchObject({ error: expect.stringContaining('has 11 values in LIMS') });
    expect(inProcessFit(r(null, { figure: 'result' }), results, '%', cu.fields)).toMatchObject({ error: expect.stringContaining('has no individual values in LIMS') });
    expect(inProcessFit(r(L1_PASS, { unit: 'mg' }), results, '%', cu.fields)).toEqual({ error: 'Content uniformity of in-process report IPR2600001 is in mg, not in %.' });
    expect(inProcessFit(r(L1_PASS, { figure: 'mean' }), results, '%', cu.fields)).toMatchObject({ error: expect.stringContaining('reports the mean, not the acceptance value') });
  });

  it('TL-14 LIMS\'s reported figure must agree with the step\'s own from the same values; else both numbers are named', () => {
    expect(inProcessFit(r(L1_PASS, { reported: '9.9' }), results, '%', cu.fields)).toEqual({ error: `LIMS reports the acceptance value of Content uniformity of in-process report IPR2600001 as 9.9; TrueBatch works it out from the same 10 values as ${av(L1_PASS)}: ask QC to check the result in LIMS.` });
    const loc = bu.fields.find((f) => f.name === 'results')!;
    expect(inProcessFit(r(L1_PASS, { figure: 'mean', reported: mean(L1_PASS) }), loc, '%', bu.fields)).toEqual({ take: { results: L1_PASS } });
    expect(inProcessFit(r(L1_PASS, { figure: 'mean', reported: '101.0' }), loc, '%', bu.fields)).toMatchObject({ error: expect.stringContaining(`as 101.0; TrueBatch works it out from the same 10 values as ${mean(L1_PASS)}`) });
  });

  it('TL-14 content uniformity in two stages: 30 values give L1 and L2; the 20 more are values 11 to 30, refused when the first 10 differ', () => {
    const all = [...L1_FAIL, ...MORE];
    expect(inProcessFit(r(all), results, '%', cu.fields)).toEqual({ take: { results: L1_FAIL, moreResults: MORE } });
    const had = { results: L1_FAIL.map((value) => ({ value, unit: '%' })) };
    expect(inProcessFit(r(all), more, '%', cu.fields, had)).toEqual({ take: { moreResults: MORE } });
    // The same figures written another way are the same values.
    expect(inProcessFit(r(all), more, '%', cu.fields, { results: L1_FAIL.map((v) => ({ value: `${v}0`, unit: '%' })) })).toEqual({ take: { moreResults: MORE } });
    const other = [...L1_PASS, ...MORE];
    expect(inProcessFit(r(other), more, '%', cu.fields, had)).toEqual({ error: `The first 10 values of Content uniformity of in-process report IPR2600001 (${L1_PASS.join(', ')}) are not the 10 recorded for content of 10 tablets (% of label claim) (${L1_FAIL.join(', ')}): ask QC to check the result in LIMS.` });
    // A separate result of the 20 more: LIMS's AV is of all 30 (L1's recorded 10 and these 20).
    expect(inProcessFit(r(MORE, { reported: av(all) }), more, '%', cu.fields, had)).toEqual({ take: { moreResults: MORE } });
    expect(inProcessFit(r(MORE, { reported: av(all) }), more, '%', cu.fields)).toMatchObject({ error: expect.stringMatching(/^Pick content of 10 tablets .* first/) });
  });

  it('a single in-process figure (the bulk test) takes LIMS\'s reported figure in the field\'s unit; a list or a mean is not one figure', () => {
    const ph = bt.fields.find((f) => f.name === 'ph')!;
    const visc = bt.fields.find((f) => f.name === 'viscosity')!;
    const one = (o: Partial<QcResult>) => r(null, { testName: 'pH', reported: '5.2', unit: '', figure: 'result', ...o });
    expect(inProcessFit(one({}), ph, 'pH', bt.fields)).toEqual({ take: { ph: '5.2' } });
    expect(inProcessFit(one({ figure: null }), ph, 'pH', bt.fields)).toEqual({ take: { ph: '5.2' } });
    expect(inProcessFit(one({ testName: 'Viscosity', reported: '85', unit: 'mPa.s' }), visc, 'mPa·s', bt.fields)).toEqual({ take: { viscosity: '85' } });
    expect(inProcessFit(one({ testName: 'Viscosity', unit: '%' }), visc, 'mPa·s', bt.fields)).toEqual({ error: 'Viscosity of in-process report IPR2600001 is in %, not in mPa·s.' });
    expect(inProcessFit(one({ individual: L1_PASS, unit: 'pH' }), ph, 'pH', bt.fields)).toEqual({ error: 'pH of in-process report IPR2600001 is a list of 10 values: pH takes one result.' });
    expect(inProcessFit(one({ figure: 'mean' }), ph, 'pH', bt.fields)).toEqual({ error: 'pH of in-process report IPR2600001 reports the mean, not one result: it is not pH.' });
    expect(inProcessFit(one({ reported: null }), ph, 'pH', bt.fields)).toEqual({ error: 'pH of in-process report IPR2600001 has no reported figure in LIMS.' });
  });

  it('the blocks: blend and content uniformity are in-process lab tests; a staged list names another in-process list', () => {
    expect(bu.fields.find((f) => f.name === 'results')).toMatchObject({ qc: 'in_process', count: 10, figure: 'mean' });
    expect(cu.fields.filter((f) => f.qc === 'in_process').map((f) => [f.name, f.count])).toEqual([['results', 10], ['moreResults', 20]]);
    for (const b of [bu, cu, bt]) expect(blockProblems(b)).toEqual([]);
    const bad: Block = { ...cu, fields: cu.fields.map((f) => (f.name === 'moreResults' ? { ...f, qc: undefined } : f)) };
    expect(blockProblems(bad)).toContain('field results: the next stage is another in-process list of readings');
    // Shop-floor IPC stays typed at the vessel (pH adjustment, make-up density, dissolving, the bulk yield).
    for (const id of ['ph-adjust', 'make-up', 'dissolve', 'bulk-yield']) expect(findBlock({ id, version: 1 })!.fields.some((f) => f.qc)).toBe(false);
  });
});

/** An approved (or other) in-process report of a lab request with one result: its individual values, figure and reported figure. */
async function inProcess(lotNo: string, request: string | null, o: { values?: string[] | null; reported?: string | null; figure?: string | null; unit?: string; purpose?: string; decision?: string; test?: string } = {}) {
  n += 1;
  const number = `IPR26${String(n).padStart(5, '0')}`;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const decision = o.decision ?? 'APPROVED';
  await t.owner.unsafe(`insert into ${L}.coa_v1 (coa_id, coa_number, sample_number, lot_number, item_kind, item_master_id, item_code, item_name, purpose, decision, decided_at, decided_by, request_id)
    values ($1, $2, $3, $4, 'PRODUCT', 'p', 'P', 'P', $5, $6, now(), 'QC ONE', $7)`, [id, decision === 'APPROVED' ? number : null, `LS26${n}`, lotNo, o.purpose ?? 'in_process', decision, request]);
  const rid = `00000000-0000-0000-9999-${String(n).padStart(12, '0')}`;
  await t.owner.unsafe(`insert into ${L}.result_v1 (result_id, coa_id, coa_number, lot_number, test_key, test_name, unit, analysis_number, decision, decided_at, reported, request_id, individual_values, figure)
    values ($1, $2, $3, $4, 'cu', $5, $6, 'LA26009', $7, now(), $8, $9, $10::numeric[], $11)`,
  [rid, id, decision === 'APPROVED' ? number : null, lotNo, o.test ?? 'Uniformity', o.unit ?? '%', decision, o.reported ?? null, request, o.values ? `{${o.values.join(',')}}` : null, o.figure ?? null]);
  return { number, resultId: rid };
}
type IpPicks = { link: string; request: string; results: { resultId: string; coaNumber: string; individual: string[] | null; figure: string | null; shown: string }[] };
const ipPicks = async (id: number, key: string) => (await as('asha', 'GET', `/api/batches/${id}/lims?request=${key}&units=${encodeURIComponent(encodeURIComponent('%'))}`)).json() as IpPicks;
const recordAt = (id: number, key: string, values: object) => as('asha', 'POST', `/api/batches/${id}/steps/${key}/record`, { values });
type Row = { request_id: string; batch_no: string; product_code: string; stage_title: string; step_key: string; step_title: string; tests: object[]; status: string };
const requests = async (batchNo: string) => (await t.owner.unsafe(`select request_id, batch_no, product_code, stage_title, step_key, step_title, tests, status
  from ${t.schema}_report.lab_request_v1 where batch_no = $1 order by request_id`, [batchNo])) as unknown as Row[];
const btStep = (o: object = {}) => ({ ...bulkTest, ...o });
const buSettings = { meanLimit: { low: '90.0', high: '110.0', unit: '%' }, rsdLimit: { high: '5.0', unit: '%' }, individualLimit: { low: '75.0', high: '125.0', unit: '%' } };
const buStep = { block: { id: 'blend-uniformity', version: 1 }, checker: true, settings: buSettings };
const buRounds = (o: object = {}) => ({ ...buStep, ...o });

describe('the lab request a step opens (report.lab_request_v1)', () => {
  it('TL-14 lab_request_v1 has the columns agreed with LIMS (the same in every TrueBatch edition)', async () => {
    const cols = await t.owner<{ c: string }[]>`select column_name || ' ' || data_type as c from information_schema.columns
      where table_schema = ${`${t.schema}_report`} and table_name = 'lab_request_v1' order by ordinal_position`;
    expect(cols.map((r) => r.c)).toEqual(['request_id text', 'batch_no text', 'product_code text', 'stage_title text', 'step_key text', 'step_title text', 'tests jsonb',
      'requested_at timestamp with time zone', 'status text', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone']);
  });

  it('TL-14 a step with in-process tests opens its request when it starts; it is done once its result is picked', async () => {
    const b = await issue([btStep(), {}]);
    expect(await requests(b.batchNo)).toEqual([]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {});
    expect(await requests(b.batchNo)).toEqual([{ request_id: `${b.batchNo}/0.1.0.1`, batch_no: b.batchNo, product_code: 'P', stage_title: 'Stage 0', step_key: '0.1.0.1',
      step_title: 'Bulk test (hold)', status: 'open', tests: [
        { name: 'ph', label: 'pH', unit: 'pH', individual: null }, { name: 'density', label: 'Density', unit: 'g/mL', individual: null },
        { name: 'viscosity', label: 'Viscosity', unit: 'mPa·s', individual: null }, { name: 'assay', label: 'Assay (% of target)', unit: '%', individual: null },
        { name: 'ethanol', label: 'Alcohol content', unit: '%v/v', individual: null }, { name: 'preservative', label: 'Preservative content (% of target)', unit: '%', individual: null }] }]);
    const { resultId } = await inProcess(b.batchNo, `${b.batchNo}/0.1.0.1`, { reported: '5.2', unit: '', figure: 'result', test: 'pH' });
    expect((await recordAt(b.id, '0.1.0.1', { reference: 'IPC/1', appearance: 'yes', ph: { lims: resultId } })).statusCode).toBe(200);
    // Round 43: done once its result is picked (a later round may pick it too), not when the step is signed.
    expect((await requests(b.batchNo)).map((r) => r.status)).toEqual(['done']);
    const s = (await stepOf(b.id, '0.1.0.1')) as StepJson & { contentHash: string };
    const done = await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/done`, { proof: proofFor('asha'), contentHash: s.contentHash });
    expect(done.statusCode, done.body).toBe(200);
    expect((await requests(b.batchNo)).map((r) => r.status)).toEqual(['done']);
    // The next step (no in-process test) opens none.
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.1.1/start`, {});
    expect((await requests(b.batchNo)).map((r) => r.request_id)).toEqual([`${b.batchNo}/0.1.0.1`]);
  });

  it('TL-14 a request is cancelled when its step is set not applicable, or the batch is terminated, before it was signed', async () => {
    const b = await issue([btStep({ flow: { kind: 'optional-with-reason' } }), buStep]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {});
    const s = (await stepOf(b.id, '0.1.0.1')) as StepJson & { contentHash: string };
    const na = await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/not-applicable`, { proof: proofFor('asha'), contentHash: s.contentHash, reason: 'Not needed for this batch size' });
    expect(na.statusCode, na.body).toBe(200);
    expect((await requests(b.batchNo)).map((r) => [r.request_id, r.status])).toEqual([[`${b.batchNo}/0.1.0.1`, 'cancelled']]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.1.1/start`, {});
    expect((await requests(b.batchNo)).map((r) => [r.step_title, r.status])).toEqual([['Bulk test (hold)', 'cancelled'], ['Blend uniformity sampling', 'open']]);
    // QA terminates the batch (its signed rejection, as the route writes it).
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${b.id}, 'rejected', '{"terminated": true}', (select id from users where username = 'asha'))`;
    expect((await requests(b.batchNo)).map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  });
});

describe('an in-process result picked from LIMS: blend uniformity', () => {
  let b: { id: number; batchNo: string };
  let other: { id: number; batchNo: string };
  let good = { number: '', resultId: '' };
  const key = '0.1.0.1';
  const BU = ['98.0', '101.0', '99.5', '100.5', '97.5', '102.0', '99.0', '100.0', '101.5', '98.5'];
  beforeAll(async () => {
    b = await issue([buStep, buStep]);
    other = await issue([buStep]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/start`, {});
    const req = `${b.batchNo}/${key}`;
    good = await inProcess(b.batchNo, req, { values: BU, reported: mean(BU), figure: 'mean' });
    await inProcess(b.batchNo, `${b.batchNo}/0.1.1.1`, { values: BU, reported: mean(BU), figure: 'mean' });          // another step of this batch
    await inProcess(other.batchNo, `${other.batchNo}/${key}`, { values: BU, reported: mean(BU), figure: 'mean' });    // another batch
    await inProcess(b.batchNo, null, { values: BU, reported: mean(BU), figure: 'mean', purpose: 'release' });         // a release sample
    await inProcess(b.batchNo, req, { values: BU, reported: mean(BU), figure: 'mean', decision: 'REJECTED' });         // not approved
    await inProcess(b.batchNo, req, { values: BU, reported: '250.0', figure: 'mean', unit: 'mg' });                    // another unit
    await inProcess(b.batchNo, req, { values: BU.slice(0, 9), reported: mean(BU.slice(0, 9)), figure: 'mean' });      // 9 values
  });

  it('TL-14 only the approved in-process reports of THIS step\'s request in % are offered', async () => {
    const p = await ipPicks(b.id, key);
    expect(p.link).toBe('ok');
    expect(p.request).toBe(`${b.batchNo}/${key}`);
    expect(p.results.map((r) => [r.coaNumber, r.individual?.length])).toEqual([[good.number, 10], [expect.stringMatching(/^IPR26/), 9]]);
    expect(p.results[0]!.individual).toEqual(BU);
  });

  it('TL-14 a result of another step, another batch, a release sample, an unapproved report or another unit is refused', async () => {
    const ids = (await t.owner.unsafe(`select r.result_id::text as id from ${L}.result_v1 r join ${L}.coa_v1 c using (coa_id)
      where c.lot_number in ($2, $3) and r.test_key = 'cu' and r.result_id <> $1 and coalesce(array_length(r.individual_values, 1), 0) = 10`, [good.resultId, b.batchNo, other.batchNo])).map((x) => x.id as string);
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      expect(await problems(recordAt(b.id, key, { results: { lims: id } }))).toEqual([`Content at 10 locations (% of label claim): that result is not a result in % of an approved in-process report of request ${b.batchNo}/${key} (this step) in LIMS.`]);
    }
  });

  it('TL-14 a result with 9 values for 10 locations is refused in plain words', async () => {
    const nine = (await ipPicks(b.id, key)).results.find((r) => r.individual?.length === 9)!;
    expect(await problems(recordAt(b.id, key, { results: { lims: nine.resultId } }))).toEqual([expect.stringMatching(/has 9 values in LIMS; Content at 10 locations \(% of label claim\) takes exactly 10\. Values are never added or left out/)]);
  });

  it('TL-14 while LIMS answers typing the results is refused; the pick fills the 10 locations in LIMS\'s order and the block\'s calculations run on them', async () => {
    expect(await problems(recordAt(b.id, key, { results: BU }))).toEqual([`Content at 10 locations (% of label claim) comes from LIMS: pick the result of in-process request ${b.batchNo}/${key} once QC has approved it there.`]);
    expect((await recordAt(b.id, key, { results: { lims: good.resultId } })).statusCode).toBe(200);
    const s = (await stepOf(b.id, key)) as StepJson & { results: Record<string, { ok: boolean; value: string; shown: string }> };
    expect(s.values.results).toEqual(BU.map((value) => ({ value, unit: '%' })));
    expect(s.source.results).toEqual({ from: 'lims', asOf: null, ref: good.resultId, request: `${b.batchNo}/${key}`,
      shown: expect.stringMatching(new RegExp(`^LIMS in-process report ${good.number}: Uniformity \\(request ${b.batchNo}/${key.replace(/\./g, '\\.')}, requested \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\), 10 values, mean ${mean(BU).replace('.', '\\.')} % as reported, analysis LA26009$`)) });
    // The mean and RSD (T7) and each location (C3) as on typed values.
    const typed = await issue([buStep]);
    await as('asha', 'POST', `/api/batches/${typed.id}/steps/${key}/start`, {});
    await cut();
    try { expect((await recordAt(typed.id, key, { results: BU })).statusCode).toBe(200); } finally { await restore(); }
    const h = (await stepOf(typed.id, key)) as StepJson & { results: Record<string, unknown> };
    expect(s.results).toEqual(h.results);
    expect(s.results.meanContent).toMatchObject({ ok: true });
    expect(Number(s.results.meanContent!.value)).toBeCloseTo(Number(mean(BU)), 1);
    expect(h.source.results).toEqual({ from: 'hand', link: 'lims', state: 'down' });
  });

  it('TL-22 the batch record PDF shows the values from LIMS with the report and request', async () => {
    const l = (await loadBatch(t.sql, b.id))!;
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.master), 'ASHA', new Date(), false));
    expect(pdf).toContain(`from LIMS in-process report ${good.number}: Uniformity (request ${b.batchNo}/${key}, requested `);
  });

  it('TL-14 LIMS down: the 10 results are typed from the QC report (a second person checks them, QA sees them); a pick is refused', async () => {
    await cut();
    try {
      expect((await ipPicks(b.id, key)).link).toBe('down');
      expect(await problems(recordAt(b.id, key, { results: { lims: good.resultId } }))).toEqual(['LIMS does not answer now: type Content at 10 locations (% of label claim) from the QC report.']);
      expect((await recordAt(b.id, key, { results: BU })).statusCode).toBe(200);
    } finally { await restore(); }
    const s = await stepOf(b.id, key);
    expect(s.source.results).toEqual({ from: 'hand', link: 'lims', state: 'down' });
    const review = (await as('asha', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string }[] };
    expect(review.hand).toContainEqual(expect.objectContaining({ field: 'results', link: 'lims' }));
  });
});

describe('an in-process result picked from LIMS: the bulk test, six single figures in their own units', () => {
  let b: { id: number; batchNo: string };
  const key = '0.1.0.1';
  const ids: Record<string, string> = {};
  const FIGURES: [string, string, string][] = [['pH', '5.2', ''], ['Density', '1.250', 'g/ml'], ['Viscosity', '85', 'mPa.s'], ['Assay', '100.1', '%'], ['Alcohol', '0.5', '% v/v'], ['Preservative', '98.5', '%']];
  const all = ['pH', 'g/mL', 'mPa·s', '%', '%v/v'].map((u) => encodeURIComponent(encodeURIComponent(u))).join(',');
  type Offered = { link: string; request: string; results: { resultId: string; testName: string; reported: string; unit: string | null }[] };
  const offered = async () => (await as('asha', 'GET', `/api/batches/${b.id}/lims?request=${key}&units=${all}`)).json() as Offered;
  beforeAll(async () => {
    b = await issue([bulkTest]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/start`, {});
    const req = `${b.batchNo}/${key}`;
    for (const [test, reported, unit] of FIGURES) ids[test] = (await inProcess(b.batchNo, req, { reported, unit, figure: 'result', test })).resultId;
    ids.list = (await inProcess(b.batchNo, req, { values: L1_PASS, reported: mean(L1_PASS), figure: 'mean', test: 'Assay of 10' })).resultId;
    await inProcess(b.batchNo, null, { reported: '99.0', figure: 'result', purpose: 'release', test: 'Assay (release)' });
  });

  it('TL-14 one read offers this request\'s results in all six fields\' units (written either way); a release CoA is not offered', async () => {
    const p = await offered();
    expect(p.link).toBe('ok');
    expect(p.results.map((r) => r.testName).sort()).toEqual(['Alcohol', 'Assay', 'Assay of 10', 'Density', 'Preservative', 'Viscosity', 'pH']);
  });

  it('TL-14 while LIMS answers typing is refused; each pick fills its field with LIMS\'s figure in the field\'s unit', async () => {
    expect(await problems(recordAt(b.id, key, { viscosity: '85' }))).toEqual([`Viscosity comes from LIMS: pick the result of in-process request ${b.batchNo}/${key} once QC has approved it there.`]);
    const r = await recordAt(b.id, key, { ph: { lims: ids.pH }, density: { lims: ids.Density }, viscosity: { lims: ids.Viscosity }, assay: { lims: ids.Assay },
      ethanol: { lims: ids.Alcohol }, preservative: { lims: ids.Preservative } });
    expect(r.statusCode, r.body).toBe(200);
    const s = await stepOf(b.id, key);
    expect(s.values).toMatchObject({ ph: { value: '5.2', unit: 'pH' }, density: { value: '1.250', unit: 'g/mL' }, viscosity: { value: '85', unit: 'mPa·s' },
      assay: { value: '100.1', unit: '%' }, ethanol: { value: '0.5', unit: '%v/v' }, preservative: { value: '98.5', unit: '%' } });
    expect(s.source.viscosity).toMatchObject({ from: 'lims', ref: ids.Viscosity, request: `${b.batchNo}/${key}`, shown: expect.stringMatching(/^LIMS in-process report IPR26\d+: Viscosity \(request .+\), 85 mPa\.s as reported/) });
    expect((await requests(b.batchNo)).map((x) => x.status)).toEqual(['done']);
  });

  it('TL-14 a list of 10 values, or a viscosity in %, is not the assay\'s or the viscosity\'s one figure', async () => {
    expect(await problems(recordAt(b.id, key, { assay: { lims: ids.list } }))).toEqual([expect.stringMatching(/^Assay of 10 of in-process report IPR26\d+ is a list of 10 values: Assay \(% of target\) takes one result\.$/)]);
    expect(await problems(recordAt(b.id, key, { viscosity: { lims: ids.Assay } }))).toEqual([`Viscosity: that result is not a result in mPa·s of an approved in-process report of request ${b.batchNo}/${key} (this step) in LIMS.`]);
  });

  it('TL-14 LIMS down: the figures are typed from the QC report, marked typed by hand; a pick is refused', async () => {
    await cut();
    try {
      expect(await problems(recordAt(b.id, key, { ph: { lims: ids.pH } }))).toEqual(['LIMS does not answer now: type pH from the QC report.']);
      expect((await recordAt(b.id, key, { ph: '5.3' })).statusCode).toBe(200);
    } finally { await restore(); }
    const s = await stepOf(b.id, key);
    expect(s.values.ph).toEqual({ value: '5.3', unit: 'pH' });
    expect(s.source.ph).toEqual({ from: 'hand', link: 'lims', state: 'down' });
  });
});

// Round 43 (found by the API edition's periodic reactions): a step with rounds takes an earlier round's sample, each
// result filling one round; lab_request_v1 follows the picks, and the round that ends the rounds closes the rest.
// The blender of a blend uniformity step, typed by hand (no Logbook link in these tests), so the step can be signed.
// Blend results whose mean (85.3 %) is below the 90.0 % limit, each location within 75 to 125 %: the rounds go on.
const BU_FAIL = ['85.0', '86.0', '84.0', '87.0', '83.0', '88.0', '85.5', '84.5', '86.5', '83.5'];
const BLENDER = { machine: 'eq-bl', ...handLabels('machine', 'machine') };

describe('round 43: an in-process result of an earlier round of the same step', () => {
  let b: { id: number; batchNo: string };
  let first = { number: '', resultId: '' };
  let third = { number: '', resultId: '' };
  const done = async (key: string) => as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/done`, { proof: proofFor('asha'), contentHash: ((await stepOf(b.id, key)) as StepJson & { contentHash: string }).contentHash });
  beforeAll(async () => {
    b = await issue([buRounds({ checker: false, flow: { kind: 'repeat-until', maxRounds: 3, stop: 'meanContent' } })]);
    // Round 1 is sampled; its result is not back yet, so round 1 is signed with results typed from the QC report while
    // LIMS is down (their mean fails: the rounds go on).
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {})).statusCode).toBe(200);
    await cut();
    try { const r1 = await recordAt(b.id, '0.1.0.1', { ...BLENDER, results: BU_FAIL }); expect(r1.statusCode, r1.body).toBe(200); } finally { await restore(); }
    const d1 = await done('0.1.0.1');
    expect(d1.statusCode, d1.body).toBe(200);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.2/start`, {})).statusCode).toBe(200);
    first = await inProcess(b.batchNo, `${b.batchNo}/0.1.0.1`, { values: BU_FAIL, reported: mean(BU_FAIL), figure: 'mean' });
  });

  it('round 2 is offered round 1\'s sample and picks it; the record says it was sampled in round 1 and when', async () => {
    const p = await ipPicks(b.id, '0.1.0.2');
    expect(p.request).toBe(`${b.batchNo}/0.1.0.2`);
    expect(p.results.map((r) => [r.coaNumber, (r as { requestId?: string }).requestId])).toEqual([[first.number, `${b.batchNo}/0.1.0.1`]]);
    expect(p.results[0]!.shown).toMatch(/sampled in round 1 at \d{4}-/);
    expect((await recordAt(b.id, '0.1.0.2', { ...BLENDER, results: { lims: first.resultId } })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.2');
    expect((s.values.results as unknown[]).length).toBe(10);
    expect(s.source.results).toMatchObject({ from: 'lims', ref: first.resultId, request: `${b.batchNo}/0.1.0.1`,
      shown: expect.stringMatching(new RegExp(`\\(request ${b.batchNo}/0\\.1\\.0\\.1, sampled in round 1 at .+\\), 10 values`)) });
    expect((await requests(b.batchNo)).map((r) => [r.step_key, r.status])).toEqual([['0.1.0.1', 'done'], ['0.1.0.2', 'open']]);
    const d2 = await done('0.1.0.2');
    expect(d2.statusCode, d2.body).toBe(200);
  });

  it('a later round never takes the same result again; an earlier round never takes a later round\'s sample', async () => {
    third = await inProcess(b.batchNo, `${b.batchNo}/0.1.0.3`, { values: L1_PASS, reported: mean(L1_PASS), figure: 'mean' });
    // Round 2 is offered only the result it picked itself, never round 3's sample: a later round's sample never fills an earlier round.
    expect((await ipPicks(b.id, '0.1.0.2')).results.map((r) => r.coaNumber)).toEqual([first.number]);
    expect((await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.3/start`, {})).statusCode).toBe(200);
    expect((await ipPicks(b.id, '0.1.0.3')).results.map((r) => r.coaNumber)).toEqual([third.number]);
    expect(await problems(recordAt(b.id, '0.1.0.3', { results: { lims: first.resultId } })))
      .toEqual([`Content at 10 locations (% of label claim): in-process report ${first.number} (request ${b.batchNo}/0.1.0.1) was used in another round of this step: one result fills one round.`]);
  });

  it('the round that ends the rounds closes the requests no round picked (cancelled); the picked ones stay done', async () => {
    expect((await recordAt(b.id, '0.1.0.3', { ...BLENDER, results: { lims: third.resultId } })).statusCode).toBe(200);
    expect((await requests(b.batchNo)).map((r) => r.status)).toEqual(['done', 'open', 'done']);
    const d3 = await done('0.1.0.3');
    expect(d3.statusCode, d3.body).toBe(200);
    expect((await requests(b.batchNo)).map((r) => [r.step_key, r.status])).toEqual([['0.1.0.1', 'done'], ['0.1.0.2', 'cancelled'], ['0.1.0.3', 'done']]);
  });

  it('a request still open when production approves the batch record is cancelled (nothing more is sampled)', async () => {
    const c = await issue([buRounds()]);
    await as('asha', 'POST', `/api/batches/${c.id}/steps/0.1.0.1/start`, {});
    expect((await requests(c.batchNo)).map((r) => r.status)).toEqual(['open']);
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${c.id}, 'production_approved', '{}', (select id from users where username = 'asha'))`;
    expect((await requests(c.batchNo)).map((r) => r.status)).toEqual(['cancelled']);
  });
});

// Round 43 (found by the Injectables edition): a step started before round 42 opened no lab request, so no pick could
// ever come: its in-process fields are typed by hand, marked so, checked by a second person and listed for QA.
describe('round 43: a step started before LIMS in-process requests', () => {
  let b: { id: number; batchNo: string };
  const key = '0.1.0.1';
  beforeAll(async () => {
    b = await issue([buRounds({ checker: false })]);
    // Started as before round 42: a "started" event without a lab request.
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
      values (${b.id}, 0, 1, 0, 1, 'started', ${t.owner.json({ where: 'Stage 0' })}, (select id from users where username = 'asha'))`;
  });

  it('it has no lab request; while LIMS answers its results are typed, marked "started before LIMS in-process requests"; a pick is refused', async () => {
    expect(await requests(b.batchNo)).toEqual([]);
    const p = (await ipPicks(b.id, key)) as IpPicks & { noRequest?: boolean };
    expect([p.link, p.noRequest, p.results]).toEqual(['ok', true, []]);
    const r = await inProcess(b.batchNo, `${b.batchNo}/${key}`, { values: L1_PASS, reported: mean(L1_PASS), figure: 'mean' });
    expect(await problems(recordAt(b.id, key, { results: { lims: r.resultId } })))
      .toEqual(['Content at 10 locations (% of label claim): this step was started before LIMS in-process requests: type it from the QC report.']);
    const typed = await recordAt(b.id, key, { ...BLENDER, results: L1_PASS });
    expect(typed.statusCode, typed.body).toBe(200);
    const s = await stepOf(b.id, key);
    expect(s.values.results).toEqual(L1_PASS.map((value) => ({ value, unit: '%' })));
    expect(s.source.results).toEqual({ from: 'hand', link: 'lims', state: 'no_request' });
  });

  it('a second person checks it (the master asks for no check), QA\'s review lists it and the PDF says why it was typed', async () => {
    const s = (await stepOf(b.id, key)) as StepJson & { contentHash: string; state: string };
    const d = await as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/done`, { proof: proofFor('asha'), contentHash: s.contentHash });
    expect(d.statusCode, d.body).toBe(200);
    expect(((await stepOf(b.id, key)) as StepJson & { state: string }).state).toBe('done_awaiting_check');
    const review = (await as('asha', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string; state: string }[] };
    expect(review.hand).toContainEqual(expect.objectContaining({ field: 'results', link: 'lims', state: 'no_request' }));
    const l = (await loadBatch(t.sql, b.id))!;
    expect(JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.master), 'ASHA', new Date(), false))).toContain('BY HAND: started before LIMS in-process requests');
  });

  it('a step with its own lab request is not one: typing is still refused while LIMS answers', async () => {
    const c = await issue([buRounds()]);
    await as('asha', 'POST', `/api/batches/${c.id}/steps/${key}/start`, {});
    expect(await problems(recordAt(c.id, key, { results: L1_PASS })))
      .toEqual([`Content at 10 locations (% of label claim) comes from LIMS: pick the result of in-process request ${c.batchNo}/${key} once QC has approved it there.`]);
  });
});

// Round 44 (found by the Injectables bulk test: assay, oxygen and solvent, all in %): LIMS's result_v1 names the
// TrueBatch field each in-process result answers (ipc_field, from its in-process specification). Such a result fills
// only that field; one that names none (an older LIMS) is still matched by its unit. The Liquids bulk test has two
// fields in %: the assay and the preservative content.
describe('round 44: a result fills only the field it answers (result_v1.ipc_field)', () => {
  const bt = findBlock({ id: 'bulk-test', version: 1 })!;
  const bulk: BlockField[] = bt.fields;
  const [assay, preservative] = [bulk.find((f) => f.name === 'assay')!, bulk.find((f) => f.name === 'preservative')!];
  const one = (test: string, reported: string, ipcField: string | null): QcResult => ({ resultId: test, coaId: 'c', coaNumber: 'IPR2600001', testName: test, reported, unit: '%',
    limitText: null, analysisNumber: null, outsideLab: null, requestId: 'TL260001/0.1.0.1', individual: null, figure: 'result', ipcField });

  it('TL-14 two fields in the same unit: each is offered and filled with its own result only', () => {
    const rs = [one('Assay', '99.6', 'assay'), one('Preservative', '98.5', 'preservative')];
    expect(rs.filter((r) => answersField(r, assay, bulk)).map((r) => r.testName)).toEqual(['Assay']);
    expect(rs.filter((r) => answersField(r, preservative, bulk)).map((r) => r.testName)).toEqual(['Preservative']);
    expect(inProcessFit(rs[0]!, assay, '%', bulk)).toEqual({ take: { assay: '99.6' } });
    expect(inProcessFit(rs[1]!, preservative, '%', bulk)).toEqual({ take: { preservative: '98.5' } });
  });

  it('TL-14 a result picked into another field is refused, naming the field it answers', () => {
    expect(inProcessFit(one('Preservative', '98.5', 'preservative'), assay, '%', bulk)).toEqual({ error: 'Preservative of report IPR2600001 answers Preservative content (% of target), not Assay (% of target).' });
    expect(fieldRefusal(one('Water', '0.5', 'water'), assay, bulk)).toBe('Water of report IPR2600001 answers water, not Assay (% of target).');
  });

  it('TL-14 a result that names no field (an older LIMS) is matched by its unit, as before', () => {
    expect(answersField(one('Assay', '99.6', null), preservative, bulk)).toBe(true);
    expect(answersField({ individual: null }, assay, bulk)).toBe(true);
    expect(inProcessFit(one('Assay', '99.6', null), preservative, '%', bulk)).toEqual({ take: { preservative: '99.6' } });
  });

  it('TL-14 a staged list is one test in LIMS: a result with both stages\' values fills either stage; one stage\'s values only their own', () => {
    const [l1, l2] = [CU.fields.find((f) => f.name === 'results')!, CU.fields.find((f) => f.name === 'moreResults')!];
    const all = [...L1_FAIL, ...MORE];
    expect(answersField({ ipcField: 'results', individual: all }, l2, CU.fields)).toBe(true);
    expect(answersField({ ipcField: 'moreResults', individual: all }, l1, CU.fields)).toBe(true);
    expect(answersField({ ipcField: 'moreResults', individual: L1_PASS }, l1, CU.fields)).toBe(false);
    expect(answersField({ ipcField: 'results', individual: MORE }, l2, CU.fields)).toBe(false);
  });

  describe('on the server: the bulk test', () => {
    const key = '0.1.0.1';
    const name = (resultId: string, field: string | null) => t.owner.unsafe(`update ${L}.result_v1 set ipc_field = $1 where result_id = $2`, [field, resultId]);
    // LIMS appends ipc_field at the end of result_v1 (the tests above read a LIMS without it).
    beforeAll(async () => { await t.owner.unsafe(`alter table ${L}.result_v1 add column ipc_field text`); });

    it('TL-14 the assay and the preservative (both in %) are each offered and picked only into their own field', async () => {
      const b = await issue([bulkTest]);
      const req = `${b.batchNo}/${key}`;
      await as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/start`, {});
      const a = await inProcess(b.batchNo, req, { reported: '100.1', figure: 'result', test: 'Assay of paracetamol' });
      const pr = await inProcess(b.batchNo, req, { reported: '98.5', figure: 'result', test: 'Preservative (sodium benzoate)' });
      await name(a.resultId, 'assay');
      await name(pr.resultId, 'preservative');
      const p = (await (await as('asha', 'GET', `/api/batches/${b.id}/lims?request=${key}&units=${encodeURIComponent(encodeURIComponent('%'))}`)).json()) as { results: { resultId: string; ipcField: string | null }[] };
      expect(p.results.map((r) => [r.resultId, r.ipcField]).sort()).toEqual([[a.resultId, 'assay'], [pr.resultId, 'preservative']].sort());
      expect(await problems(recordAt(b.id, key, { assay: { lims: pr.resultId } })))
        .toEqual([`Preservative (sodium benzoate) of report ${pr.number} answers Preservative content (% of target), not Assay (% of target).`]);
      expect((await stepOf(b.id, key)).values.assay).toBeUndefined();
      expect((await recordAt(b.id, key, { assay: { lims: a.resultId }, preservative: { lims: pr.resultId } })).statusCode).toBe(200);
      expect((await stepOf(b.id, key)).values).toMatchObject({ assay: { value: '100.1', unit: '%' }, preservative: { value: '98.5', unit: '%' } });
    });

    it('TL-14 a result that names no field is still picked by its unit (an older LIMS)', async () => {
      const b = await issue([bulkTest]);
      await as('asha', 'POST', `/api/batches/${b.id}/steps/${key}/start`, {});
      const a = await inProcess(b.batchNo, `${b.batchNo}/${key}`, { reported: '99.9', figure: 'result', test: 'Assay' });
      expect((await recordAt(b.id, key, { preservative: { lims: a.resultId } })).statusCode).toBe(200);
      expect((await stepOf(b.id, key)).values.preservative).toEqual({ value: '99.9', unit: '%' });
    });
  });
});
