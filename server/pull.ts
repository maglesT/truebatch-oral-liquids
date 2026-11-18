import type { FastifyInstance } from 'fastify';
import type { MasterEquipment, MasterRoom } from './master.js';
import type { Block, BlockField } from '../shared/blocks/index.js';
import { materialLines, type FormulaLine, type MasterDoc, type PackMaterial, type Step } from '../shared/master/schema.js';
import { CERTIFICATE, PROVIDER_NAME, bulkIssueProblem, bulkLeft, clauses, readValue, type BulkIssue, type Provider, type Source, type Value } from '../shared/engine/index.js';
import { LOT_USABLE } from './links.js';
import { plantDate } from '../shared/plant-time.js';

// What a link gives a step value at write time (owner 15 Nov 2026, TB-11, TB-12): the value as read now, or a
// refusal in plain words; when the link is absent or down, the value is typed by hand (its questions in
// shared/engine/links.ts). Nothing read is kept but what the record keeps (PL-07).

// taken: typed fields the pull has read itself (the tablets of a part issue), not read again as typed.
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
 * TB-11: a machine or room the Logbook says is fit for use, not kept for another product (after an antibiotic) and not
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

/** TB-12: a lot MMS has, of this step's material, released and in date; its certificate numbers come with it (TB-13). */
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
 * Packing: a bulk batch TrueBatch Tablets has RELEASED, of this pack's bulk product; its date of manufacture (the date
 * its first processing step started, batch_fact_v1.manufactured_on) comes with it, and so do the tablets issued (its
 * good tablets, batch_fact_v1.good_quantity; owner 17 Nov 2026: pull, don't type). Without a good quantity (not given
 * by its view) the tablets are typed.
 * Bug fix (17 Nov 2026): the tablets offered are what is LEFT of the bulk batch: its good tablets less what the other
 * packing batches of it were issued (`others`, net of what a terminated one gave back; shared/engine/stock.ts bulkLeft).
 * `typed`: a part issue, more than 0 and up to what is left; none issues all that is left.
 */
export async function pullBulk(app: FastifyInstance, doc: MasterDoc, block: Block, batchNo: string, typed: unknown, others: () => Promise<BulkIssue[]>): Promise<Pulled> {
  const r = await app.links.truebatch.batch(batchNo);
  if (r.state !== 'ok') return hand('truebatch', r.state);
  const b = r.value;
  if (!b) return refused(`Bulk batch ${batchNo} is not in TrueBatch Tablets.`);
  const problems: string[] = [];
  if (doc.pack && b.productCode !== doc.pack.bulkCode) problems.push(`Bulk batch ${batchNo} is ${b.productCode ?? 'another product'} in TrueBatch Tablets, not ${doc.pack.bulkCode} ${doc.pack.bulkName}.`);
  if (!b.released) problems.push(`Bulk batch ${batchNo} is ${b.status.toLowerCase().replaceAll('_', ' ')} in TrueBatch Tablets: only a released bulk batch may be packed.`);
  if (!b.mfgDate) problems.push(`Bulk batch ${batchNo} has no date of manufacture in TrueBatch Tablets (no processing step started).`);
  const source: Source = { from: 'truebatch', asOf: b.dataAsOf, shown: `TrueBatch Tablets batch ${batchNo}: ${b.status}, ${b.productCode ?? '—'}, manufactured ${b.mfgDate ?? '—'}` };
  const out: Pulled = { source, values: {}, sources: {}, problems };
  if (b.mfgDate && block.fields.some((x) => x.name === 'mfgDate')) { out.values.mfgDate = b.mfgDate; out.sources.mfgDate = source; }
  const tablets = block.fields.find((x) => x.name === 'tablets');
  if (b.goodQuantity && tablets) {
    const unit = tablets.unit ?? 'tablets';
    out.taken = ['tablets'];
    const left = bulkLeft(b.goodQuantity, await others());
    const part = typed === undefined || typed === null || (typeof typed === 'string' && !typed.trim()) ? null : readValue(tablets, typed, unit);
    if (part && typeof part === 'object' && 'error' in part) { problems.push(part.error); return out; }
    const value = part && typeof part === 'object' && 'value' in part ? part.value : left.left;
    const no = bulkIssueProblem(batchNo, part ? value : null, b.goodQuantity, left);
    if (no) { problems.push(no); return out; }
    out.values.tablets = { value, unit };
    out.sources.tablets = { ...source, shown: `${source.shown}, ${b.goodQuantity} good tablets, ${left.issued} issued to other packing batches, ${left.left} left${part ? `, ${value} issued (typed, a part issue)` : ''}` };
  }
  return out;
}

/** Packing: a date of manufacture typed from the bulk labels (no TrueBatch Tablets link): a real date, never in the future. */
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
