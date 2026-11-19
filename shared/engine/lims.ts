/**
 * Medhanta LIMS (readers round 2): QC's certificate of analysis (CoA) and its results, read live from LIMS's published
 * views coa_v1 and result_v1. Where a step asks for a QC result, or QC approves the batch or a lot with its report
 * number, the CoA or result is PICKED from LIMS while the link answers: the pick fills the answer and keeps the LIMS
 * reference (the CoA number). Absent or down, it is typed by hand as before. Fixed rules, checked once here:
 * - only an APPROVED CoA counts (a rejected one, or one LIMS later rejected, is never pickable);
 * - it is of this batch (a product sample, the batch number) or of this lot (a material sample, the lot number and the
 *   line's material); a CoA of another batch, lot, product or material is refused;
 * - a batch's CoA is of a release sample (not stability or an investigation); a lot's of a release or retest sample;
 * - a result gives LIMS's `reported` figure (rounded as its limit is written), in the unit the step asks for (sameUnit).
 * Round 42 (owner: in-process lab tests are picked, not typed): a step with an in-process QC field (block field flag
 * qc 'in_process') opens a lab request when it starts, published as report.lab_request_v1 ('<batch>/<step key>'). Its
 * fields pick a result of an APPROVED in-process report (purpose in_process, an IPR number) of THAT request: of this
 * batch and product, this step. A list of readings (blend or content uniformity) takes LIMS's individual values in their
 * order, exactly as many as the block asks for (never padded or cut); LIMS's reported figure of them (their mean, or the
 * acceptance value) is worked out again from the values and must agree, rounded as LIMS wrote it. A single figure
 * (no count) takes LIMS's reported figure, as a release CoA's result.
 * Round 43 (found by the API edition's periodic reactions): a step with rounds also takes the report of an EARLIER
 * round of the same step (requestFits), each result filling one round; the record says which round it was sampled in.
 * Round 44: a result that names the field it answers (result_v1.ipc_field) fills only that field (answersField), so in
 * a step with several fields in one unit a result of one test never goes into another; one that names none (an older
 * LIMS) is matched by its unit, as before.
 */
import type { BlockField } from '../blocks/format.js';
import { Dec, roundHalfUp, t14ContentUniformity, writtenDecimals } from '../templates/index.js';

/** A row of LIMS coa_v1, as read. `rejected`: LIMS has a rejection of the same sample too. */
export interface Coa {
  coaId: string; coaNumber: string | null; sampleNumber: string; lotNumber: string | null; itemKind: string | null;
  itemMasterId: string | null; itemCode: string | null; itemName: string | null; purpose: string | null; decision: string;
  decidedAt: string | null; decidedBy: string | null; specNumber: string | null; specVersion: number | null; rejected?: boolean;
  /** Round 42: the lab request of an in-process sample (lab_request_v1.request_id); null for other purposes. */
  requestId?: string | null;
}
/** A row of LIMS result_v1 of an approved CoA, as read; `reported` is the figure as reported (null before LIMS kept it). */
export interface QcResult {
  resultId: string; coaId: string; coaNumber: string | null; testName: string | null; reported: string | null; unit: string | null;
  limitText: string | null; analysisNumber: string | null; outsideLab: string | null;
  /** Round 42: the lab request (in-process), the individual values in LIMS's order (null when not individual), and what
   * `reported` is: 'mean' | 'AV' | 'result' (null from a LIMS without the column). */
  requestId?: string | null; individual?: string[] | null; figure?: string | null;
  /** Round 44: the TrueBatch field the result answers (its in-process specification test names it); null from a LIMS
   * without the column, or a result that names none: then it is matched by its unit only. */
  ipcField?: string | null;
}
/** What the CoA must be of: this batch (its product), or this lot of the step's material. */
export type CoaFor =
  | { kind: 'PRODUCT'; batchNo: string; productCode: string; request?: string }
  | { kind: 'MATERIAL'; lot: string; materialId?: string; materialCode?: string };

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
const PURPOSES: Record<CoaFor['kind'], string[]> = { PRODUCT: ['release'], MATERIAL: ['release', 'retest'] };

/** Why this CoA may not be used for `want`, in plain words; null when it may. */
export function coaRefusal(c: Coa, want: CoaFor): string | null {
  const no = c.coaNumber ?? `of sample ${c.sampleNumber}`;
  const what = want.kind === 'PRODUCT' ? `batch ${want.batchNo}` : `lot ${want.lot}`;
  if (c.decision !== 'APPROVED' || c.rejected || !c.coaNumber) return `CoA ${no} is not approved in LIMS (${c.decision.toLowerCase()}): only an approved CoA may be used.`;
  if (c.itemKind !== want.kind) return `CoA ${no} is of a ${(c.itemKind ?? 'other').toLowerCase()} sample, not of ${what}.`;
  if (!same(c.lotNumber, want.kind === 'PRODUCT' ? want.batchNo : want.lot)) return `CoA ${no} is for ${want.kind === 'PRODUCT' ? 'batch' : 'lot'} ${c.lotNumber ?? '—'}, not ${what}.`;
  if (want.kind === 'PRODUCT' && c.itemCode && !same(c.itemCode, want.productCode)) return `CoA ${no} is of ${c.itemCode}, not ${want.productCode}.`;
  if (want.kind === 'MATERIAL' && want.materialId && c.itemMasterId && c.itemMasterId !== want.materialId) {
    return `CoA ${no} is of ${c.itemCode ?? 'another material'}, not ${want.materialCode ?? 'the material of this step'}.`;
  }
  // Round 42: an in-process field takes only an in-process report of this step's own request.
  if (want.kind === 'PRODUCT' && want.request !== undefined) {
    if (c.purpose !== 'in_process') return `CoA ${no} is of a ${c.purpose ?? 'other'} sample: only an in-process report of request ${want.request} (this step) may be used.`;
    if (!requestFits(c.requestId, want.request)) return `In-process report ${no} is for request ${c.requestId ?? '—'}, not request ${want.request} (this step) or an earlier round of it.`;
    return null;
  }
  if (!PURPOSES[want.kind].includes(c.purpose ?? '')) return `CoA ${no} is of a${c.purpose === 'in_process' ? 'n' : ''} ${(c.purpose ?? 'other').replace(/_/g, '-')} sample: only the ${PURPOSES[want.kind].join(' or ')} CoA of ${what} may be used.`;
  return null;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
/**
 * Round 41: the same unit written two ways is one unit. A LIMS result and a step field may write a unit differently
 * (a pH result carries no unit in LIMS; "mL" and "ml"; "mPa·s", "mPa.s" and "mPa s"; spaces). Only spelling is
 * forgiven: the letters of the unit must still be the same (a percentage of a different kind, mg against %, never match).
 */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (u: string | null | undefined) => {
    const x = (u ?? '').trim().replace(/[\s·.⋅]/g, '').toLowerCase();
    return x === 'ph' ? '' : x;
  };
  return norm(a) === norm(b);
}
/** Why this result may not fill a field in `unit`; null when it may (its CoA is checked by coaRefusal). */
export function resultRefusal(r: QcResult, unit: string): string | null {
  const what = `${r.testName ?? 'The result'} of CoA ${r.coaNumber ?? '—'}`;
  if (!r.reported || !NUMBER.test(r.reported.trim())) return `${what} has no reported figure in LIMS.`;
  if (!sameUnit(r.unit, unit)) return `${what} is in ${r.unit || 'no unit'}, not in ${unit}.`;
  return null;
}

/**
 * Round 44: whether a result may fill field `f` of a block with `fields`: a result that names no field (an older LIMS,
 * or a release CoA's result) may fill any field in its unit; one that names a field fills only that field. A staged list
 * (content uniformity) is one test in LIMS: a result holding the values of both stages (L1's first) may fill either
 * stage, whichever of the two it names.
 */
export function answersField(r: Pick<QcResult, 'ipcField' | 'individual'>, f: BlockField, fields: readonly BlockField[]): boolean {
  if (!r.ipcField || r.ipcField === f.name) return true;
  const other = fields.find((x) => x.name === r.ipcField);
  const staged = !!other && (f.nextStage === other.name || other.nextStage === f.name);
  return staged && f.count !== undefined && other!.count !== undefined && r.individual?.length === f.count + other!.count;
}
/** Why this result may not fill field `f` (it answers another field), in plain words; null when it may. */
export function fieldRefusal(r: Pick<QcResult, 'ipcField' | 'individual' | 'testName' | 'coaNumber'>, f: BlockField, fields: readonly BlockField[]): string | null {
  if (answersField(r, f, fields)) return null;
  const label = fields.find((x) => x.name === r.ipcField)?.label ?? r.ipcField;
  return `${r.testName ?? 'The result'} of report ${r.coaNumber ?? '—'} answers ${label}, not ${f.label}.`;
}

/** The CoA as the step, the review and the PDF show it (kept with the record as the source's `shown`). */
export const coaText = (c: Coa) => `LIMS CoA ${c.coaNumber}: sample ${c.sampleNumber}${c.itemCode ? `, ${c.itemCode}` : ''}${c.lotNumber ? ` ${c.lotNumber}` : ''}, approved${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.specNumber ? `, specification ${c.specNumber}${c.specVersion ? ` v${c.specVersion}` : ''}` : ''}`;
export const resultText = (r: QcResult) => `LIMS CoA ${r.coaNumber}: ${r.testName ?? 'result'} ${r.reported}${r.unit ? ` ${r.unit}` : ''} as reported${r.limitText ? ` (limit ${r.limitText})` : ''}${r.analysisNumber ? `, analysis ${r.analysisNumber}` : ''}${r.outsideLab ? `, outside lab ${r.outsideLab}` : ''}`;
/** The answer that picks a LIMS result for a field (the step screen sends it in place of a typed number). */
export const isPick = (x: unknown): x is { lims: string } => !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { lims?: unknown }).lims === 'string';

// ---- Round 42: in-process lab requests and their results.

/** The lab request of a step instance: '<batch number>/<step key>' (a repeated round or sub-batch has its own key). */
export const labRequestId = (batchNo: string, key: string) => `${batchNo}/${key}`;
/** A request id's step (batch and stage.sub-batch.step, without case) and round; null when it is not one. */
export function requestRound(id: string | null | undefined): { step: string; round: number } | null {
  const m = /^(.+\/\d+\.\d+\.\d+)\.(\d+)$/.exec((id ?? '').trim());
  return m ? { step: m[1]!.toLowerCase(), round: Number(m[2]) } : null;
}
/**
 * Round 43 (general rule, found by the API edition's periodic reactions): a step takes an in-process report of its own
 * request or of an EARLIER round of the same step. A sample taken in round 3 is often approved while the rounds go on:
 * a later round uses it (the record says which round it was sampled in). A later round's sample never fills an earlier
 * round, and a step without rounds (round 1) takes only its own request. Whether another round picked it already is
 * the server's (pull.ts: one result fills one round).
 */
export function requestFits(candidate: string | null | undefined, want: string): boolean {
  const c = requestRound(candidate);
  const w = requestRound(want);
  return !!c && !!w && c.step === w.step && c.round <= w.round;
}
/** A test of a lab request, as lab_request_v1.tests lists it. individual: the number of values (a list), else null. */
export interface LabTest { name: string; label: string; unit: string; individual: number | null }
/**
 * The in-process QC fields of a step, as the tests of its lab request (`unitOf`: the field's unit in this step). Round
 * 43: a field whose unit is not set is not asked for (Tablets' in-process fields have a fixed unit, %, so none is left
 * out today; the rule is the same in every edition).
 */
export const labTests = (fields: readonly BlockField[], unitOf: (f: BlockField) => string): LabTest[] =>
  fields.filter((f) => f.qc === 'in_process' && unitOf(f)).map((f) => ({ name: f.name, label: f.label, unit: unitOf(f), individual: f.count ?? null }));

const FIGURE: Record<string, string> = { mean: 'mean', AV: 'acceptance value', result: 'result' };
/**
 * An in-process result as the step, the review and the PDF show it (kept with the record as the source's `shown`): the
 * request it was sampled for and (round 43) when: "sampled in round 3 at <time>" in a step with rounds, else "requested
 * <time>" (the time its request opened).
 */
export const inProcessText = (r: QcResult, request: string, sampled?: { round?: number; at?: string }) => `LIMS in-process report ${r.coaNumber}: ${r.testName ?? 'result'} (request ${request}`
  + `${sampled?.round ? `, sampled in round ${sampled.round}` : ''}${sampled?.at ? `${sampled.round ? ' at' : ', requested'} ${sampled.at}` : ''})${r.individual ? `, ${r.individual.length} values` : ''}`
  + `${r.reported ? `, ${r.individual ? `${FIGURE[r.figure ?? ''] ?? 'reported'} ` : ''}${r.reported}${r.unit ? ` ${r.unit}` : ''} as reported` : ''}${r.limitText ? ` (limit ${r.limitText})` : ''}`
  + `${r.analysisNumber ? `, analysis ${r.analysisNumber}` : ''}${r.outsideLab ? `, outside lab ${r.outsideLab}` : ''}`;

/** The step's own figure of the values (their mean, or the acceptance value of content uniformity), or why it has none. */
function ownFigure(figure: 'mean' | 'AV', values: readonly string[], coating: string | undefined): Dec | { error: string } {
  if (figure === 'mean') return values.reduce((a, v) => a.plus(v), new Dec(0)).div(values.length);
  const t = t14ContentUniformity({ method: 'content uniformity', coating: (coating ?? 'uncoated') as 'uncoated', results: { values, unit: '%' } });
  return t.ok ? new Dec(String(t.value)) : { error: t.message };
}

/**
 * What an in-process result gives a field (and, for a staged list, the field of the other stage): the field values to
 * record, by field name (a list: its values in LIMS's order; a single number: the reported figure), or why it may not
 * (in plain words). `fields`: the block's fields; `recorded`: the step's values now (a second stage's pick checks the
 * first stage's); `coating`: the step's coating (the acceptance value). Its CoA and request are checked by coaRefusal.
 */
export function inProcessFit(r: Pick<QcResult, 'testName' | 'coaNumber' | 'unit' | 'reported' | 'individual' | 'figure' | 'ipcField'>, f: BlockField, unit: string, fields: readonly BlockField[], recorded: Record<string, unknown> = {}, coating?: string):
  { error: string } | { take: Record<string, string | string[]> } {
  const what = `${r.testName ?? 'The result'} of in-process report ${r.coaNumber ?? '—'}`;
  const no = (error: string) => ({ error });
  // Round 44: a result that names the field it answers fills only that field.
  const other = fieldRefusal(r, f, fields);
  if (other) return no(other);
  if (!sameUnit(r.unit, unit)) return no(`${what} is in ${r.unit || 'no unit'}, not in ${unit}.`);
  if (f.count === undefined) {
    if (r.individual?.length) return no(`${what} is a list of ${r.individual.length} values: ${f.label} takes one result.`);
    if (r.figure && r.figure !== 'result') return no(`${what} reports the ${FIGURE[r.figure] ?? r.figure}, not one result: it is not ${f.label}.`);
    if (!r.reported || !NUMBER.test(r.reported.trim())) return no(`${what} has no reported figure in LIMS.`);
    return { take: { [f.name]: r.reported.trim() } };
  }
  const vals = (r.individual ?? []).map((v) => String(v).trim());
  if (!vals.length) return no(`${what} has no individual values in LIMS: ${f.label} takes ${f.count} values.`);
  if (!vals.every((v) => NUMBER.test(v))) return no(`${what} has a value that is not a number in LIMS.`);
  if (f.figure && r.figure && r.figure !== f.figure) return no(`${what} reports the ${FIGURE[r.figure] ?? r.figure}, not the ${FIGURE[f.figure]}: it is not ${f.label}.`);
  const next = f.nextStage ? fields.find((x) => x.name === f.nextStage) : undefined;
  const prev = fields.find((x) => x.nextStage === f.name);
  const take: Record<string, string | string[]> = {};
  const m = vals.length;
  // The values LIMS's reported figure is of: all of the result's, or with the first stage's recorded ones.
  let all = vals;
  if (!prev) {
    if (m === f.count) take[f.name] = vals;
    else if (next?.count && m === f.count + next.count) { take[f.name] = vals.slice(0, f.count); take[next.name] = vals.slice(f.count); }
    else return no(`${what} has ${m} values in LIMS; ${f.label} takes exactly ${f.count}${next?.count ? ` (or ${f.count + next.count} with ${next.label.toLowerCase()})` : ''}. Values are never added or left out: ask QC to check the result in LIMS.`);
  } else {
    const p = prev.count ?? 0;
    const had = recorded[prev.name];
    const hadVals = Array.isArray(had) ? had.map((x) => String((x as { value?: unknown })?.value ?? x)) : null;
    if (m === f.count) {
      // A result of the next stage only: its figure is of both stages, so the first stage is recorded first.
      if (!hadVals) return no(`Pick ${prev.label.toLowerCase()} first: ${what} has only the ${m} values of the next stage.`);
      take[f.name] = vals;
      all = [...hadVals, ...vals];
    } else if (m === p + f.count) {
      const first = vals.slice(0, p);
      if (hadVals && (hadVals.length !== p || hadVals.some((v, i) => !NUMBER.test(v) || !new Dec(v).eq(first[i]!)))) {
        return no(`The first ${p} values of ${what} (${first.join(', ')}) are not the ${p} recorded for ${prev.label.toLowerCase()} (${hadVals.join(', ')}): ask QC to check the result in LIMS.`);
      }
      if (!hadVals) take[prev.name] = first;
      take[f.name] = vals.slice(p);
    } else return no(`${what} has ${m} values in LIMS; ${f.label} takes exactly ${f.count} (or ${p + f.count} with the first ${p} of ${prev.label.toLowerCase()}). Values are never added or left out: ask QC to check the result in LIMS.`);
  }
  // LIMS's reported figure of all its values must agree with the step's own, rounded as LIMS wrote it.
  if (f.figure && r.figure === f.figure && r.reported && NUMBER.test(r.reported.trim())) {
    const own = ownFigure(f.figure, all, coating);
    if ('error' in own) return no(`${what}: ${own.error}.`);
    const lims = r.reported.trim();
    const mine = roundHalfUp(own, writtenDecimals(lims));
    if (!mine.eq(lims)) return no(`LIMS reports the ${FIGURE[f.figure]} of ${what} as ${lims}; TrueBatch works it out from the same ${all.length} values as ${mine.toFixed(writtenDecimals(lims))}: ask QC to check the result in LIMS.`);
  }
  return { take };
}
