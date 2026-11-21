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
 * Round 45 (agreed with LIMS: its in-process specification is per PRODUCT): each test of a lab request has a code unique
 * within the master, '<block id>.<field name>' (content uniformity, one test in two stages: 'content-uniformity'),
 * with '@<n>' when the block is in the master more than once (n: its occurrence in order). A result that names the code
 * it answers (result_v1.ipc_code) fills only the field of that code (ipcCodes, answersField); one that names none falls
 * back to the round 44 rule (ipc_field, else the unit).
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
  /** Round 45: the code of the lab request's test the result answers (lab_request_v1 tests[].code); null from a LIMS
   * without the column: then the round 44 rule (ipcField, else the unit). */
  ipcCode?: string | null;
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
 * stage, whichever of the two it names. Round 45: a result that names the code of the test it answers (ipcCode) fills
 * only the field of that code in this step (`codes`: ipcCodes; both stages of a staged list have its one code).
 */
export function answersField(r: Pick<QcResult, 'ipcField' | 'individual' | 'ipcCode'>, f: BlockField, fields: readonly BlockField[], codes: Readonly<Record<string, string>> = {}): boolean {
  if (r.ipcCode) return codes[f.name] === r.ipcCode;
  if (!r.ipcField || r.ipcField === f.name) return true;
  const other = fields.find((x) => x.name === r.ipcField);
  // A3: a staged list of any number of stages: both in one chain, the result holding the values from its first stage on.
  const ip = fields.filter((x) => x.qc === 'in_process');
  const root = ip.find((x) => !ip.some((y) => y.nextStage === x.name) && stagesOf(x, ip).includes(f) && (!other || stagesOf(x, ip).includes(other)));
  const chain = root ? stagesOf(root, ip) : [];
  if (!other || chain.length < 2 || f.count === undefined || other.count === undefined) return false;
  const sums = chain.map((_, j) => chain.slice(0, j + 1).reduce((a, x) => a + (x.count ?? 0), 0));
  return sums.slice(1).includes(r.individual?.length ?? -1);
}
/** Why this result may not fill field `f` (it answers another field), in plain words; null when it may. */
export function fieldRefusal(r: Pick<QcResult, 'ipcField' | 'individual' | 'testName' | 'coaNumber' | 'ipcCode'>, f: BlockField, fields: readonly BlockField[], codes: Readonly<Record<string, string>> = {}): string | null {
  if (answersField(r, f, fields, codes)) return null;
  const label = r.ipcCode ? fields.find((x) => codes[x.name] === r.ipcCode)?.label ?? `in-process test ${r.ipcCode}` : fields.find((x) => x.name === r.ipcField)?.label ?? r.ipcField;
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
/**
 * A test of a lab request, as lab_request_v1.tests lists it. individual: the number of values (a list), else null.
 * Round 45: `code`, unique within the master (ipcCodes), what LIMS's in-process specification maps and its result names
 * (ipc_code); a staged list (content uniformity) is ONE test: individual is all its values (30), `stages` the values of
 * each stage ([10, 20]), `name` its first stage's field.
 */
export interface LabTest { code: string; name: string; label: string; unit: string; individual: number | null; stages?: number[] }
/** A staged list's fields from its first stage on (content uniformity: L1, then L2); a field alone otherwise. */
function stagesOf(f: BlockField, fields: readonly BlockField[]): BlockField[] {
  const out = [f];
  for (let x = f; x.nextStage;) {
    const next = fields.find((y) => y.name === x.nextStage);
    if (!next || out.includes(next)) break;
    out.push(next);
    x = next;
  }
  return out;
}
/** The steps of a master in order, as ipcCodes reads them (a master document). */
type MasterSteps = { stages: readonly { steps: readonly { block: { id: string } }[] }[] };
/**
 * Round 45: the code of each in-process field of a master's step (by field name), unique within the master so LIMS's
 * in-process specification (per product) maps each: '<block id>.<field name>'; a staged list, the block's only
 * in-process test, has the block id ('content-uniformity') for all its stages; '@<n>' is added when the block is in the
 * master more than once (n: its occurrence, stages in order and their steps in order: 'blend-uniformity.results@2').
 * A sub-batch or a round of the step has the same code (its request id tells them apart).
 */
export function ipcCodes(doc: MasterSteps, stage: number, step: number, fields: readonly BlockField[]): Record<string, string> {
  const id = doc.stages[stage]?.steps[step]?.block.id;
  if (!id) return {};
  const same = doc.stages.flatMap((s, si) => s.steps.map((t, ti) => ({ id: t.block.id, si, ti }))).filter((x) => x.id === id);
  const at = same.length > 1 ? `@${same.findIndex((x) => x.si === stage && x.ti === step) + 1}` : '';
  const ip = fields.filter((f) => f.qc === 'in_process');
  const out: Record<string, string> = {};
  for (const f of ip.filter((x) => !ip.some((y) => y.nextStage === x.name))) {
    const chain = stagesOf(f, ip);
    const code = `${chain.length > 1 && chain.length === ip.length ? id : `${id}.${f.name}`}${at}`;
    for (const x of chain) out[x.name] = code;
  }
  return out;
}
/**
 * The in-process QC fields of a step, as the tests of its lab request (`unitOf`: the field's unit in this step; `codes`:
 * ipcCodes of the step). Round 43: a field whose unit is not set is not asked for (Tablets' in-process fields have a
 * fixed unit, %, so none is left out today; the rule is the same in every edition). Round 45: a staged list is one test.
 */
export function labTests(fields: readonly BlockField[], unitOf: (f: BlockField) => string, codes: Readonly<Record<string, string>>): LabTest[] {
  const ip = fields.filter((f) => f.qc === 'in_process');
  return ip.filter((f) => unitOf(f) && !ip.some((x) => x.nextStage === f.name)).map((f) => {
    const chain = stagesOf(f, ip);
    const test = { code: codes[f.name] ?? f.name, name: f.name, unit: unitOf(f) };
    if (chain.length === 1) return { ...test, label: f.label, individual: f.count ?? null };
    const stages = chain.map((x) => x.count ?? 0);
    return { ...test, label: chain.map((x, i) => (i ? x.label.charAt(0).toLowerCase() + x.label.slice(1) : x.label)).join(', then '),
      individual: stages.reduce((a, n) => a + n, 0), stages };
  });
}

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
 * first stage's); `coating`: the step's coating (the acceptance value); `codes`: the step's ipcCodes (round 45). Its CoA
 * and request are checked by coaRefusal.
 */
export function inProcessFit(r: Pick<QcResult, 'testName' | 'coaNumber' | 'unit' | 'reported' | 'individual' | 'figure' | 'ipcField' | 'ipcCode'>, f: BlockField, unit: string, fields: readonly BlockField[], recorded: Record<string, unknown> = {}, coating?: string,
  codes: Readonly<Record<string, string>> = {}):
  { error: string } | { take: Record<string, string | string[]> } {
  const what = `${r.testName ?? 'The result'} of in-process report ${r.coaNumber ?? '—'}`;
  const no = (error: string) => ({ error });
  // Round 44: a result that names the field it answers fills only that field (round 45: the code of its test).
  const other = fieldRefusal(r, f, fields, codes);
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
  // Fix round 21 Nov 2026 (A3): a staged list of any number of stages (dissolution: 6, 6 more, 12 more). The stages
  // from the first; this field is stage i. A result holds the values from the first stage to stage j (all in order), or
  // only those of stages i to j once the earlier stages are recorded; never padded or cut.
  const ip = fields.filter((x) => x.qc === 'in_process');
  let root = f;
  for (let x = ip.find((y) => y.nextStage === root.name); x && x !== f; x = ip.find((y) => y.nextStage === root.name)) root = x;
  const chain = stagesOf(root, ip);
  const i = chain.indexOf(f);
  const counts = chain.map((x) => x.count ?? 0);
  const before = (k: number) => counts.slice(0, k).reduce((a, n) => a + n, 0);
  const take: Record<string, string | string[]> = {};
  const m = vals.length;
  const had = chain.slice(0, i).map((x) => { const v = recorded[x.name]; return Array.isArray(v) ? v.map((y) => String((y as { value?: unknown })?.value ?? y)) : null; });
  const lower = (x: BlockField) => x.label.toLowerCase();
  const split = (from: number, to: number, list: readonly string[]) => { let at = 0; for (let k = from; k <= to; k++) { take[chain[k]!.name] = list.slice(at, at + counts[k]!); at += counts[k]!; } };
  // The values LIMS's reported figure is of: all of the result's, or with the earlier stages' recorded ones.
  let all = vals;
  const cumulative = chain.map((_, j) => j).filter((j) => j >= i && m === before(j + 1)).at(0);
  const own = i > 0 ? chain.map((_, j) => j).filter((j) => j >= i && m === before(j + 1) - before(i)).at(0) : undefined;
  if (cumulative !== undefined) {
    const p = before(i);
    const first = vals.slice(0, p);
    const hadAll = had.every((h) => h !== null) ? had.flat() as string[] : null;
    const prevLabel = chain.slice(0, i).map(lower).join(' and ');
    if (i > 0 && had.some((h) => h !== null) && (!hadAll || hadAll.length !== p || hadAll.some((v, k) => !NUMBER.test(v) || !new Dec(v).eq(first[k]!)))) {
      return no(`The first ${p} values of ${what} (${first.join(', ')}) are not the ${p} recorded for ${prevLabel} (${(hadAll ?? had.flat().filter(Boolean)).join(', ')}): ask QC to check the result in LIMS.`);
    }
    if (i > 0 && !hadAll) split(0, i - 1, first);
    split(i, cumulative, vals.slice(p));
  } else if (own !== undefined) {
    // A result of the later stages only: its figure is of all stages, so the earlier stages are recorded first.
    const missing = chain.slice(0, i).find((_, k) => had[k] === null);
    if (missing) return no(`Pick ${lower(missing)} first: ${what} has only the ${m} values of the next stage.`);
    split(i, own, vals);
    all = [...(had.flat() as string[]), ...vals];
  } else if (i === 0) {
    const alt = chain.slice(1).map((_, j) => `${before(j + 2)} with ${chain.slice(1, j + 2).map(lower).join(' and ')}`);
    return no(`${what} has ${m} values in LIMS; ${f.label} takes exactly ${f.count}${alt.length ? ` (or ${alt.join(', or ')})` : ''}. Values are never added or left out: ask QC to check the result in LIMS.`);
  } else {
    return no(`${what} has ${m} values in LIMS; ${f.label} takes exactly ${f.count} (or ${before(i) + counts[i]!} with the first ${before(i)} of ${chain.slice(0, i).map(lower).join(' and ')}). Values are never added or left out: ask QC to check the result in LIMS.`);
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

/**
 * Fix round 21 Nov 2026 (A12, for LIMS: an in-process specification is written from the master, before any batch
 * raises a request): the in-process lab tests of every block, as a master step's lab request lists them (labTests):
 * the code without its '@<n>' (ipcCodes adds it when the block is in the master more than once), the label (or the text
 * setting the master names it with), the unit (fixed, or the setting that names it) and the number of values (a staged
 * list: all its stages). db/migrations/0029 keeps the same list as the view lab_field_parameters (not published) for
 * report.master_lab_field_v1; a test compares the two, so a new in-process field needs a migration replacing it.
 */
export interface LabFieldParameter { block: string; blockName: string; field: string; code: string; label: string; labelSetting: string | null; unit: string | null; unitSetting: string | null; individual: number | null }
export function labFieldParameters(blocks: readonly { id: string; name: string; fields: readonly BlockField[] }[]): LabFieldParameter[] {
  return blocks.flatMap((b) => {
    const codes = ipcCodes({ stages: [{ steps: [{ block: { id: b.id } }] }] }, 0, 0, b.fields);
    return labTests(b.fields, (f) => f.unit ?? '', codes).map((t) => {
      const f = b.fields.find((x) => x.name === t.name)!;
      const set = f.unit?.startsWith('$');
      return { block: b.id, blockName: b.name, field: t.name, code: t.code, label: t.label, labelSetting: f.labelFrom ?? null,
        unit: set ? null : t.unit, unitSetting: set ? f.unit!.slice(1) : null, individual: t.individual };
    });
  });
}
