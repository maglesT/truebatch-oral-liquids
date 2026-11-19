import type postgres from 'postgres';
import type { Sql } from './db.js';
import type { LinkState, Provider } from '../shared/engine/links.js';
import type { TrainingRead } from '../shared/engine/training.js';
import type { Coa, QcResult } from '../shared/engine/lims.js';

// Links to the other Medhanta products, the Logbook way (platform PL-08, D-02). Each provider is read live through
// its report views with TrueBatch's own login, from the URL the platform writes only while the link is on
// (<PROVIDER>_DATABASE_URL). Nothing is copied or cached. Every read gives one of three answers:
//   absent: no URL (the product is not licensed, or the link is off);
//   down:   the URL is set but the read was refused or the provider did not answer;
//   ok:     the rows as read now.
// Owner 15 Nov 2026: while a link is ok its values are pulled and cannot be typed over; absent or down, people go on
// by hand with a second-person check and the entry is flagged for QA (shared/engine/links.ts).

export type Read<T> = { state: 'ok'; value: T } | { state: Exclude<LinkState, 'ok'> };

// Refused: no grant (42501), the view is gone (42P01), the login is off (28000). Not answering: admin shutdown
// (57P01), the statement timeout (57014), connection errors (class 08 and the client's own).
const isCut = (e: unknown) => {
  const code = (e as { code?: string }).code ?? '';
  return ['42501', '42P01', '28000', '57P01', '57014', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED'].includes(code) || code.startsWith('08');
};

type View = (name: string) => postgres.Helper<string, []>;
export interface Link {
  provider: Provider;
  read<T>(f: (q: Sql, view: View) => Promise<T>): Promise<Read<T>>;
}
/** One provider's link: its connection (null when absent) and the schema of its published views. */
export function link(provider: Provider, q: Sql | null, schema = 'report'): Link {
  return {
    provider,
    async read(f) {
      if (!q) return { state: 'absent' };
      try { return { state: 'ok', value: await f(q, (name) => q(`${schema}.${name}`)) }; } catch (e) {
        if (isCut(e)) return { state: 'down' };
        throw e;
      }
    },
  };
}

// ---- Deviations: report.deviation_v1 (published now).
export interface DeviationRead { number: string; status: string; title: string | null; closedAt: string | null }
type DevRow = { number: string; status: string; title: string | null; closed_at: string | null };
const dev = (r: DevRow): DeviationRead => ({ number: r.number, status: r.status, title: r.title, closedAt: r.closed_at });
export const deviationsClient = (l: Link) => ({
  byNumbers: (numbers: string[]) => l.read(async (q, v) => new Map((await q<DevRow[]>`
    select distinct on (number) number, status, title, closed_at::text from ${v('deviation_v1')} where number = any(${numbers}) order by number`)
    .map((r) => [r.number, dev(r)]))),
  // The deviations filed from these notes (owner, 17 Nov 2026: the number flows back): deviation_v1.source_ref is the
  // note's deviation_note_v1.source_ref. Read through to_jsonb, so a view without the column finds none.
  bySourceRefs: (refs: string[]) => l.read(async (q, v) => new Map((await q<(DevRow & { source_ref: string })[]>`
    select distinct on (source_ref) source_ref, number, status, title, closed_at from (
      select to_jsonb(d) ->> 'source_ref' as source_ref, number, status, title, closed_at::text from ${v('deviation_v1')} d) x
    where source_ref = any(${refs}) order by source_ref, number`).map((r) => [r.source_ref, dev(r)]))),
  // The deviations that name the batch, matched as Deviations matches batches (its batch_norm).
  byBatch: (batchNo: string) => l.read(async (q, v) => (await q<DevRow[]>`
    select distinct on (number) number, status, title, closed_at::text from ${v('deviation_v1')}
    where batch_norm = ${batchNo.toLowerCase().replace(/[\s\-/._]+/g, '')} order by number`).map(dev)),
});

// ---- QMS: report.change_v1 (planned). A change control counts as approved once QA approved it and it is in one
// of these steps (an easy-to-change constant; the plan's question Q7).
export const CHANGE_STEPS = ['implementation', 'closure', 'closed'];
export interface ChangeRead { number: string; status: string; title: string | null; products: string | null; qaApprovedAt: string | null }
type CcRow = { number: string; status: string; title: string | null; products: string | null; qa_approved_at: string | null };
const cc = (r: CcRow): ChangeRead => ({ number: r.number, status: r.status, title: r.title, products: r.products, qaApprovedAt: r.qa_approved_at });
export const approvedChange = (c: ChangeRead) => c.qaApprovedAt !== null && CHANGE_STEPS.includes(c.status);
const word = (x: string) => new RegExp(`(^|[^a-z0-9])${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
/** Whether a change control's products name this product, by its code or its name (case-insensitive); 'none' when it names no product. */
export function namesProduct(c: ChangeRead, product: { productCode: string; productName: string }): 'yes' | 'no' | 'none' {
  const p = c.products?.trim().toLowerCase();
  if (!p) return 'none';
  return [product.productCode, product.productName].some((x) => x.trim() && word(x.trim()).test(p)) ? 'yes' : 'no';
}
export const qmsClient = (l: Link) => ({
  change: (number: string) => l.read(async (q, v) => {
    const [r] = await q<CcRow[]>`select number, status, title, products, qa_approved_at::text from ${v('change_v1')} where number = ${number} limit 1`;
    return r ? cc(r) : null;
  }),
  approved: () => l.read(async (q, v) => (await q<CcRow[]>`
    select number, status, title, products, qa_approved_at::text from ${v('change_v1')}
    where qa_approved_at is not null and status = any(${CHANGE_STEPS}) order by number desc limit 200`).map(cc)),
});

// ---- Logbook: report.equipment_status_v1 (planned), the status the Logbook computes. fit_for_use leaves out a use in
// progress (that is in_use_batch). only_product (its last column, owner 17 Nov 2026): the product code that alone may
// use the item next, after an antibiotic and until a product-changeover cleaning is verified; null: any product. Read
// through to_jsonb, so a view from before the column was appended reads as null.
export interface EquipmentStatus {
  code: string; state: string; fitForUse: boolean; blockers: string[]; warnings: string[]; inUseBatch: string | null;
  cleanedAt: string | null; cleanedBy: string | null; checkedAt: string; onlyProduct: string | null;
}
// A status older than this is not used (never stale data): the link counts as down.
export const STATUS_MAX_AGE_MS = 5 * 60_000;
export const logbookClient = (l: Link) => ({
  status: (masterId: string) => l.read(async (q, v) => {
    const [r] = await q<{ code: string; state: string; fit_for_use: boolean; blockers: string[] | null; warnings: string[] | null; in_use_batch: string | null;
      cleaned_at: string | null; cleaned_by: string | null; checked_at: Date; age_ms: number; only_product: string | null }[]>`
      select code, state, fit_for_use, blockers, warnings, in_use_batch, cleaned_at::text, cleaned_by, checked_at,
        extract(epoch from now() - checked_at) * 1000 as age_ms, nullif(to_jsonb(s) ->> 'only_product', '') as only_product
      from ${v('equipment_status_v1')} s where master_id::text = ${masterId} limit 1`;
    if (!r) return null;
    if (Number(r.age_ms) > STATUS_MAX_AGE_MS) return 'stale' as const;
    return { code: r.code, state: r.state, fitForUse: r.fit_for_use, blockers: r.blockers ?? [], warnings: r.warnings ?? [], inUseBatch: r.in_use_batch,
      cleanedAt: r.cleaned_at, cleanedBy: r.cleaned_by, checkedAt: r.checked_at.toISOString(), onlyProduct: r.only_product } satisfies EquipmentStatus;
  }),
  // The master-data ids of every machine, instrument and room the Logbook has, for the pick lists (only these can be used).
  known: () => l.read(async (q, v) => (await q<{ id: string }[]>`select distinct master_id::text as id from ${v('equipment_status_v1')} where master_id is not null`).map((r) => r.id)),
});

// ---- MMS: report.lot_v1 and report.lot_test_v1 (planned, with numbers for assay, water and LOD and their basis).
export const LOT_USABLE = ['approved', 'released'];
export interface LotTest { test: string; value: string | null; unit: string | null; basis: string | null; reportRef: string | null }
export interface LotRead {
  lotNumber: string; materialMasterId: string | null; materialCode: string | null; status: string; expiryDate: string | null;
  retestDate: string | null; qcReportRef: string | null; dataAsOf: string | null; tests: LotTest[];
  // MMS's own balance of the lot (received − sampled − issued + returned ± adjustments − disposed) in the lot's unit;
  // null from an MMS whose lot_v1 does not give it yet (then nothing is compared with it).
  stock?: string | null; unit?: string | null;
  // MMS D-70 (platform 1.20.0): the lot's stock after what ALL the TrueBatch products linked to MMS used of it, in the
  // same unit; null from an MMS whose lot_v1 does not give it, or while MMS has not read every product lately.
  stockAfterUse?: string | null;
}
type LotRow = { lot_number: string; material_master_id: string | null; material_code: string | null; status: string; expiry_date: string | null;
  retest_date: string | null; qc_report_ref: string | null; data_as_of: string | null };
const lotOf = (r: LotRow, tests: LotTest[] = []): LotRead => ({ lotNumber: r.lot_number, materialMasterId: r.material_master_id, materialCode: r.material_code,
  status: r.status, expiryDate: r.expiry_date, retestDate: r.retest_date, qcReportRef: r.qc_report_ref, dataAsOf: r.data_as_of, tests });
const LOT_COLS = `lot_number, material_master_id::text, material_code, status, expiry_date::text, retest_date::text, qc_report_ref, data_as_of::text`;
export const mmsClient = (l: Link) => ({
  lot: (lotNumber: string) => l.read(async (q, v) => {
    // stock, unit and stock_after_use through to_jsonb: the columns when MMS's view has them, null on a view from before they were appended.
    const [r] = await q<(LotRow & { stock: string | null; unit: string | null; stock_after_use: string | null })[]>`select ${q.unsafe(LOT_COLS)},
        to_jsonb(l) ->> 'stock' as stock, to_jsonb(l) ->> 'unit' as unit, to_jsonb(l) ->> 'stock_after_use' as stock_after_use
      from ${v('lot_v1')} l where lot_number = ${lotNumber} and kind = 'material' limit 1`;
    if (!r) return null;
    const tests = await q<{ test: string; value: string | null; unit: string | null; basis: string | null; report_ref: string | null }[]>`
      select test, value::text, unit, basis, report_ref from ${v('lot_test_v1')} where lot_number = ${lotNumber} and value is not null`;
    return { ...lotOf(r, tests.map((t) => ({ test: t.test, value: t.value, unit: t.unit, basis: t.basis, reportRef: t.report_ref }))), stock: r.stock, unit: r.unit, stockAfterUse: r.stock_after_use };
  }),
  // The lots of a material that may be used today, for the pick list.
  usable: (materialId: string, today: string) => l.read(async (q, v) => (await q<LotRow[]>`
    select ${q.unsafe(LOT_COLS)} from ${v('lot_v1')} where kind = 'material' and material_master_id::text = ${materialId} and status = any(${LOT_USABLE})
      and (expiry_date is null or expiry_date >= ${today}::date) and (retest_date is null or retest_date >= ${today}::date)
    order by expiry_date nulls last, lot_number limit 100`).map((r) => lotOf(r))),
});

// ---- TrueBatch Liquids: report.batch_fact_v1 and deviation_note_v1 (published), read by TrueBatch Liquids Packing for its bulk batch. The
// date of manufacture is its manufactured_on (owner, 15 Nov 2026): the plant-time date the bulk batch's first
// processing step started (db/migrations/0007_batch_fact_manufactured_on.sql); null until a step has started.
// goodQuantity, goodUnit (owner, 17 Nov 2026: pull, don't type): its good_quantity in L or kg, the bulk of its last
// yield step (db/migrations/0018_batch_fact_liquid_bulk.sql), what the packing batch is issued; readyAt and holdHours
// (bulk_ready_at, bulk_hold_hours, TL-17): when the bulk was ready and its hold. Read through to_jsonb, so a view from
// before a column was appended reads as null (the value is then typed).
export interface BulkRead { batchNo: string; productCode: string | null; status: string; released: boolean; mfgDate: string | null; dataAsOf: string | null;
  goodQuantity: string | null; goodUnit: string | null; readyAt: string | null; holdHours: string | null }
type BulkRow = { batch_number: string; product_code: string | null; status: string; released: boolean; mfg_date: string | null; data_as_of: string | null;
  good_quantity: string | null; good_unit: string | null; ready_at: string | null; hold_hours: string | null };
const bulkOf = (r: BulkRow): BulkRead => ({ batchNo: r.batch_number, productCode: r.product_code, status: r.status, released: r.released, mfgDate: r.mfg_date, dataAsOf: r.data_as_of,
  goodQuantity: r.good_quantity, goodUnit: r.good_unit, readyAt: r.ready_at ? new Date(r.ready_at).toISOString().slice(0, 19) + 'Z' : null, holdHours: r.hold_hours });
const BULK_COLS = `batch_number, product_code, status, released, manufactured_on::text as mfg_date, data_as_of::text,
  nullif(to_jsonb(f) ->> 'good_quantity', '') as good_quantity, nullif(to_jsonb(f) ->> 'good_unit', '') as good_unit,
  nullif(to_jsonb(f) ->> 'bulk_ready_at', '') as ready_at, nullif(to_jsonb(f) ->> 'bulk_hold_hours', '') as hold_hours`;
export const truebatchClient = (l: Link) => ({
  batch: (batchNo: string) => l.read(async (q, v) => {
    const [r] = await q<BulkRow[]>`select ${q.unsafe(BULK_COLS)} from ${v('batch_fact_v1')} f where batch_number = ${batchNo} limit 1`;
    return r ? bulkOf(r) : null;
  }),
  // Packing (whole-suite run, S24): the deviation notes of the bulk batch (deviation_note_v1): their number, or the
  // source_ref the Deviations system files a note without one under; step is where the note was written, in words.
  notes: (batchNo: string) => l.read(async (q, v) => (await q<{ source_ref: string; step: string | null; note: string | null; reference: string | null; status: string | null }[]>`
    select source_ref, step, note, reference, status from ${v('deviation_note_v1')} where batch_number = ${batchNo} order by note_id`)
    .map((r) => ({ sourceRef: r.source_ref, step: r.step, note: r.note, reference: r.reference, status: r.status }))),
  // The released bulk batches of a product, for a pick list.
  released: (productCode: string) => l.read(async (q, v) => (await q<BulkRow[]>`
    select ${q.unsafe(BULK_COLS)} from ${v('batch_fact_v1')} f where product_code = ${productCode} and released order by issued_at desc limit 100`).map(bulkOf)),
});

// ---- Recruitment: report.training_v1 (published, owner 17 Nov 2026), one row per person and skill; qualified is already
// false when the training expired. Read by the signer's login (core's preferred_username, as Recruitment names people).
type TrainingRow = { skill_code: string; skill_title: string | null; qualified: boolean; trained_on: string | null; valid_until: string | null; data_as_of: string | null };
export const recruitmentClient = (l: Link) => ({
  training: (login: string, code: string) => l.read(async (q, v) => {
    const [r] = await q<TrainingRow[]>`
      select skill_code, skill_title, qualified, trained_on::text, valid_until::text, data_as_of::text from ${v('training_v1')}
      where lower(person_login) = lower(${login}) and skill_code = ${code} order by qualified desc, valid_until desc nulls last limit 1`;
    return r ? { code: r.skill_code, title: r.skill_title, qualified: r.qualified === true, trainedOn: r.trained_on, validUntil: r.valid_until, dataAsOf: r.data_as_of } satisfies TrainingRead : null;
  }),
  // The skills Recruitment trains people in, for the designer's pick list.
  skills: () => l.read(async (q, v) => (await q<{ code: string; title: string | null }[]>`
    select distinct on (skill_code) skill_code as code, skill_title as title from ${v('training_v1')} where skill_code is not null
    order by skill_code, skill_title nulls last limit 500`).map((r) => ({ code: r.code, ...(r.title ? { title: r.title } : {}) }))),
});

// ---- LIMS: report.coa_v1 and report.result_v1 (published by Medhanta LIMS, readers round 2). One row per decided
// sample (decision APPROVED with its CoA number, or REJECTED) and one per result of it. lot_number is the lot (MMS) or
// the batch number (TrueBatch) as the sample names it. Read by lot or batch number, without case; whether a CoA may be
// used is decided once in the app (shared/engine/lims.ts coaRefusal), so a refusal says why. `rejected`: LIMS has a
// rejection of the same sample too. result_v1's `reported` and `outside_lab` (appended later) are read through to_jsonb.
// Round 42: coa_v1's and result_v1's request_id (an in-process sample's lab request, lab_request_v1) and result_v1's
// individual_values (numeric[], in LIMS's order, each read as LIMS wrote it) and figure (what `reported` is), appended at
// the end by LIMS, are read through to_jsonb too: a LIMS without them gives none.
// Round 44: result_v1's ipc_field (the TrueBatch field an in-process result answers: LIMS's in-process specification
// names it per test), appended at the end by LIMS, read the same way: an older LIMS gives null (matched by unit only).
// Round 45: result_v1's ipc_code (the code of the lab request's test the result answers, lab_request_v1 tests[].code),
// appended at the end by LIMS, read the same way: a LIMS without it gives null (the round 44 rule).
type CoaRow = { coa_id: string; coa_number: string | null; sample_number: string; lot_number: string | null; item_kind: string | null; item_master_id: string | null;
  item_code: string | null; item_name: string | null; purpose: string | null; decision: string; decided_at: string | null; decided_by: string | null;
  spec_number: string | null; spec_version: number | null; rejected: boolean; request_id: string | null };
const coaOf = (r: CoaRow): Coa => ({ coaId: r.coa_id, coaNumber: r.coa_number, sampleNumber: r.sample_number, lotNumber: r.lot_number, itemKind: r.item_kind,
  itemMasterId: r.item_master_id, itemCode: r.item_code, itemName: r.item_name, purpose: r.purpose, decision: r.decision, decidedAt: r.decided_at,
  decidedBy: r.decided_by, specNumber: r.spec_number, specVersion: r.spec_version, rejected: r.rejected, requestId: r.request_id });
export const limsClient = (l: Link) => ({
  // The CoAs of a lot or batch number (every decision: the app says why one may not be used).
  coas: (lotNumber: string) => l.read(async (q, v) => (await q<CoaRow[]>`
    select c.coa_id::text, c.coa_number, c.sample_number, c.lot_number, c.item_kind, c.item_master_id::text, c.item_code, c.item_name, c.purpose,
      c.decision, c.decided_at::text, c.decided_by, c.spec_number, c.spec_version::int, nullif(to_jsonb(c) ->> 'request_id', '') as request_id,
      exists (select 1 from ${v('coa_v1')} x where x.coa_id = c.coa_id and x.decision <> 'APPROVED') as rejected
    from ${v('coa_v1')} c where lower(c.lot_number) = lower(${lotNumber.trim()}) order by c.decided_at desc nulls last limit 50`).map(coaOf)),
  // The results of the given CoAs (approved ones, as the app picked them).
  results: (coaIds: string[]) => l.read(async (q, v) => (await q<{ result_id: string; coa_id: string; coa_number: string | null; test_name: string | null;
    reported: string | null; unit: string | null; limit_text: string | null; analysis_number: string | null; outside_lab: string | null;
    request_id: string | null; individual: string[] | null; figure: string | null; ipc_field: string | null; ipc_code: string | null }[]>`
    select r.result_id::text, r.coa_id::text, r.coa_number, r.test_name, nullif(to_jsonb(r) ->> 'reported', '') as reported, r.unit, r.limit_text,
      r.analysis_number, nullif(to_jsonb(r) ->> 'outside_lab', '') as outside_lab, nullif(to_jsonb(r) ->> 'request_id', '') as request_id,
      case when jsonb_typeof(to_jsonb(r) -> 'individual_values') = 'array' then
        array(select x #>> '{}' from jsonb_array_elements(to_jsonb(r) -> 'individual_values') with ordinality as v(x, i) order by i) end as individual,
      nullif(to_jsonb(r) ->> 'figure', '') as figure, nullif(to_jsonb(r) ->> 'ipc_field', '') as ipc_field,
      nullif(to_jsonb(r) ->> 'ipc_code', '') as ipc_code
    from ${v('result_v1')} r where r.coa_id::text = any(${coaIds}) and r.decision = 'APPROVED' order by r.coa_number, r.test_name limit 500`)
    .map((r): QcResult => ({ resultId: r.result_id, coaId: r.coa_id, coaNumber: r.coa_number, testName: r.test_name, reported: r.reported, unit: r.unit,
      limitText: r.limit_text, analysisNumber: r.analysis_number, outsideLab: r.outside_lab, requestId: r.request_id, individual: r.individual, figure: r.figure,
      ipcField: r.ipc_field, ipcCode: r.ipc_code }))),
});

export interface Links {
  deviations: ReturnType<typeof deviationsClient>;
  qms: ReturnType<typeof qmsClient>;
  logbook: ReturnType<typeof logbookClient>;
  mms: ReturnType<typeof mmsClient>;
  truebatch_liquids: ReturnType<typeof truebatchClient>;
  recruitment: ReturnType<typeof recruitmentClient>;
  lims: ReturnType<typeof limsClient>;
}
/** The links, from their connections (null: absent). `schema` lets tests point a provider at its own schema. */
export function links(c: Partial<Record<Provider, Sql | null>> = {}, schema: Partial<Record<Provider, string>> = {}): Links {
  return {
    deviations: deviationsClient(link('deviations', c.deviations ?? null, schema.deviations)),
    qms: qmsClient(link('qms', c.qms ?? null, schema.qms)),
    logbook: logbookClient(link('logbook', c.logbook ?? null, schema.logbook)),
    mms: mmsClient(link('mms', c.mms ?? null, schema.mms)),
    truebatch_liquids: truebatchClient(link('truebatch_liquids', c.truebatch_liquids ?? null, schema.truebatch_liquids)),
    recruitment: recruitmentClient(link('recruitment', c.recruitment ?? null, schema.recruitment)),
    lims: limsClient(link('lims', c.lims ?? null, schema.lims)),
  };
}
