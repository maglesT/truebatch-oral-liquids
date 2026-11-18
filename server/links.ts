import type postgres from 'postgres';
import type { Sql } from './db.js';
import type { LinkState, Provider } from '../shared/engine/links.js';
import type { TrainingRead } from '../shared/engine/training.js';

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
}
type LotRow = { lot_number: string; material_master_id: string | null; material_code: string | null; status: string; expiry_date: string | null;
  retest_date: string | null; qc_report_ref: string | null; data_as_of: string | null };
const lotOf = (r: LotRow, tests: LotTest[] = []): LotRead => ({ lotNumber: r.lot_number, materialMasterId: r.material_master_id, materialCode: r.material_code,
  status: r.status, expiryDate: r.expiry_date, retestDate: r.retest_date, qcReportRef: r.qc_report_ref, dataAsOf: r.data_as_of, tests });
const LOT_COLS = `lot_number, material_master_id::text, material_code, status, expiry_date::text, retest_date::text, qc_report_ref, data_as_of::text`;
export const mmsClient = (l: Link) => ({
  lot: (lotNumber: string) => l.read(async (q, v) => {
    // stock and unit through to_jsonb: the columns when MMS's view has them, null on a view from before they were appended.
    const [r] = await q<(LotRow & { stock: string | null; unit: string | null })[]>`select ${q.unsafe(LOT_COLS)}, to_jsonb(l) ->> 'stock' as stock, to_jsonb(l) ->> 'unit' as unit
      from ${v('lot_v1')} l where lot_number = ${lotNumber} and kind = 'material' limit 1`;
    if (!r) return null;
    const tests = await q<{ test: string; value: string | null; unit: string | null; basis: string | null; report_ref: string | null }[]>`
      select test, value::text, unit, basis, report_ref from ${v('lot_test_v1')} where lot_number = ${lotNumber} and value is not null`;
    return { ...lotOf(r, tests.map((t) => ({ test: t.test, value: t.value, unit: t.unit, basis: t.basis, reportRef: t.report_ref }))), stock: r.stock, unit: r.unit };
  }),
  // The lots of a material that may be used today, for the pick list.
  usable: (materialId: string, today: string) => l.read(async (q, v) => (await q<LotRow[]>`
    select ${q.unsafe(LOT_COLS)} from ${v('lot_v1')} where kind = 'material' and material_master_id::text = ${materialId} and status = any(${LOT_USABLE})
      and (expiry_date is null or expiry_date >= ${today}::date) and (retest_date is null or retest_date >= ${today}::date)
    order by expiry_date nulls last, lot_number limit 100`).map((r) => lotOf(r))),
});

// ---- TrueBatch Tablets: report.batch_fact_v1 and deviation_note_v1 (published), read by TrueBatch Tablets Packing for its bulk batch. The
// date of manufacture is its manufactured_on (owner, 15 Nov 2026): the plant-time date the bulk batch's first
// processing step started (db/migrations/0007_batch_fact_manufactured_on.sql); null until a step has started.
// goodQuantity (owner, 17 Nov 2026: pull, don't type): its good_quantity, the good tablets of its reconciliation
// (db/migrations/0015_batch_fact_output.sql), what the packing batch is issued; read through to_jsonb, so a view from
// before the column was appended reads as null (the tablets are then typed).
export interface BulkRead { batchNo: string; productCode: string | null; status: string; released: boolean; mfgDate: string | null; dataAsOf: string | null; goodQuantity: string | null }
type BulkRow = { batch_number: string; product_code: string | null; status: string; released: boolean; mfg_date: string | null; data_as_of: string | null; good_quantity: string | null };
const bulkOf = (r: BulkRow): BulkRead => ({ batchNo: r.batch_number, productCode: r.product_code, status: r.status, released: r.released, mfgDate: r.mfg_date, dataAsOf: r.data_as_of,
  goodQuantity: r.good_quantity });
const BULK_COLS = `batch_number, product_code, status, released, manufactured_on::text as mfg_date, data_as_of::text,
  nullif(to_jsonb(f) ->> 'good_quantity', '') as good_quantity`;
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

export interface Links {
  deviations: ReturnType<typeof deviationsClient>;
  qms: ReturnType<typeof qmsClient>;
  logbook: ReturnType<typeof logbookClient>;
  mms: ReturnType<typeof mmsClient>;
  truebatch: ReturnType<typeof truebatchClient>;
  recruitment: ReturnType<typeof recruitmentClient>;
}
/** The links, from their connections (null: absent). `schema` lets tests point a provider at its own schema. */
export function links(c: Partial<Record<Provider, Sql | null>> = {}, schema: Partial<Record<Provider, string>> = {}): Links {
  return {
    deviations: deviationsClient(link('deviations', c.deviations ?? null, schema.deviations)),
    qms: qmsClient(link('qms', c.qms ?? null, schema.qms)),
    logbook: logbookClient(link('logbook', c.logbook ?? null, schema.logbook)),
    mms: mmsClient(link('mms', c.mms ?? null, schema.mms)),
    truebatch: truebatchClient(link('truebatch', c.truebatch ?? null, schema.truebatch)),
    recruitment: recruitmentClient(link('recruitment', c.recruitment ?? null, schema.recruitment)),
  };
}
