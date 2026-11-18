import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Sql, Tx } from '../db.js';
import { audit } from '../audit.js';
import { parseId, requirePermission, type SessionUser } from '../auth.js';
import { usableItem } from '../master.js';
import { dispensingRooms, machineRefusal, roomRefusal } from '../../shared/engine/picks.js';
import { handProblem, lineOf, mfgDateProblem, pullBulk, pullItem, pullLot, pulledWords } from '../pull.js';
import { SignError, authenticateSigner, contentHash, sign, signBody } from '../signatures.js';
import { masterVersion } from './masters.js';
import { batchRecordDoc, type RecordInput, type Signature } from '../batch-record.js';
import { render, sendPdf } from '../pdf.js';
import { findBlock } from '../../shared/blocks/index.js';
import { blocking, masterChecks } from '../../shared/master/checks.js';
import type { MasterDoc } from '../../shared/master/schema.js';
import { Dec } from '../../shared/templates/index.js';
import {
  ACTIONS, BATCH_ACTIONS, CERTIFICATE, DEVIATION_DONE, LINK_OF, bulkRefusal, MATERIAL_USE, batchRefusal, filedKey, inLotUnit, issuedLots, bulkLeft, returnProblems, returnsOf, usedQuantity, usesOfLot, stepLabel, stepPlace, stepTitle, handFields, isHand, batchView, doneProblems, evaluate, lateItems, openSteps, parseKey, readValue, refusal, review, timers,
  trainingCheck, trainingTyped, type Training,
  type Action, type BatchAction, type BatchEvent, type BulkChecked, type BulkDeviation, type BulkIssue, type BulkDeviations, type DeviationStatus, type LinkState, type Source, type StageView, type Stored, type StepEvent, type StepKey, type StepView, type Timer, type Value,
} from '../../shared/engine/index.js';

// Plant time zone: the batch number's year is the plant's year.
const PLANT_TZ = process.env.DISPLAY_TZ ?? 'Asia/Kolkata';

class StepError extends Error {
  constructor(public status: number, public code: string, public problems: string[] = []) { super(code); }
}
function send(reply: FastifyReply, e: unknown) {
  if (e instanceof StepError) return reply.code(e.status).send({ error: e.code, problems: e.problems });
  if (e instanceof SignError) return reply.code(e.code === 'wrong_credentials' ? 401 : e.code === 'not_allowed' ? 403 : 409).send({ error: e.code });
  throw e;
}

export interface LoadedBatch {
  batch: { id: number; batchNo: string; masterVersionId: number; issuedBy: number; issuedAt: Date };
  doc: MasterDoc;
  events: (StepEvent & { personName: string | null })[];
  batchEvents: (BatchEvent & { personName: string })[];
  now: Date;
}

/** The batch, its master document and every step event, with the database time. */
export async function loadBatch(q: Sql | Tx, id: number): Promise<LoadedBatch | null> {
  const [b] = await q<(LoadedBatch['batch'] & { doc: MasterDoc; now: Date })[]>`
    select b.id::int, b.batch_no as "batchNo", b.master_version_id::int as "masterVersionId", b.issued_by::int as "issuedBy",
      b.issued_at as "issuedAt", v.doc, now() as now
    from batches b join master_versions v on v.id = b.master_version_id where b.id = ${id}`;
  if (!b) return null;
  const events = await q<LoadedBatch['events']>`
    select e.id::int, e.stage, e.sub, e.step, e.round, e.kind, e.payload, e.person_id::int as person, u.full_name as "personName", e.at
    from step_events e left join users u on u.id = e.person_id where e.batch_id = ${id} order by e.id`;
  const batchEvents = await q<LoadedBatch['batchEvents']>`
    select e.id::int, e.kind, e.payload, e.person_id::int as person, u.full_name as "personName", e.at
    from batch_events e join users u on u.id = e.person_id where e.batch_id = ${id} and e.kind <> 'stage_closed' order by e.id`;
  const { doc, now, ...batch } = b;
  return { batch, doc, events: [...events], batchEvents: [...batchEvents], now };
}

// What a batch-level signer is shown: the record as it stands, by its last events (the signature is refused if
// anything was added since).
const batchContent = (l: LoadedBatch) => ({ batch: l.batch.id, batchNo: l.batch.batchNo, lastStepEvent: l.events.at(-1)?.id ?? 0, lastBatchEvent: l.batchEvents.at(-1)?.id ?? 0 });
/** Every signature of the batch: its issue, its steps and its batch-level decisions, in order. */
const batchSignatures = (q: Sql, id: number) => q<Signature[]>`
  select s.object_type as "objectType", s.object_id::int as "objectId", s.printed_name as "printedName", s.meaning, s.signed_at as "signedAt",
    case when e.id is not null then concat_ws('.', e.stage, e.sub, e.step, e.round) end as step
  from signatures s left join step_events e on s.object_type = 'step_event' and e.id = s.object_id
  where (s.object_type = 'batch' and s.object_id = ${id})
     or e.batch_id = ${id}
     or (s.object_type = 'batch_event' and s.object_id in (select b.id from batch_events b where b.batch_id = ${id}))
  order by s.signed_at, s.id`;
/** What the batch record PDF is made from: the batch with its master version, issuer and signatures. */
export async function recordInput(q: Sql, l: LoadedBatch, master?: FastifyInstance['master']): Promise<RecordInput> {
  const v = await masterVersion(q, l.batch.masterVersionId);
  const [issuer] = await q<{ name: string }[]>`select full_name as name from users where id = ${l.batch.issuedBy}`;
  return { ...l, versionNo: v!.versionNo, issuedByName: issuer?.name ?? '', signatures: [...await batchSignatures(q, l.batch.id)], ...(master ? { units: await materialUnits(master) } : {}) };
}
/** Master data's unit of each material, by item id; none when master data does not answer. */
async function materialUnits(master: FastifyInstance['master']): Promise<Map<string, string>> {
  try { return new Map((await master.materials()).flatMap((m) => (m.unit?.trim() ? [[m.itemId, m.unit.trim()] as const] : []))); } catch { return new Map(); }
}
const batchHash = (l: LoadedBatch) => contentHash('batch', l.batch.id, batchContent(l));
const view = (l: LoadedBatch, read?: ReadonlyMap<string, DeviationStatus> | null) => batchView(l.doc, l.events, l.batchEvents, l.now, read);
/**
 * TB-21: the batch's deviation references as the Deviations system has them now, and (owner, 17 Nov 2026) the
 * deviation filed from each note written without one, found by the note's source_ref (keyed filedKey(note)); null when
 * the link does not answer.
 */
async function deviationsRead(app: FastifyInstance, l: LoadedBatch): Promise<{ read: Map<string, DeviationStatus> | null; link: LinkState }> {
  const notes = l.events.filter((e) => e.kind === 'note');
  const refs = [...new Set(notes.flatMap((e) => (e.payload.reference ? [e.payload.reference] : [])))];
  const r = await app.links.deviations.byNumbers(refs);
  if (r.state !== 'ok') return { read: null, link: r.state };
  const read = new Map<string, DeviationStatus>(r.value);
  const bare = notes.filter((e) => !e.payload.reference);
  if (!bare.length) return { read, link: 'ok' };
  const f = await app.links.deviations.bySourceRefs(bare.map((e) => `${app.product.id}:note:${e.id}`));
  if (f.state !== 'ok') return { read: null, link: f.state };
  for (const e of bare) {
    const d = f.value.get(`${app.product.id}:note:${e.id}`);
    if (d) read.set(filedKey(e.id), { status: d.status, closedAt: d.closedAt, number: d.number });
  }
  return { read, link: 'ok' };
}

/**
 * Packing (whole-suite run, S24): the open deviations of the bulk batch packed, read through TrueBatch Tablets' deviation
 * notes of that batch (their number, or the deviation Deviations filed from a note without one) and the Deviations
 * system (their status, and the deviations naming the bulk batch there). null for a manufacturing batch or before the
 * bulk batch is recorded; a link that does not answer: state absent or down, and QA confirms by hand at release.
 */
export async function bulkDeviations(app: FastifyInstance, l: LoadedBatch): Promise<BulkDeviations | null> {
  const bulk = l.doc.pack ? l.events.map((e) => e.payload.values?.bulk).filter((x): x is string => typeof x === 'string').at(-1) : undefined;
  if (!bulk) return null;
  const notes = await app.links.truebatch.notes(bulk);
  if (notes.state !== 'ok') return { bulk, state: notes.state, link: 'truebatch', open: [] };
  const numbered = notes.value.filter((n) => n.reference);
  const bare = notes.value.filter((n) => !n.reference);
  const dv = app.links.deviations;
  const [byNo, filed, named] = await Promise.all([dv.byNumbers(numbered.map((n) => n.reference!)), dv.bySourceRefs(bare.map((n) => n.sourceRef)), dv.byBatch(bulk)]);
  if (byNo.state !== 'ok' || filed.state !== 'ok' || named.state !== 'ok') {
    return { bulk, state: [byNo, filed, named].find((r) => r.state !== 'ok')!.state, link: 'deviations', open: [] };
  }
  const all = new Map<string, BulkDeviation>();
  for (const n of numbered) {
    const d = byNo.value.get(n.reference!);
    // A number typed in TrueBatch Tablets that Deviations does not know: its status is TrueBatch Tablets' (closed by QA there).
    all.set(n.reference!, { number: n.reference!, status: d?.status ?? n.status ?? 'open', title: d?.title ?? n.note, step: n.step });
  }
  for (const n of bare) {
    const d = filed.value.get(n.sourceRef);
    if (d && !all.has(d.number)) all.set(d.number, { number: d.number, status: d.status, title: d.title ?? n.note, step: n.step });
  }
  for (const d of named.value) if (!all.has(d.number)) all.set(d.number, { number: d.number, status: d.status, title: d.title, step: null });
  return { bulk, state: 'ok', open: [...all.values()].filter((d) => !DEVIATION_DONE.includes(d.status)) };
}

/**
 * Packing (bug fix, 17 Nov 2026): the issues of a bulk batch to the OTHER packing batches of this product (all but
 * `except`): the tablets each was issued (its first step's current values) less what went back unused when QA
 * terminated it (the terminate event's returns, stock.ts bulkIssued). Locked per bulk batch for the transaction, so
 * two issues at once cannot both take what is left.
 */
export async function bulkIssues(tx: Tx | Sql, bulk: string, except = '', lock = false): Promise<BulkIssue[]> {
  if (lock) await tx`select pg_advisory_xact_lock(hashtext(${`bulk:${bulk.toLowerCase()}`}))`;
  return await tx<BulkIssue[]>`
    select b.batch_no as "batchNo", t.tablets, r.returned
    from batches b
    cross join lateral (select e.payload->'values'->>'bulk' as bulk from step_events e where e.batch_id = b.id and e.stage = 0 and e.step = 0 and e.round = 1
      and e.kind in ('value', 'corrected') and e.payload->'values' ? 'bulk' order by e.id desc limit 1) k
    cross join lateral (select e.payload->'values'->'tablets'->>'value' as tablets from step_events e where e.batch_id = b.id and e.stage = 0 and e.step = 0 and e.round = 1
      and e.kind in ('value', 'corrected') and e.payload->'values' ? 'tablets' order by e.id desc limit 1) t
    left join lateral (select x->>'value' as returned from batch_events e cross join jsonb_array_elements(e.payload->'returns') x
      where e.batch_id = b.id and e.kind = 'rejected' and e.payload ? 'returns' and lower(x->>'lot') = lower(k.bulk) and x->>'unit' = 'tablets' limit 1) r on true
    where lower(k.bulk) = ${bulk.toLowerCase()} and b.batch_no <> ${except} and t.tablets is not null`;
}

// What a signer is shown of a step, and its hash: the signature is refused if the step changed since (PL-05).
const stepContent = (batchId: number, v: StepView) => ({ batch: batchId, step: v.id, values: v.values, results: v.results });
const stepHash = (batchId: number, v: StepView) => contentHash('batch_step', batchId, stepContent(batchId, v));

/**
 * Reads the values of a step. Machines and rooms are read from master data now (PL-08) and must fit the stage; then,
 * like lots, through their link (Logbook, MMS): pulled when it answers, else typed by hand with the label questions
 * (server/pull.ts). A pulled value cannot be typed over; certificate values come with the lot.
 */
async function readValues(app: FastifyInstance, tx: Tx, doc: MasterDoc, key: StepKey, raw: Record<string, unknown>, now: Date, current: StepView, batchNo: string) {
  const stage = doc.stages[key.stage]!;
  const step = stage.steps[key.step]!;
  const block = findBlock(step.block)!;
  // Packing: tablets typed while the bulk batch's good tablets come from TrueBatch Tablets (a part issue) are read
  // with the bulk batch again, up to what is left of it (pullBulk).
  const bulkField = block.fields.find((f) => f.kind === 'bulk');
  const tabletsPulled = (s?: Source) => !!s && !isHand(s);
  const taken = new Set<string>();
  if (bulkField && 'tablets' in raw && !(bulkField.name in raw) && tabletsPulled(current.source.tablets) && typeof current.values[bulkField.name] === 'string') {
    raw = { [bulkField.name]: current.values[bulkField.name], ...raw };
  }
  const out: Record<string, Value> = {};
  const source: Record<string, Source> = {};
  const problems: string[] = [];
  // 1. the linked values: machines, rooms and lots
  for (const [name, x] of Object.entries(raw)) {
    const f = block.fields.find((y) => y.name === name);
    if (!f || !LINK_OF[f.kind]) continue;
    let pulled;
    if (f.kind === 'machine' || f.kind === 'room') {
      const rooms = await app.master.rooms();
      const item = f.kind === 'machine' ? usableItem(await app.master.equipment(), String(x), 'machine') : usableItem(rooms, String(x), 'room');
      const type = 'type' in item ? item.type : item.area;
      const no = 'type' in item ? machineRefusal(stage, f, item, rooms, dispensingRooms(doc, rooms)) : roomRefusal(stage, item);
      if (no) { problems.push(no); continue; }
      // The area of the room it stands in, so a later stage that runs in that area keeps it in use by the batch (equipment_use_v1).
      const room = 'room' in item ? item.room : item.code;
      const area = 'area' in item ? item.area : rooms.find((r) => r.code === room)?.area ?? null;
      out[name] = { itemId: item.itemId, code: item.code, name: item.name, version: item.version, type, room, area };
      pulled = await pullItem(app, block, f, item, batchNo, doc.header.productCode);
    } else {
      const v = readValue(f, x, '');
      if (typeof v !== 'string') { problems.push((v as { error: string }).error); continue; }
      out[name] = v;
      pulled = f.kind === 'bulk' ? await pullBulk(app, doc, block, v, raw.tablets, () => bulkIssues(tx, v, batchNo, true)) : await pullLot(app, doc, step, block, v, current.values, now, PLANT_TZ);
    }
    problems.push(...pulled.problems);
    for (const n of pulled.taken ?? []) taken.add(n);
    source[name] = pulled.source;
    Object.assign(out, pulled.values);
    Object.assign(source, pulled.sources);
  }
  // 2. everything typed, with the questions of what is now entered by hand
  const sources = { ...current.source, ...source };
  const fields = [...block.fields, ...handFields(block.fields, sources)];
  const lot = block.fields.find((f) => f.kind === 'lot');
  for (const [name, x] of Object.entries(raw)) {
    const f = fields.find((y) => y.name === name);
    if (!f) { problems.push(`There is no field ${name}`); continue; }
    if (LINK_OF[f.kind]) continue;
    // The tablets issued, read with the bulk batch above (a part issue, up to what is left).
    if (taken.has(name)) continue;
    const was = source[name] ?? current.source[name];
    // While the step's lot is typed by hand (its link off or down), the lot's date and certificate values are typed from
    // its label, whatever an earlier lot from MMS gave (they are never signed with this lot: doneProblems).
    const lotHand = lot && (name.startsWith(`${lot.name}.`) || CERTIFICATE[name]) && isHand(sources[lot.name]);
    if (was && !isHand(was) && !lotHand) { problems.push(`${f.label} ${pulledWords(was)}`); continue; }
    if (lot && CERTIFICATE[name]) {
      const from = sources[lot.name];
      if (!from) { problems.push(`${f.label}: record the lot first`); continue; }
      if (!isHand(from)) { problems.push(`${f.label} comes from MMS with the lot and cannot be typed`); continue; }
    }
    // Whole seconds, as the time templates read them (T13).
    if (f.kind === 'timer') { out[name] = `${now.toISOString().slice(0, 19)}Z`; continue; }
    const setting = f.unit?.startsWith('$') ? step.settings[f.unit.slice(1)] : f.unit;
    const v = readValue(f, x, typeof setting === 'string' ? setting : '');
    if (typeof v === 'object' && !Array.isArray(v) && 'error' in v) { problems.push(v.error); continue; }
    const no = typeof v !== 'string' ? null : name.includes('.') ? handProblem(f, v, now, PLANT_TZ)
      : name === 'mfgDate' && block.packing ? mfgDateProblem(f, v, now, PLANT_TZ) : null;
    if (no) problems.push(no);
    else out[name] = v as Value;
  }
  if (problems.length) throw new StepError(400, 'invalid_values', problems);
  return { values: out, source };
}

const reason = z.string().trim().min(1).max(1000);
const values = z.record(z.unknown());
const BODIES: Record<Action, z.ZodTypeAny> = {
  start: z.object({}),
  record: z.object({ values }),
  // trained: the signer ticked "I am trained in …" while Recruitment was not reachable (shared/engine/training.ts).
  done: signBody.extend({ trained: z.boolean().optional() }),
  check: signBody.extend({ trained: z.boolean().optional() }),
  'send-back': z.object({ reason }),
  correct: z.object({ values, reason }),
  'not-applicable': signBody.extend({ reason }),
  'release-hold': signBody,
  note: z.object({ text: reason, reference: z.string().trim().min(1).max(60).optional() }),
};
const BATCH_BODIES: Record<BatchAction, z.ZodTypeAny> = {
  'production-approve': signBody,
  'qc-approve': signBody.extend({ reportNo: z.string().trim().min(1).max(60) }),
  // Packing (S24): what QA checked of the bulk batch's deviations, typed, when a link did not answer.
  release: signBody.extend({ bulkChecked: z.string().trim().max(500).optional() }),
  reject: signBody.extend({ reason }),
  // Per lot the batch used: how much went back to stores unused (stock.ts issuedLots, returnProblems).
  terminate: signBody.extend({ reason, returns: z.array(z.object({ lot: z.string().max(60), value: z.string().trim().regex(/^\d+(\.\d+)?$/, 'a quantity, 0 or more'), unit: z.string().max(20) })).max(200).optional() }),
  'close-deviation': z.object({ note: z.number().int().positive(), reason }),
};
// GET /api/batches/:id shows the last few events of each step; the full history is per step.
const LAST_EVENTS = 5;
const NAMES = Object.keys(ACTIONS) as Action[];
const BATCH_NAMES = Object.keys(BATCH_ACTIONS) as BatchAction[];
const flowOf = (doc: MasterDoc, k: StepKey) => doc.stages[k.stage]!.steps[k.step]!.flow.kind;
const context = (doc: MasterDoc, v: StepView, user: SessionUser) => ({ state: v.state, events: v.events, flow: flowOf(doc, v.key), user });
const FIRST: StepKey = { stage: 0, sub: 1, step: 0, round: 1 };
/**
 * Packing (TB-P2, TB-P7): a master whose first step is recorded at issue (the line, the released bulk batch, the
 * tablets issued) is issued with those values, read as any step's values are (pulled while a link answers, else
 * typed with the label questions and checked by a second person). One active packing order per line: a line with a
 * batch still in production takes no other.
 */
async function issueValues(app: FastifyInstance, tx: Tx, doc: MasterDoc, raw: Record<string, unknown> | undefined, now: Date) {
  const block = findBlock(doc.stages[0]!.steps[0]!.block)!;
  const current = openSteps(doc, [], now).steps[0]!;
  const typed = await readValues(app, tx, doc, FIRST, raw ?? {}, now, current, '');
  const needed = [...block.atIssue!.map((n) => block.fields.find((f) => f.name === n)!), ...handFields(block.fields, typed.source)];
  const missing = needed.filter((f) => !f.optional && typed.values[f.name] === undefined).map((f) => `${f.label} is not recorded`);
  const results = evaluate(doc, [], FIRST, typed.values);
  const refused = Object.values(results).flatMap((r) => (r.ok ? [] : [r.message]));
  if (missing.length || refused.length) throw new StepError(400, 'invalid_values', [...missing, ...refused]);
  const field = block.fields.find((f) => f.kind === 'machine')?.name ?? '';
  const line = typed.values[field] as { itemId: string; code: string } | undefined;
  if (line) {
    await tx`select pg_advisory_xact_lock(hashtext(${`line:${line.itemId}`}))`;
    const others = await tx<{ id: number }[]>`
      select distinct e.batch_id::int as id from step_events e
      where e.stage = 0 and e.step = 0 and e.round = 1 and e.kind in ('value', 'corrected') and e.payload->'values'->${field}->>'itemId' = ${line.itemId}
        and not exists (select 1 from batch_events x where x.batch_id = e.batch_id and x.kind in ('production_approved', 'released', 'rejected'))`;
    for (const { id } of others) {
      const l = (await loadBatch(tx, id))!;
      if (view(l).status === 'in production' && (openSteps(l.doc, l.events, l.now).steps[0]!.values[field] as { itemId?: string } | undefined)?.itemId === line.itemId) {
        throw new StepError(409, 'line_in_use', [`Line ${line.code} has an active packing order: batch ${l.batch.batchNo} (${l.doc.header.productCode}) is still being packed. One packing order per line.`]);
      }
    }
  }
  return { ...typed, results };
}

/** "My work": what in this batch waits for the person, and where the batch stands. Null when nothing does. */
function myWork(l: LoadedBatch, user: SessionUser) {
  const { stages, steps } = openSteps(l.doc, l.events, l.now);
  const bv = view(l);
  const title = (v: StepView) => stepTitle(l.doc, l.doc.stages[v.key.stage]!.steps[v.key.step]!);
  const stageName = (i: number) => l.doc.stages[i]?.name ?? '';
  const badges: { kind: 'check' | 'resign' | 'due' | 'late' | 'approve'; step?: string; stage: string; title: string; at?: Date; timer?: string }[] = [];
  for (const v of steps) {
    // TB-08: the checker's own list holds only steps the person was not involved in.
    if (!refusal('check', context(l.doc, v, user))) badges.push({ kind: 'check', step: v.id, stage: stageName(v.key.stage), title: title(v) });
    if (v.needsResign && user.permissions.includes('truebatch.batch.operate')) badges.push({ kind: 'resign', step: v.id, stage: stageName(v.key.stage), title: title(v) });
  }
  // A periodic check's badge names the check: "Coding check due in 59 min".
  const check = (t: Timer) => (t.kind === 'periodic' ? stepTitle(l.doc, l.doc.stages[t.key.stage]!.steps[t.key.step]!) : t.label);
  for (const t of timers(l.doc, l.events, l.now)) {
    if (t.kind === 'periodic' && t.state !== 'late') badges.push({ kind: 'due', step: `${t.key.stage}.${t.key.sub}.${t.key.step}.${t.key.round - 1}`, stage: stageName(t.key.stage), title: check(t), at: t.at, timer: t.kind });
  }
  for (const { timer: t } of lateItems(l.doc, l.events, l.now).filter((x) => !x.notes.length)) {
    badges.push({ kind: 'late', stage: stageName(t.key.stage), title: check(t), at: t.at, timer: t.kind });
  }
  if (!batchRefusal('production-approve', bv, user)) badges.push({ kind: 'approve', stage: '', title: 'Production approval' });
  const now = steps.find((s) => s.state === 'in_progress') ?? steps.find((s) => s.state === 'open');
  const operates = user.permissions.includes('truebatch.batch.operate') && bv.status === 'in production';
  if (!operates && !badges.length) return null;
  return {
    id: l.batch.id, batchNo: l.batch.batchNo, productCode: l.doc.header.productCode, productName: l.doc.header.productName, status: bv.status,
    issuedAt: l.batch.issuedAt, stagesClosed: stages.filter((s) => s.closed).length, stageCount: stages.length,
    current: now ? { step: now.id, stage: stageName(now.key.stage), title: title(now), state: now.state } : null, badges,
  };
}

/** The unit master data gives the step's material, read now; none when master data does not answer. */
async function stockUnit(app: FastifyInstance, doc: MasterDoc, key: StepKey): Promise<string | undefined> {
  const st = doc.stages[key.stage]!.steps[key.step]!;
  const line = MATERIAL_USE.includes(st.block.id) ? lineOf(doc, st) : undefined;
  return line && (await materialUnits(app.master)).get(line.materialItemId);
}

/**
 * A lot is not used beyond what MMS shows available (owner, 16 Nov 2026): MMS's balance of the lot less what this
 * product has already used from it (material_use_v1, as MMS takes it off; shared/engine/stock.ts). Checked while MMS
 * answers for a lot pulled from it; a lot typed by hand (MMS absent or down) is not compared. The step's own earlier
 * quantity is not counted twice. What the other TrueBatch product used from the same lot is not read here.
 */
async function stockProblem(app: FastifyInstance, tx: Tx, l: LoadedBatch, v: StepView, values: Record<string, Value>, results: Record<string, Stored>,
  source: Record<string, Source>): Promise<string | null> {
  const st = l.doc.stages[v.key.stage]!.steps[v.key.step]!;
  const lot = values.lot;
  if (!MATERIAL_USE.includes(st.block.id) || typeof lot !== 'string' || !source.lot || isHand(source.lot)) return null;
  const q = usedQuantity(l.doc, st, values, results, openSteps(l.doc, l.events, l.now).steps);
  if (!q) return null;
  const r = await app.links.mms.lot(lot);
  if (r.state !== 'ok' || !r.value?.stock || !r.value.unit) return null;
  const unit = r.value.unit;
  const want = inLotUnit(q, unit);
  if (!want) return null;
  let used = new Dec(0);
  const ids = await tx<{ id: number }[]>`select distinct batch_id::int as id from step_events
    where kind in ('value', 'corrected') and lower(payload->'values'->>'lot') = lower(${lot})`;
  for (const { id } of ids) {
    const b = id === l.batch.id ? l : (await loadBatch(tx, id))!;
    for (const u of usesOfLot(b.doc, openSteps(b.doc, b.events, b.now).steps, lot, returnsOf(b.batchEvents))) {
      if (id === l.batch.id && u.step.id === v.id) continue;
      used = used.plus(inLotUnit(u.quantity, unit) ?? 0);
    }
  }
  const stock = new Dec(r.value.stock);
  const available = Dec.max(stock.minus(used), 0);
  if (want.lte(available)) return null;
  return `Lot ${lot} has ${available} ${unit} available in MMS (${stock} ${unit} in stock less ${used} ${unit} already used in ${app.product.name}): `
    + `${want} ${unit} cannot be taken from it. ${available.gt(0) ? `Take at most ${available} ${unit}, or another lot.` : 'Take another lot.'}`;
}

/**
 * A stage closed by this action, recorded once as a batch event 'stage_closed' (the engine works it out: every step
 * done, checked or not applicable). A machine or room is in use by the batch until the last stage that names it, or
 * may run in its room, has closed (equipment_use_v1).
 */
async function recordClosedStages(tx: Tx, id: number, before: readonly StageView[], person: number) {
  const l = (await loadBatch(tx, id))!;
  for (const s of openSteps(l.doc, l.events, l.now).stages) {
    if (!s.closed || before[s.index]?.closed) continue;
    const [e] = await tx<{ id: number }[]>`
      insert into batch_events (batch_id, kind, payload, person_id) values (${id}, 'stage_closed', ${tx.json({ stage: s.index })}, ${person})
      on conflict do nothing returning id::int`;
    if (e) await audit(tx, { actorId: person, action: 'batch.stage_closed', objectType: 'batch', objectId: id, new: { event: e.id, stage: s.index, name: s.name } });
  }
}

export function batchRoutes(app: FastifyInstance, sql: Sql) {
  const anyUser = { preHandler: requirePermission() };

  // TB-03: issue a batch from an effective master version, with the next number of the year (never reused).
  app.post('/api/batches', { preHandler: requirePermission('truebatch.batch.issue') }, async (req, reply) => {
    const b = z.object({ masterVersionId: z.number().int().positive(), proof: z.string().min(1).max(2000), values: z.record(z.unknown()).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const user = req.user!;
    try {
      const signer = await authenticateSigner(sql, app.proofKey, user, b.data, { objectType: 'master_version', objectId: b.data.masterVersionId, meaning: 'issued' });
      return await sql.begin(async (tx) => {
        const v = await masterVersion(tx, b.data.masterVersionId, true);
        if (v?.state !== 'effective') throw new StepError(409, 'not_effective', ['Only an effective master version can be issued.']);
        // Approval will refuse a version with errors; until that workflow exists, issuing checks it too.
        // A version approved before its stages had to name their rooms (TB-11) still issues: its stages allow any room.
        // So does one approved before it had to name its dispensing rooms: its balances are those of the Dispensing area.
        const errors = masterChecks(v.doc).filter((p) => blocking(p) && !(p.rule === 'TB-11' && (p.path.endsWith('.roomTypes') || p.path === 'header.dispensingRooms')));
        if (errors.length) throw new StepError(409, 'master_has_errors', errors.map((p) => `${p.path}: ${p.message}`));
        const atIssue = findBlock(v.doc.stages[0]?.steps[0]?.block ?? { id: '', version: 0 })?.atIssue;
        const facts = atIssue ? await issueValues(app, tx, v.doc, b.data.values, (await tx<{ now: Date }[]>`select now() as now`)[0]!.now) : null;
        const [c] = await tx<{ n: number; yy: string }[]>`
          insert into batch_counters (year, last_no) values (extract(year from now() at time zone ${PLANT_TZ})::int, 1)
          on conflict (year) do update set last_no = batch_counters.last_no + 1
          returning last_no as n, right(year::text, 2) as yy`;
        const batchNo = `${app.batchPrefix}${c!.yy}${String(c!.n).padStart(4, '0')}`;
        const [row] = await tx<{ id: number }[]>`
          insert into batches (batch_no, master_version_id, issued_by) values (${batchNo}, ${v.id}, ${user.id}) returning id::int`;
        const content = { batchNo, masterVersionId: v.id, masterId: v.masterId, versionNo: v.versionNo, product: v.doc.header.productCode, ...(facts ? { facts: facts.values } : {}) };
        await sign(tx, { signer, objectType: 'batch', objectId: row!.id, meaning: 'issued', content, shownHash: contentHash('batch', row!.id, content) });
        await audit(tx, { actorId: user.id, action: 'batch.issued', objectType: 'batch', objectId: row!.id, new: content });
        if (facts) {
          // The batch facts are the first step's values, by the issuer: the step is then finished on the floor.
          const payload = { values: facts.values, results: facts.results, uses: [], ...(Object.keys(facts.source).length ? { source: facts.source } : {}) };
          for (const [kind, p] of [['started', { where: stepPlace(v.doc, { stage: 0, sub: 1, step: 0, round: 1 }) }], ['value', payload]] as const) {
            const [e] = await tx<{ id: number }[]>`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
              values (${row!.id}, 0, 1, 0, 1, ${kind}, ${tx.json(p as never)}, ${user.id}) returning id::int`;
            await audit(tx, { actorId: user.id, action: `step.${kind}`, objectType: 'batch', objectId: row!.id, new: { step: '0.1.0.1', event: e!.id, ...p } });
          }
        }
        return { id: row!.id, batchNo };
      });
    } catch (e) {
      return send(reply, e);
    }
  });

  // My work: the batches still in production (or waiting for production approval) with what waits for this person.
  app.get('/api/batches', anyUser, async (req) => {
    const ids = await sql<{ id: number }[]>`
      select b.id::int from batches b
      where not exists (select 1 from batch_events e where e.batch_id = b.id and e.kind in ('production_approved', 'released', 'rejected'))
      order by b.issued_at desc limit 100`;
    const out = [];
    for (const { id } of ids) {
      const l = await loadBatch(sql, id);
      const w = l && myWork(l, req.user!);
      if (w) out.push(w);
    }
    return out;
  });

  // Done on the floor: the latest batches the person recorded or signed a step of whose steps are all done (waiting for
  // production approval, or approved, released or rejected) and that are not in their work list, so the finished
  // record stays one tap away from My work (owner, 17 Nov 2026).
  app.get('/api/batches/finished', anyUser, async (req) => {
    const ids = await sql<{ id: number }[]>`
      select b.id::int from batches b
      where exists (select 1 from step_events e where e.batch_id = b.id and e.person_id = ${req.user!.id})
      order by b.issued_at desc limit 20`;
    const out = [];
    for (const { id } of ids) {
      const l = (await loadBatch(sql, id))!;
      if (view(l).status === 'in production' || myWork(l, req.user!)) continue;
      if (out.length < 10) out.push({ id, batchNo: l.batch.batchNo, productCode: l.doc.header.productCode, productName: l.doc.header.productName, status: view(l).status });
    }
    return out;
  });

  // To review: for QC the production-approved batches, for QA the QC-approved ones (TB-21), oldest decision first; for
  // QA also the batches still in production, which QA may terminate.
  app.get('/api/batches/to-review', { preHandler: requirePermission('truebatch.qc.approve', 'truebatch.qa.release') }, async (req) => {
    const qa = req.user!.permissions.includes('truebatch.qa.release');
    const ids = await sql<{ id: number }[]>`
      select b.id::int from batches b
      where (${qa} or exists (select 1 from batch_events e where e.batch_id = b.id and e.kind = 'production_approved'))
        and not exists (select 1 from batch_events e where e.batch_id = b.id and e.kind in ('released', 'rejected'))
      order by b.issued_at limit 200`;
    const out = [];
    for (const { id } of ids) {
      const l = (await loadBatch(sql, id))!;
      const bv = view(l, (await deviationsRead(app, l)).read);
      const waiting = bv.status === 'production approved' ? 'QC' : bv.status === 'QC approved' ? 'QA' : 'production';
      if (!req.user!.permissions.includes(waiting === 'QC' ? 'truebatch.qc.approve' : 'truebatch.qa.release')) continue;
      const last = l.batchEvents.filter((e) => e.kind !== 'deviation_closed').at(-1);
      out.push({ id, batchNo: l.batch.batchNo, productCode: l.doc.header.productCode, productName: l.doc.header.productName, status: bv.status, waiting,
        since: last?.at ?? l.batch.issuedAt, by: last?.personName ?? '', openDeviations: bv.deviations.filter((d) => d.open).length,
        actions: BATCH_NAMES.filter((a) => a !== 'close-deviation' && !batchRefusal(a, bv, req.user!)) });
    }
    return out;
  });

  // The batch with, per step, its state, current values, why it is not open, the actions open to this person, and
  // the timers. All computed from the step events; nothing is stored.
  app.get<{ Params: { id: string } }>('/api/batches/:id', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const l = id === null ? null : await loadBatch(sql, id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const v = await masterVersion(sql, l.batch.masterVersionId);
    const { stages, steps } = openSteps(l.doc, l.events, l.now);
    const dv = await deviationsRead(app, l);
    const bv = view(l, dv.read);
    // A released or rejected batch takes no more step actions and runs no more timers (a terminated one included).
    const decided = bv.status === 'released' || bv.status === 'rejected';
    return {
      batch: { ...l.batch, ...bv, deviationsLink: dv.link, contentHash: batchHash(l), actions: BATCH_NAMES.filter((a) => a !== 'close-deviation' && !batchRefusal(a, bv, req.user!)),
        terminated: l.batchEvents.find((e) => e.payload.terminated) ?? null,
        // What the batch has used of each lot: what terminating it asks about (the quantities that went back to stores).
        issued: issuedLots(l.doc, steps) },
      // The server time: the screens count timers down on the server clock.
      now: l.now, master: { id: v!.id, masterId: v!.masterId, versionNo: v!.versionNo, doc: l.doc }, stages, timers: decided ? [] : timers(l.doc, l.events, l.now),
      steps: steps.map((s) => {
        const { events, replaced: _, ...current } = s;
        return {
          ...current, events: events.slice(-LAST_EVENTS), contentHash: stepHash(l.batch.id, s),
          // The label questions of what was entered by hand (shared/engine/links.ts).
          handFields: handFields(findBlock(l.doc.stages[s.key.stage]!.steps[s.key.step]!.block)?.fields ?? [], s.source),
          actions: decided ? [] : NAMES.filter((a) => !refusal(a, context(l.doc, s, req.user!))),
          problems: s.state === 'in_progress' ? doneProblems(l.doc, s, l.now) : [],
        };
      }),
    };
  });

  // The full history of one step, with every correction (the original value, the new one, the reason).
  app.get<{ Params: { id: string; key: string } }>('/api/batches/:id/steps/:key/events', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const l = id === null ? null : await loadBatch(sql, id);
    const s = l && openSteps(l.doc, l.events, l.now).steps.find((x) => x.id === req.params.key);
    return s ? { events: s.events, replaced: s.replaced, inputChanged: s.inputChanged } : reply.code(404).send({ error: 'not_found' });
  });

  // TB-21: what QA reviews in the release screen: corrections, sent-backs, late items, values out of limits with
  // their notes, deviation notes and their status, steps not applicable, and every signature of the batch.
  app.get<{ Params: { id: string } }>('/api/batches/:id/review', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const l = id === null ? null : await loadBatch(sql, id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const signatures = await batchSignatures(sql, l.batch.id);
    const names = new Map(l.events.map((e) => [e.person, e.personName]));
    const dv = await deviationsRead(app, l);
    const r = review(l.doc, l.events, l.batchEvents, l.now, dv.read);
    // Deviations that name this batch in the Deviations system but no note of the record links.
    const named = await app.links.deviations.byBatch(l.batch.batchNo);
    const unlinked = named.state === 'ok' ? named.value.filter((d) => !r.deviations.some((x) => x.reference === d.number)) : [];
    return { status: view(l, dv.read).status, ...r, deviationsLink: dv.link, unlinked, bulk: await bulkDeviations(app, l), signatures,
      corrections: r.corrections.map((c) => ({ ...c, personName: names.get(c.person) ?? null })),
      hand: r.hand.map((h) => ({ ...h, personName: names.get(h.person) ?? null })),
      trainingTyped: r.trainingTyped.map((h) => ({ ...h, personName: names.get(h.person) ?? null })) };
  });

  // The deviations that name this batch in the Deviations system, for the note's pick list (pull, don't type).
  app.get<{ Params: { id: string } }>('/api/batches/:id/deviations', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const [b] = id === null ? [] : await sql<{ batchNo: string }[]>`select batch_no as "batchNo" from batches where id = ${id}`;
    if (!b) return reply.code(404).send({ error: 'not_found' });
    const r = await app.links.deviations.byBatch(b.batchNo);
    return { link: r.state, deviations: r.state === 'ok' ? r.value : [] };
  });

  // TB-10, pull don't type (owner, 17 Nov 2026): the batch that last used a room or line before this one, from this
  // product's own records, for the line clearance's "previous product and batch" (one tap; typed only when unknown).
  app.get<{ Params: { id: string }; Querystring: { item?: string } }>('/api/batches/:id/previous-use', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const item = String(req.query.item ?? '');
    if (id === null || !item) return reply.code(404).send({ error: 'not_found' });
    const [u] = await sql<{ batchNo: string; productCode: string | null; productName: string | null }[]>`
      select b.batch_no as "batchNo", v.doc->'header'->>'productCode' as "productCode", v.doc->'header'->>'productName' as "productName"
      from step_events e join batches b on b.id = e.batch_id join master_versions v on v.id = b.master_version_id
      where e.batch_id <> ${id} and e.kind in ('value', 'corrected') and b.issued_at < (select issued_at from batches where id = ${id})
        and exists (select 1 from jsonb_each(e.payload->'values') f where jsonb_typeof(f.value) = 'object' and f.value->>'itemId' = ${item})
      order by e.at desc limit 1`;
    return { previous: u ? { ...u, text: `${[u.productCode, u.productName].filter(Boolean).join(' · ')}, batch ${u.batchNo}` } : null };
  });

  // Before a step that names a training is signed: the person's training in it, as Recruitment answers now (the sign
  // dialog shows it; the signature reads it again). Link off or down: the dialog asks for the tick.
  app.get<{ Params: { id: string; key: string } }>('/api/batches/:id/steps/:key/training', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const key = parseKey(req.params.key);
    const l = id === null || key === null ? null : await loadBatch(sql, id);
    const st = key && l?.doc.stages[key.stage]?.steps[key.step];
    if (!l || !st) return reply.code(404).send({ error: 'not_found' });
    if (!st.training) return { skill: null };
    const read = await app.links.recruitment.training(req.user!.username, st.training.code);
    const t = trainingCheck(st.training, req.user!.fullName, read, false);
    return { skill: st.training, link: read.state, ok: t.ok, ...(t.ok ? { training: t.training } : { message: t.message }) };
  });

  // The skills Recruitment trains people in, for the designer's "Training needed" pick list (pull, don't type).
  app.get('/api/recruitment/skills', anyUser, async () => {
    const r = await app.links.recruitment.skills();
    return { link: r.state, skills: r.state === 'ok' ? r.value : [] };
  });

  // The lots of a material MMS has released and in date today, for the lot's pick list.
  app.get<{ Querystring: { material?: string } }>('/api/mms/lots', anyUser, async (req) => {
    const r = await app.links.mms.usable(String(req.query.material ?? ''), new Date().toLocaleDateString('en-CA', { timeZone: PLANT_TZ }));
    return { link: r.state, lots: r.state === 'ok' ? r.value : [] };
  });

  // The machines and rooms the Logbook has (their master-data ids), for the pick lists: while the link answers, only
  // these are offered (any other is refused, server/pull.ts); absent or down, every one is offered and typed by hand.
  app.get('/api/logbook/items', anyUser, async () => {
    const r = await app.links.logbook.known();
    return { link: r.state, items: r.state === 'ok' ? r.value : [] };
  });

  // Packing: the bulk batches TrueBatch Tablets has released of a product, for the issue's pick list (pull, don't type).
  app.get<{ Querystring: { product?: string } }>('/api/bulk-batches', { preHandler: requirePermission('truebatch.batch.issue') }, async (req) => {
    const r = await app.links.truebatch.released(String(req.query.product ?? ''));
    // With the good tablets: what the other packing batches were already issued of each, and what is left to issue.
    const batches = r.state !== 'ok' ? [] : await Promise.all(r.value.map(async (b) => ({ batchNo: b.batchNo, mfgDate: b.mfgDate, goodQuantity: b.goodQuantity,
      ...(b.goodQuantity ? bulkLeft(b.goodQuantity, await bulkIssues(sql, b.batchNo)) : {}) })));
    return { link: r.state, batches };
  });

  // TB-22: the batch record as a PDF: a complete copy with its values, calculations, changes, notes and signatures.
  app.get<{ Params: { id: string } }>('/api/batches/:id/pdf', anyUser, async (req, reply) => {
    const id = parseId(req.params.id);
    const l = id === null ? null : await loadBatch(sql, id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const def = batchRecordDoc({ ...await recordInput(sql, l, app.master), deviationsRead: (await deviationsRead(app, l)).read, bulk: await bulkDeviations(app, l) }, req.user!.fullName, new Date(), app.demo);
    return sendPdf(reply, `${l.doc.pack ? 'packing' : 'batch'}-record-${l.batch.batchNo}`, await render(def));
  });

  // Production approval, QC approval, release or rejection (each an e-signature), QA terminating a batch (a signed
  // rejection: equipment_use_v1 then ends every open use of the batch), and QA closing a deviation note.
  for (const action of BATCH_NAMES) {
    const rule = BATCH_ACTIONS[action];
    app.post<{ Params: { id: string } }>(`/api/batches/:id/${action}`, anyUser, async (req, reply) => {
      const id = parseId(req.params.id);
      const body = BATCH_BODIES[action].safeParse(req.body);
      if (id === null || !body.success) return reply.code(400).send({ error: 'invalid', problems: body.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [] });
      const b = body.data as { proof?: string; contentHash?: string; reportNo?: string; reason?: string; note?: number; bulkChecked?: string; returns?: { lot: string; value: string; unit: string }[] };
      const user = req.user!;
      try {
        const signer = rule.meaning ? await authenticateSigner(sql, app.proofKey, user, { proof: b.proof! }, { objectType: 'batch', objectId: id, meaning: rule.meaning }) : null;
        return await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${id}::bigint)`;
          const l = await loadBatch(tx, id);
          if (!l) throw new StepError(404, 'not_found');
          const no = batchRefusal(action, view(l, (await deviationsRead(app, l)).read), user, b.note);
          if (no) throw new StepError(no.status, no.error, no.problems);
          // Packing (S24): the bulk batch's deviations, all closed in the Deviations system, or confirmed by QA by hand.
          const bulk = action === 'release' ? await bulkDeviations(app, l) : null;
          const held = bulkRefusal(bulk, b.bulkChecked);
          if (held.length) throw new StepError(409, 'not_ready', held);
          const checked: BulkChecked | null = bulk && { bulk: bulk.bulk, state: bulk.state, ...(bulk.link && bulk.state !== 'ok' ? { link: bulk.link, typed: b.bulkChecked!.trim() } : {}) };
          if (signer && b.contentHash !== batchHash(l)) throw new StepError(409, 'content_changed', ['The batch record changed since you opened it.']);
          // Terminate: what went back to stores unused of each lot the batch used; material_use_v1 gives it back to MMS.
          const issued = action === 'terminate' ? issuedLots(l.doc, openSteps(l.doc, l.events, l.now).steps) : [];
          const wrong = returnProblems(issued, b.returns ?? []);
          if (wrong.length) throw new StepError(400, 'invalid_values', wrong);
          const returns = issued.map((x) => ({ ...x, value: b.returns!.find((r) => r.lot.toLowerCase() === x.lot.toLowerCase() && r.unit === x.unit)!.value }));
          const payload = { ...(action === 'terminate' ? { terminated: true } : {}), ...(returns.length ? { returns } : {}), ...(b.reportNo ? { reportNo: b.reportNo } : {}), ...(b.reason ? { reason: b.reason } : {}), ...(b.note ? { note: b.note } : {}), ...(checked ? { bulk: checked } : {}) };
          const [ev] = await tx<{ id: number }[]>`
            insert into batch_events (batch_id, kind, payload, person_id) values (${id}, ${rule.event}, ${tx.json(payload)}, ${user.id}) returning id::int`;
          if (signer && rule.meaning) {
            const content = { ...batchContent(l), action, ...payload };
            await sign(tx, { signer, objectType: 'batch_event', objectId: ev!.id, meaning: rule.meaning, content, shownHash: contentHash('batch_event', ev!.id, content) });
          }
          await audit(tx, { actorId: user.id, action: `batch.${rule.event}`, objectType: 'batch', objectId: id, new: { event: ev!.id, ...payload }, reason: b.reason ?? null });
          return { ok: true, eventId: ev!.id };
        });
      } catch (e) {
        return send(reply, e);
      }
    });
  }

  // One route per action. Each does the same five things: read the step's events, work out its state, check the
  // action is allowed (state, permission, checker not the performer), insert one event (and its signature), audit.
  for (const action of NAMES) {
    const rule = ACTIONS[action];
    app.post<{ Params: { id: string; key: string } }>(`/api/batches/:id/steps/:key/${action}`, anyUser, async (req, reply) => {
      const id = parseId(req.params.id);
      const key = parseKey(req.params.key);
      const body = BODIES[action].safeParse(req.body);
      if (id === null || key === null || !body.success) return reply.code(400).send({ error: 'invalid', problems: body.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [] });
      const b = body.data as { proof?: string; contentHash?: string; reason?: string; text?: string; reference?: string; values?: Record<string, unknown>; trained?: boolean };
      const user = req.user!;
      try {
        const signer = rule.meaning ? await authenticateSigner(sql, app.proofKey, user, { proof: b.proof! }, { objectType: 'batch', objectId: id, meaning: rule.meaning }) : null;
        return await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${id}::bigint)`;
          // 1. the step's events, 2. its state
          const l = await loadBatch(tx, id);
          if (!l) throw new StepError(404, 'not_found');
          const before = openSteps(l.doc, l.events, l.now);
          const v = before.steps.find((s) => s.id === req.params.key);
          if (!v) throw new StepError(404, 'no_such_step');
          // Once production has approved the record it is closed to changes; notes stay possible until QA decides.
          const decided = l.batchEvents.find((e) => e.kind === 'released' || e.kind === 'rejected');
          if (decided || (action !== 'note' && l.batchEvents.some((e) => e.kind === 'production_approved'))) {
            throw new StepError(409, 'batch_closed', [decided ? `The batch is ${decided.payload.terminated ? 'terminated' : decided.kind}.` : 'Production has approved the batch record.']);
          }
          // 3. allowed?
          const no = refusal(action, context(l.doc, v, user));
          if (no) throw new StepError(no.status, no.error, [no.message]);
          if (action === 'done') { const p = doneProblems(l.doc, v, l.now); if (p.length) throw new StepError(409, 'not_ready', p); }
          if (signer && b.contentHash !== stepHash(id, v)) throw new StepError(409, 'content_changed', ['The step changed since you opened it.']);
          let payload: Record<string, unknown> = {};
          const uses: number[] = [];
          if (b.values) {
            const typed = await readValues(app, tx, l.doc, key, b.values, l.now, v, l.batch.batchNo);
            payload = { values: typed.values, results: evaluate(l.doc, l.events, key, { ...v.values, ...typed.values }, uses), uses,
              ...(Object.keys(typed.source).length ? { source: typed.source } : {}) };
            const no = await stockProblem(app, tx, l, v, { ...v.values, ...typed.values }, payload.results as Record<string, Stored>, { ...v.source, ...typed.source });
            if (no) throw new StepError(409, 'not_in_stock', [no]);
          }
          if (action === 'done') { const no = await stockProblem(app, tx, l, v, v.values, v.results, v.source); if (no) throw new StepError(409, 'not_in_stock', [no]); }
          // Signed again after an input changed: the results worked out again, as shown, are stored with the signature.
          if (action === 'done' && v.inputChanged.length) payload = { results: evaluate(l.doc, l.events, key, v.values, uses), uses };
          // Only trained people sign (owner, 17 Nov 2026): the signer's training in the step's skill, read from Recruitment now.
          const skill = l.doc.stages[key.stage]!.steps[key.step]!.training;
          if (skill && (action === 'done' || action === 'check')) {
            const t = trainingCheck(skill, user.fullName, await app.links.recruitment.training(user.username, skill.code), b.trained === true);
            if (!t.ok) throw new StepError(409, t.error, [t.message]);
            payload.training = t.training;
          }
          if (b.reason) payload.reason = b.reason;
          if (b.text) payload.text = b.text;
          // Where the note was written, in words, for the deviation filed from it (deviation_note_v1.step).
          if (action === 'note') payload.where = stepLabel(l.doc, key);
          // Where the step is, in words, for the uses other products read (equipment_use_v1, material_use_v1: step_name).
          if (action === 'start') payload.where = stepPlace(l.doc, key);
          // A material used: its unit in master data as read at signing (material_use_v1 gives MMS the quantity in it).
          if (action === 'done') { const unit = await stockUnit(app, l.doc, key); if (unit) payload.stockUnit = unit; }
          if (b.reference) {
            // The reference must be a deviation of the Deviations system while it answers; else typed, and QA closes it by hand.
            const r = await app.links.deviations.byNumbers([b.reference]);
            const d = r.state === 'ok' ? r.value.get(b.reference) : undefined;
            if (r.state === 'ok' && !d) throw new StepError(409, 'unknown_deviation', [`${b.reference} is not in the Deviations system: pick one of the deviations of this batch, or check the number.`]);
            payload.reference = b.reference;
            payload.source = { reference: d ? { from: 'deviations', asOf: null, shown: `${d.number}: ${d.title ?? ''} (${d.status})` } : { from: 'hand', link: 'deviations', state: r.state as 'absent' | 'down' } };
          }
          // 4. one event, and its signature
          const [ev] = await tx<{ id: number }[]>`
            insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
            values (${id}, ${key.stage}, ${key.sub}, ${key.step}, ${key.round}, ${rule.event}, ${tx.json(payload as never)}, ${user.id})
            returning id::int`;
          if (signer && rule.meaning) {
            const content = { ...stepContent(id, v), action, ...(b.reason ? { reason: b.reason } : {}), ...(payload.training ? { training: payload.training as Training } : {}) };
            await sign(tx, { signer, objectType: 'step_event', objectId: ev!.id, meaning: rule.meaning, content, shownHash: contentHash('step_event', ev!.id, content) });
          }
          // 5. audit
          await audit(tx, { actorId: user.id, action: `step.${rule.event}`, objectType: 'batch', objectId: id, new: { step: v.id, event: ev!.id, ...payload }, reason: b.reason ?? null });
          await recordClosedStages(tx, id, before.stages, user.id);
          return { ok: true, eventId: ev!.id };
        });
      } catch (e) {
        return send(reply, e);
      }
    });
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    batchPrefix: string;
  }
}
