/**
 * What a step takes from a material lot, as the product publishes it to MMS in material_use_v1 (db/migrations/0011 and
 * 0012, packing/migrations/0104 and 0105: less what a terminated batch gave back), and that quantity in the lot's unit
 * as MMS counts it. MMS shows a lot's available stock as its own balance less what the TrueBatch products used (MMS
 * D-57 to D-59); a lot is not used beyond it while MMS answers.
 */
import { materialLines, type MasterDoc, type Step } from '../master/schema.js';
import { Dec } from '../templates/index.js';
import type { Stored, Value } from './values.js';
import type { StepView } from './batch.js';

// The blocks whose material the other products read as used (material_use_v1 of both products).
export const MATERIAL_USE = ['weigh', 'lubricate', 'pack-material-issue'];

type Q = { value: string; unit: string };
const isQ = (v: Value | undefined): v is Q => typeof v === 'object' && !Array.isArray(v) && 'value' in v && 'unit' in v;
const material = (st: Step) => { const m = st.settings.material; return typeof m === 'object' && m !== null && 'formula' in m ? m.formula : undefined; };
const done = (v: StepView) => v.events.some((e) => e.kind === 'done');

/**
 * The quantity a step takes from its lot: the net weight of a weighing (when worked out), or the quantity of a packing
 * material issued less what its reconciliation returned to stores uncoded, once that reconciliation is signed done
 * (destroyed and batch-coded material is used, not returned). `steps`: the batch's steps, for the reconciliation.
 */
export function usedQuantity(doc: MasterDoc, st: Step, values: Record<string, Value>, results: Record<string, Stored>, steps: readonly StepView[]): Q | null {
  if (st.block.id === 'weigh' || st.block.id === 'lubricate') {
    const net = results.net;
    return net?.ok ? { value: net.value, unit: net.unit } : null;
  }
  if (st.block.id !== 'pack-material-issue') return null;
  const issued = values.issued;
  if (!isQ(issued)) return null;
  const rec = steps.find((v) => {
    const r = doc.stages[v.key.stage]?.steps[v.key.step];
    return r?.block.id === 'printed-reconciliation' && material(r) === material(st) && done(v);
  });
  const returned = rec?.values.returned;
  return isQ(returned) && returned.unit === issued.unit ? { value: new Dec(issued.value).minus(returned.value).toString(), unit: issued.unit } : issued;
}

// The count names material_use_v1 publishes a count in when master data names one (db/migrations/0011).
const COUNT = ['nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers'];
/**
 * A step's quantity as material_use_v1 publishes it: in the material's unit in master data read when the step was
 * signed done (`stockUnit`): g and mg exactly in kg for a kg material, a count in master data's count name (nos);
 * otherwise in the step's unit.
 */
export function published(q: Q, stockUnit?: string): Q {
  const su = stockUnit?.toLowerCase();
  if (su === 'kg' && ['kg', 'g', 'mg'].includes(q.unit)) return { value: new Dec(q.value).times(q.unit === 'g' ? '0.001' : q.unit === 'mg' ? '0.000001' : '1').toString(), unit: stockUnit! };
  return q.unit === 'units' && su && COUNT.includes(su) ? { value: q.value, unit: stockUnit! } : q;
}
/** The unit a field of `unit` is shown in: master data's name for the material's unit when it is the same unit (nos for units). */
export function unitName(unit: string, stockUnit?: string | null): string {
  const p = published({ value: '1', unit }, stockUnit ?? undefined);
  return p.value === '1' ? p.unit : unit;
}
/**
 * A packing material's quantity per pack in words (owner's confirmation run, 17 Nov 2026): a count used less than once
 * per pack reads "1 carton per 10 packs", "1 shipper per 500 packs", not "0.1 nos"; else "2 nos per pack", "0.12 m per pack".
 */
export function perPackText(m: { perPack: string; unit: string; kind: string }, stockUnit?: string | null): string {
  const n = Number(m.perPack);
  const packs = n > 0 && n < 1 ? Math.round(1 / n) : 0;
  if (m.unit === 'units' && packs > 1 && Math.abs(packs * n - 1) < 1e-9) return `1${m.kind === 'other' ? '' : ` ${m.kind}`} per ${packs} packs`;
  return `${m.perPack} ${unitName(m.unit, stockUnit)} per pack`;
}
const stockUnitOf = (v: StepView) => v.events.filter((e) => typeof e.payload.stockUnit === 'string').at(-1)?.payload.stockUnit as string | undefined;

/**
 * What QA said went back to stores unused when terminating the batch (owner, 16 Nov 2026), per lot in the unit
 * material_use_v1 publishes it; the rest of the lot is used (destroyed or in the batch). Payload of the terminate event.
 */
export interface Returned { lot: string; material: string; value: string; unit: string }
export const returnsOf = (batchEvents: readonly { kind: string; payload: { terminated?: boolean; returns?: Returned[] } }[]) =>
  batchEvents.find((e) => e.kind === 'rejected' && e.payload.terminated)?.payload.returns ?? [];
const sameLot = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const order = (a: StepView, b: StepView) => a.key.stage - b.key.stage || a.key.sub - b.key.sub || a.key.step - b.key.step || a.key.round - b.key.round;

/**
 * Every use of a material lot by a batch (signed done, as material_use_v1 lists them) with its quantity as published.
 * `returns` (a terminated batch's) are taken off the uses of the same lot and unit, the last step first, never below 0.
 */
export function materialUses(doc: MasterDoc, steps: readonly StepView[], returns: readonly Returned[] = []): { step: StepView; lot: string; quantity: Q }[] {
  const uses = [...steps].sort(order).flatMap((v) => {
    const st = doc.stages[v.key.stage]?.steps[v.key.step];
    if (!st || !MATERIAL_USE.includes(st.block.id) || !done(v) || typeof v.values.lot !== 'string') return [];
    const quantity = usedQuantity(doc, st, v.values, v.results, steps);
    return quantity ? [{ step: v, lot: v.values.lot, quantity: published(quantity, stockUnitOf(v)) }] : [];
  });
  const left = new Map<Returned, Dec>(returns.map((r) => [r, new Dec(r.value)]));
  return uses.reverse().map((u) => {
    const r = returns.find((x) => sameLot(x.lot, u.lot) && x.unit === u.quantity.unit);
    if (!r) return u;
    const take = Dec.min(left.get(r)!, u.quantity.value);
    left.set(r, left.get(r)!.minus(take));
    return { ...u, quantity: { ...u.quantity, value: new Dec(u.quantity.value).minus(take).toString() } };
  }).reverse();
}

/** The steps of a batch that have used a material lot, each with its quantity as published (`returns`: as materialUses). */
export const usesOfLot = (doc: MasterDoc, steps: readonly StepView[], lot: string, returns: readonly Returned[] = []) =>
  materialUses(doc, steps, returns).filter((u) => sameLot(u.lot, lot));

/**
 * Packing: the bulk batch and the tablets issued to a packing batch (its first step, bulk-issue, recorded at issue), as
 * one more "lot" QA's terminate asks about (what went back unused), so the tablets that went back can be issued again
 * (bulkLeft). Not an MMS lot: material_use_v1 does not list it.
 */
export function bulkIssued(doc: MasterDoc, steps: readonly StepView[]): Returned | null {
  const first = steps.find((v) => v.key.stage === 0 && v.key.step === 0 && v.key.round === 1);
  if (!doc.pack || doc.stages[0]?.steps[0]?.block.id !== 'bulk-issue' || !first) return null;
  const { bulk, tablets } = first.values;
  return typeof bulk === 'string' && isQ(tablets) ? { lot: bulk, material: `bulk ${doc.pack.bulkCode} · ${doc.pack.bulkName}`, value: tablets.value, unit: tablets.unit } : null;
}

/** One packing batch's issue of a bulk batch: the tablets issued, less what went back when it was terminated. */
export interface BulkIssue { batchNo: string; tablets: string; returned: string | null }
/**
 * What is left of a bulk batch to issue to a packing batch (bug fix, 17 Nov 2026): its good tablets (batch_fact_v1)
 * less the tablets the other packing batches of it were issued, net of what a terminated one gave back. Never below 0.
 */
export function bulkLeft(good: string, others: readonly BulkIssue[]): { issued: string; left: string } {
  const issued = others.reduce((s, x) => s.plus(Dec.max(new Dec(x.tablets).minus(x.returned ?? 0), 0)), new Dec(0));
  return { issued: issued.toString(), left: Dec.max(new Dec(good).minus(issued), 0).toString() };
}
/** Why the tablets typed (a part issue) cannot be issued from the bulk batch: more than 0, up to what is left. */
export function bulkIssueProblem(bulk: string, typed: string | null, good: string, left: { issued: string; left: string }): string | null {
  if (!new Dec(left.left).gt(0)) return `All ${good} good tablets of bulk batch ${bulk} are already issued to other packing batches: nothing is left to issue.`;
  if (typed === null) return null;
  if (!new Dec(typed).gt(0)) return 'Bulk tablets issued: give more than 0 tablets.';
  if (new Dec(typed).gt(left.left)) return `Only ${left.left} tablets of bulk batch ${bulk} are left to issue (${good} good tablets, ${left.issued} already issued to other packing batches): issue ${left.left} or less.`;
  return null;
}

/**
 * What the batch has used of each lot, per lot and unit as published, with its material: what QA's terminate asks
 * about. A packing batch: its bulk batch first (bulkIssued).
 */
export function issuedLots(doc: MasterDoc, steps: readonly StepView[]): Returned[] {
  const bulk = bulkIssued(doc, steps);
  const out: Returned[] = bulk ? [bulk] : [];
  for (const u of materialUses(doc, steps)) {
    const had = out.find((x) => sameLot(x.lot, u.lot) && x.unit === u.quantity.unit);
    if (had) { had.value = new Dec(had.value).plus(u.quantity.value).toString(); continue; }
    const m = Object.values(doc.stages[u.step.key.stage]!.steps[u.step.key.step]!.settings).find((x): x is { formula: string } => typeof x === 'object' && x !== null && 'formula' in x);
    const line = m && materialLines(doc).find((l) => l.key === m.formula);
    out.push({ lot: u.lot, material: line ? `${line.code} · ${line.name}` : '', value: u.quantity.value, unit: u.quantity.unit });
  }
  return out;
}

/** Why the quantities QA says went back to stores cannot be taken: one per issued lot, 0 to what the batch used of it. */
export function returnProblems(issued: readonly Returned[], returns: readonly { lot: string; value: string; unit: string }[]): string[] {
  const problems = returns.filter((r) => !issued.some((x) => sameLot(x.lot, r.lot) && x.unit === r.unit))
    .map((r) => `Lot ${r.lot} (${r.unit}) was not issued to this batch.`);
  for (const x of issued) {
    const r = returns.filter((y) => sameLot(y.lot, x.lot) && y.unit === x.unit);
    if (r.length !== 1) problems.push(`Say how much of lot ${x.lot}${x.material ? ` (${x.material})` : ''} went back to stores unused: 0 if none.`);
    else if (new Dec(r[0]!.value).gt(x.value)) problems.push(`Lot ${x.lot}: ${x.value} ${x.unit} was issued to this batch; ${r[0]!.value} ${x.unit} cannot have gone back to stores.`);
  }
  return problems;
}

// As MMS counts a line in the lot's unit (D-59): units of one kind, by a power of ten, so exactly; the count names are
// one unit. Units of different kinds are never converted (MMS lists such a line and does not count it).
const UNIT: Record<string, [kind: string, power: number]> = {
  mg: ['mass', -3], g: ['mass', 0], kg: ['mass', 3],
  ml: ['volume', 0], l: ['volume', 3],
  ...Object.fromEntries(COUNT.map((c) => [c, ['count', 0] as [string, number]])),
};
/** A quantity in the lot's unit, or null when its unit is not of the lot unit's kind. */
export function inLotUnit(q: Q, lotUnit: string): Dec | null {
  const from = UNIT[q.unit.trim().toLowerCase()];
  const to = UNIT[lotUnit.trim().toLowerCase()];
  if (!from || !to || from[0] !== to[0]) return null;
  return new Dec(q.value).times(new Dec(10).pow(from[1] - to[1]));
}
