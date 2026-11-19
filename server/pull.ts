import type { FastifyInstance } from 'fastify';
import type { MasterEquipment, MasterRoom } from './master.js';
import type { Block, BlockField } from '../shared/blocks/index.js';
import { materialLines, type FormulaLine, type MasterDoc, type PackMaterial, type Step } from '../shared/master/schema.js';
import { CERTIFICATE, PROVIDER_NAME, bulkIssueProblem, bulkLeft, clauses, readValue, type BulkIssue, type Provider, type Source, type Value } from '../shared/engine/index.js';
import { LOT_USABLE } from './links.js';
import { coaRefusal, coaText, inProcessFit, inProcessText, isPick, requestFits, resultRefusal, resultText, sameUnit, type Coa, type CoaFor, type QcResult } from '../shared/engine/lims.js';
import type { LinkState } from '../shared/engine/links.js';
import { plantDate } from '../shared/plant-time.js';

// What a link gives a step value at write time (owner 15 Nov 2026, TL-11, TL-12): the value as read now, or a
// refusal in plain words; when the link is absent or down, the value is typed by hand (its questions in
// shared/engine/links.ts). Nothing read is kept but what the record keeps (PL-07).

// taken: typed fields the pull has read itself (the bulk of a part issue), not read again as typed.
export interface Pulled { source: Source; values: Record<string, Value>; sources: Record<string, Source>; problems: string[]; taken?: string[] }
const hand = (link: Provider, state: 'absent' | 'down'): Pulled => ({ source: { from: 'hand', link, state }, values: {}, sources: {}, problems: [] });
// A refusal: nothing is stored, so its source is never used.
const refused = (...problems: string[]): Pulled => ({ source: { from: 'hand', link: 'mms', state: 'absent' }, values: {}, sources: {}, problems });

/** The formula line (or packing material) a step works on (its setting that names one). */
export function lineOf(doc: MasterDoc, st: Step): FormulaLine | PackMaterial | undefined {
  const s = Object.values(st.settings).find((v): v is { formula: string } => typeof v === 'object' && 'formula' in v);
  return s && materialLines(doc).find((l) => l.key === s.formula);
}

/**
 * TL-11: a machine or room the Logbook says is fit for use, not kept for another product (after an antibiotic) and not
 * in use by another batch. Line clearance: its facts. `productCode` is the code the batch publishes as its product
 * (batch_fact_v1 / packing_batch_v1 product_code: the master's header), the one the Logbook compares.
 */
export async function pullItem(app: FastifyInstance, block: Block, f: BlockField, item: MasterEquipment | MasterRoom, batchNo: string, productCode: string): Promise<Pulled> {
  const r = await app.links.logbook.status(item.itemId);
  if (r.state !== 'ok' || r.value === 'stale') return hand('logbook', r.state === 'absent' ? 'absent' : 'down');
  const s = r.value;
  if (!s) return refused(`${item.code} is not in the Logbook, so it cannot be used.`);
  // The line clearance after packing clears the line this batch has just used (it may already be dirty: a stage that
  // names no rooms does not keep the line in use, equipment_use_v1).
  if (!s.fitForUse && block.id !== 'pack-clearance-after') return refused(`${item.code} is not fit for use (Logbook): ${clauses(s.blockers) || stateWords(s.state)}.`);
  // Owner 17 Nov 2026: after an antibiotic, only that product may follow until a product-changeover cleaning is verified in the Logbook.
  if (s.onlyProduct && s.onlyProduct !== productCode) {
    return refused(`${item.code} was last used for an antibiotic (${s.onlyProduct}): a product-changeover cleaning is needed in the Logbook before ${productCode}.`);
  }
  if (s.inUseBatch && s.inUseBatch !== batchNo) return refused(`${item.code} is in use by batch ${s.inUseBatch} (Logbook).`);
  const source: Source = { from: 'logbook', asOf: s.checkedAt, shown: clauses([`${item.code}: ${stateWords(s.state)}`, ...s.warnings]) };
  const out: Pulled = { source, values: {}, sources: {}, problems: [] };
  // The line clearance facts the Logbook has (the room, or a packing line): clean (it is fit for use), when and by whom it was cleaned.
  if ((f.kind === 'room' || f.kind === 'machine') && block.gmp === 'line-clearance') {
    const facts: [string, string | null][] = [['clean', 'yes'], ['cleanedOn', s.cleanedAt], ['cleanedBy', s.cleanedBy]];
    for (const [name, v] of facts) if (v && block.fields.some((x) => x.name === name)) { out.values[name] = v; out.sources[name] = source; }
  }
  return out;
}

// A Logbook status in plain words (equipment_status_v1.state), never its key.
export const stateWords = (state: string) => state.replace(/_/g, ' ').replace(/\bpm\b/, 'PM');

// An MMS lot status in plain words.
const LOT_WORDS: Record<string, string> = { quarantine: 'in quarantine', quarantined: 'in quarantine', under_test: 'under test', on_hold: 'on hold' };
const plantDay = (now: Date, tz: string) => now.toLocaleDateString('en-CA', { timeZone: tz });

/** TL-12: a lot MMS has, of this step's material, released and in date; its certificate numbers come with it (TL-13). */
export async function pullLot(app: FastifyInstance, doc: MasterDoc, st: Step, block: Block, lot: string, was: Record<string, Value>, now: Date, tz: string): Promise<Pulled> {
  const r = await app.links.mms.lot(lot);
  if (r.state !== 'ok') return hand('mms', r.state);
  const l = r.value;
  if (!l) return refused(`Lot ${lot} is not in MMS.`);
  const line = lineOf(doc, st);
  const today = plantDay(now, tz);
  const problems: string[] = [];
  if (line && l.materialMasterId !== line.materialItemId) problems.push(`Lot ${lot} is ${l.materialCode ?? 'another material'} in MMS, not ${line.code} ${line.name}.`);
  if (!LOT_USABLE.includes(l.status)) problems.push(`Lot ${lot} is ${LOT_WORDS[l.status] ?? l.status.replaceAll('_', ' ')} in MMS: only a released lot may be used.`);
  if (l.expiryDate && l.expiryDate < today) problems.push(`Lot ${lot} expired on ${plantDate(l.expiryDate)}.`);
  if (l.retestDate && l.retestDate < today) problems.push(`Lot ${lot} is past its retest date ${plantDate(l.retestDate)}.`);
  const source: Source = { from: 'mms', asOf: l.dataAsOf, shown: `MMS lot ${lot}: ${l.status}, expiry ${l.expiryDate ?? '—'}, retest ${l.retestDate ?? '—'}, QC report ${l.qcReportRef ?? '—'}` };
  const out: Pulled = { source, values: {}, sources: {}, problems };
  for (const [name, test] of Object.entries(CERTIFICATE)) {
    const f = block.fields.find((x) => x.name === name);
    if (!f) continue;
    const t = l.tests.find((x) => x.test.toLowerCase() === test);
    if (!t?.value) {
      // A value of the previous lot must not stay with this one.
      if (was[name] !== undefined) problems.push(`MMS has no ${f.label.toLowerCase()} for lot ${lot}; the step holds one of another lot: correct the lot back, or raise a deviation.`);
      continue;
    }
    if (t.unit !== '%') { problems.push(`MMS gives the ${test} of lot ${lot} in ${t.unit ?? 'no unit'}, not in %.`); continue; }
    const basis = line && 'adjust' in line ? line.adjust?.potency?.basis : undefined;
    if (name === 'assay' && basis && t.basis?.toLowerCase() !== basis) problems.push(`MMS gives the assay of lot ${lot} ${t.basis ? `on the ${t.basis} basis` : 'without its basis'}; the master's line is on the ${basis} basis.`);
    out.values[name] = { value: t.value, unit: '%' };
    out.sources[name] = { from: 'mms', asOf: l.dataAsOf, shown: `${test} ${t.value} %${t.basis ? ` (${t.basis})` : ''}, report ${t.reportRef ?? l.qcReportRef ?? '—'}` };
  }
  return out;
}

/**
 * Packing: a bulk batch TrueBatch Liquids has RELEASED, of this pack's bulk product; its date of manufacture (the date
 * its first processing step started, batch_fact_v1.manufactured_on) comes with it, and so do the bulk issued (its
 * good quantity in L or kg, batch_fact_v1.good_quantity; owner 17 Nov 2026: pull, don't type), when it was ready and its
 * hold (TL-17). Without a good quantity (not given by its view) the bulk issued is typed.
 * Bug fix (17 Nov 2026): the bulk offered is what is LEFT of the bulk batch: its good quantity less what the other
 * packing batches of it were issued (`others`, net of what a terminated one gave back; shared/engine/stock.ts bulkLeft).
 * `typed`: a part issue, more than 0 and up to what is left; none issues all that is left.
 */
export async function pullBulk(app: FastifyInstance, doc: MasterDoc, block: Block, batchNo: string, typed: unknown, others: () => Promise<BulkIssue[]>, now = new Date()): Promise<Pulled> {
  const r = await app.links.truebatch_liquids.batch(batchNo);
  if (r.state !== 'ok') return hand('truebatch_liquids', r.state);
  const b = r.value;
  if (!b) return refused(`Bulk batch ${batchNo} is not in TrueBatch Liquids.`);
  const problems: string[] = [];
  if (doc.pack && b.productCode !== doc.pack.bulkCode) problems.push(`Bulk batch ${batchNo} is ${b.productCode ?? 'another product'} in TrueBatch Liquids, not ${doc.pack.bulkCode} ${doc.pack.bulkName}.`);
  if (!b.released) problems.push(`Bulk batch ${batchNo} is ${b.status.toLowerCase().replaceAll('_', ' ')} in TrueBatch Liquids: only a released bulk batch may be filled.`);
  if (!b.mfgDate) problems.push(`Bulk batch ${batchNo} has no date of manufacture in TrueBatch Liquids (no processing step started).`);
  // TL-17, TL-P2: the bulk hold runs from the end of manufacturing; a bulk past its hold is not issued.
  const holdEnd = b.readyAt && b.holdHours ? new Date(new Date(b.readyAt).getTime() + Number(b.holdHours) * 3_600_000) : null;
  if (holdEnd && now > holdEnd) problems.push(`Bulk batch ${batchNo} was ready at ${b.readyAt} and its hold of ${b.holdHours} h ended at ${holdEnd.toISOString().slice(0, 16)}Z: it may not be issued for filling.`);
  const source: Source = { from: 'truebatch_liquids', asOf: b.dataAsOf, shown: `TrueBatch Liquids batch ${batchNo}: ${b.status}, ${b.productCode ?? '—'}, manufactured ${b.mfgDate ?? '—'}` };
  const out: Pulled = { source, values: {}, sources: {}, problems };
  if (b.mfgDate && block.fields.some((x) => x.name === 'mfgDate')) { out.values.mfgDate = b.mfgDate; out.sources.mfgDate = source; }
  if (b.readyAt && b.holdHours && block.fields.some((x) => x.name === 'readyAt')) {
    out.values.readyAt = b.readyAt; out.values.holdHours = b.holdHours;
    out.sources.readyAt = out.sources.holdHours = { ...source, shown: `${source.shown}, ready ${b.readyAt}, hold ${b.holdHours} h` };
  }
  const quantity = block.fields.find((x) => x.name === 'quantity');
  if (b.goodQuantity && quantity) {
    const unit = quantity.unit!;
    if (b.goodUnit && b.goodUnit !== unit) { problems.push(`Bulk batch ${batchNo} is given in ${b.goodUnit} in TrueBatch Liquids; this packing master fills a bulk in ${unit}.`); return out; }
    out.taken = ['quantity'];
    const left = bulkLeft(b.goodQuantity, await others());
    const part = typed === undefined || typed === null || (typeof typed === 'string' && !typed.trim()) ? null : readValue(quantity, typed, unit);
    if (part && typeof part === 'object' && 'error' in part) { problems.push(part.error); return out; }
    const value = part && typeof part === 'object' && 'value' in part ? part.value : left.left;
    const no = bulkIssueProblem(batchNo, part ? value : null, b.goodQuantity, left, unit);
    if (no) { problems.push(no); return out; }
    out.values.quantity = { value, unit };
    out.sources.quantity = { ...source, shown: `${source.shown}, ${b.goodQuantity} ${unit} good, ${left.issued} ${unit} issued to other packing batches, ${left.left} ${unit} left${part ? `, ${value} ${unit} issued (typed, a part issue)` : ''}` };
  }
  return out;
}

/** Packing: a date of manufacture typed from the bulk labels (no TrueBatch Liquids link): a real date, never in the future. */
export function mfgDateProblem(f: BlockField, v: string, now: Date, tz: string): string | null {
  const d = new Date(`${v}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return `${f.label}: give a date, e.g. 2026-11-15.`;
  if (v > plantDay(now, tz)) return `The date of manufacture ${plantDate(v)} is in the future: give the date on the bulk labels.`;
  return null;
}

/** The answer to a hand question: yes to every label question, a date in date for the lot. */
export function handProblem(f: BlockField, v: string, now: Date, tz: string): string | null {
  if (f.kind === 'yes-no' && v !== 'yes') return `${f.label}: if not, do not use it; use another, or raise a deviation.`;
  if (f.name.endsWith('.expiry')) {
    const d = new Date(`${v}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return `${f.label}: give a date, e.g. 2026-11-15.`;
    if (v < plantDay(now, tz)) return `The lot expired or passed its retest date on ${plantDate(v)}: it may not be used.`;
  }
  return null;
}

export const pulledWords = (s: Source) => (s.from === 'hand' ? '' : `comes from ${PROVIDER_NAME[s.from]} and cannot be typed over`);

// ---- LIMS (readers round 2): QC's CoA and results, picked while the link answers (shared/engine/lims.ts).

/** The CoAs LIMS has for this batch or lot number (`all`, one per sample) and those that may be used (approved, of it). */
export async function usableCoas(app: FastifyInstance, want: CoaFor): Promise<{ link: LinkState; coas: Coa[]; all: Coa[] }> {
  const r = await app.links.lims.coas(want.kind === 'PRODUCT' ? want.batchNo : want.lot);
  if (r.state !== 'ok') return { link: r.state, coas: [], all: [] };
  const all = [...new Map(r.value.map((c) => [c.coaId, c])).values()];
  return { link: 'ok', coas: all.filter((c) => !coaRefusal(c, want)), all };
}

/** The results of this batch's approved CoAs that may fill a field in `unit` (round 41: or in any of several units). */
export async function usableResults(app: FastifyInstance, want: Extract<CoaFor, { kind: 'PRODUCT' }>, unit: string | string[]): Promise<{ link: LinkState; results: QcResult[] }> {
  const units = Array.isArray(unit) ? unit : [unit];
  const c = await usableCoas(app, want);
  if (c.link !== 'ok' || !c.coas.length) return { link: c.link, results: [] };
  const r = await app.links.lims.results(c.coas.map((x) => x.coaId));
  if (r.state !== 'ok') return { link: r.state, results: [] };
  return { link: 'ok', results: r.value.filter((x) => units.some((u) => !resultRefusal(x, u))) };
}

/**
 * A QC result field (`qc`): while LIMS answers, the answer is a pick ({ lims: result id }) of a result of this batch's
 * approved CoA, filled with its reported figure; a typed number is refused. Absent or down: typed by hand (a second
 * person checks it, QA's review lists it); a pick is then refused.
 */
export async function pullQcResult(app: FastifyInstance, f: BlockField, raw: unknown, unit: string, batchNo: string, productCode: string): Promise<Pulled & { value?: Value }> {
  const r = await usableResults(app, { kind: 'PRODUCT', batchNo, productCode }, unit);
  if (r.link !== 'ok') return isPick(raw) ? refused(`LIMS does not answer now: type ${f.label} from the QC report.`) : hand('lims', r.link);
  if (!isPick(raw)) return refused(`${f.label} comes from LIMS: pick the result of the approved CoA of batch ${batchNo}.`);
  const x = r.results.find((y) => y.resultId === raw.lims);
  if (!x) return refused(`${f.label}: that result is not a result in ${unit} of an approved CoA of batch ${batchNo} in LIMS.`);
  const source: Source = { from: 'lims', asOf: null, shown: resultText(x) };
  return { source, values: {}, sources: {}, problems: [], value: { value: x.reported!.trim(), unit } };
}

/**
 * A CoA number (the batch's QC approval, a lot's "QC report or certificate number" typed by hand): while LIMS answers
 * it must be an approved CoA of this batch or lot there (picked); absent or down, typed by hand.
 */
export async function pullCoa(app: FastifyInstance, number: string, want: CoaFor): Promise<Pulled> {
  const r = await usableCoas(app, want);
  if (r.link !== 'ok') return hand('lims', r.link);
  const c = r.coas.find((x) => x.coaNumber?.trim().toLowerCase() === number.trim().toLowerCase());
  // The CoA number as LIMS writes it.
  if (c) return { source: { from: 'lims', asOf: c.decidedAt, shown: coaText(c) }, values: { coaNumber: c.coaNumber! }, sources: {}, problems: [] };
  const other = r.all.find((x) => x.coaNumber?.trim().toLowerCase() === number.trim().toLowerCase());
  const what = want.kind === 'PRODUCT' ? `batch ${want.batchNo}` : `lot ${want.lot}`;
  return refused(other ? coaRefusal(other, want)! : `${number} is not an approved CoA of ${what} in LIMS: pick one${r.coas.length ? '' : ' once QC has approved it there'}.`);
}

/** Round 42: the step's lab request: this batch and product, the request '<batch>/<step key>'. */
export type InProcessFor = { batchNo: string; productCode: string; request: string };

/**
 * The results of the approved in-process reports of this step's lab request, or (round 43) of an earlier round of the
 * same step, in any of `units` (each field checks its own fit). `taken`: results another round of the step picked
 * already (one result fills one round). Each result keeps the request it was sampled for.
 */
export async function usableInProcess(app: FastifyInstance, want: InProcessFor, units: string[], taken: ReadonlySet<string> = new Set()): Promise<{ link: LinkState; results: QcResult[] }> {
  const c = await usableCoas(app, { kind: 'PRODUCT', ...want });
  if (c.link !== 'ok' || !c.coas.length) return { link: c.link, results: [] };
  const r = await app.links.lims.results(c.coas.map((x) => x.coaId));
  if (r.state !== 'ok') return { link: r.state, results: [] };
  const requestOf = new Map(c.coas.map((x) => [x.coaId, x.requestId ?? null]));
  return { link: 'ok', results: r.value.map((x) => ({ ...x, requestId: x.requestId ?? requestOf.get(x.coaId) ?? null }))
    .filter((x) => requestOf.has(x.coaId) && requestFits(x.requestId, want.request) && !taken.has(x.resultId) && units.some((u) => sameUnit(x.unit, u))) };
}

/**
 * An in-process QC field (qc 'in_process', round 42): while LIMS answers, the answer is a pick ({ lims: result id }) of a
 * result of an approved in-process report of THIS step's lab request or (round 43) an earlier round's; a list takes its
 * individual values (and a staged list the other stage's too: `values`), a single number the reported figure. A typed
 * value is refused. Absent or down: typed by hand (a second person checks it, QA's review lists it); a pick is then
 * refused. `taken`: results another round of the step picked (one result fills one round); `sampled`: the round and
 * time a request of the step opened (the record says which sample was used).
 */
export async function pullInProcess(app: FastifyInstance, block: Block, f: BlockField, raw: unknown, unitOf: (f: BlockField) => string, want: InProcessFor,
  recorded: Record<string, Value>, coating: string | undefined, taken: ReadonlySet<string>, sampled: (request: string) => { round?: number; at?: string } | undefined): Promise<Pulled> {
  const r = await usableInProcess(app, want, [unitOf(f)]);
  if (r.link !== 'ok') return isPick(raw) ? refused(`LIMS does not answer now: type ${f.label} from the QC report.`) : hand('lims', r.link);
  if (!isPick(raw)) return refused(`${f.label} comes from LIMS: pick the result of in-process request ${want.request} once QC has approved it there.`);
  const x = r.results.find((y) => y.resultId === raw.lims);
  if (!x) return refused(`${f.label}: that result is not a result in ${unitOf(f)} of an approved in-process report of request ${want.request} (this step) in LIMS.`);
  if (taken.has(x.resultId)) return refused(`${f.label}: in-process report ${x.coaNumber} (request ${x.requestId}) was used in another round of this step: one result fills one round.`);
  const fit = inProcessFit(x, f, unitOf(f), block.fields, recorded, coating);
  if ('error' in fit) return refused(fit.error);
  const request = x.requestId ?? want.request;
  const source: Source = { from: 'lims', asOf: null, shown: inProcessText(x, request, sampled(request)), ref: x.resultId, request };
  const out: Pulled = { source, values: {}, sources: {}, problems: [] };
  for (const [name, v] of Object.entries(fit.take)) {
    const u = unitOf(block.fields.find((y) => y.name === name)!);
    out.values[name] = Array.isArray(v) ? v.map((value) => ({ value, unit: u })) : { value: v, unit: u };
    out.sources[name] = source;
  }
  return out;
}
