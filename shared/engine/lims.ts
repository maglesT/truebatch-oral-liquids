/**
 * Medhanta LIMS (readers round 2): QC's certificate of analysis (CoA) and its results, read live from LIMS's published
 * views coa_v1 and result_v1. Where a step asks for a QC result, or QC approves the batch or a lot with its report
 * number, the CoA or result is PICKED from LIMS while the link answers: the pick fills the answer and keeps the LIMS
 * reference (the CoA number). Absent or down, it is typed by hand as before. Fixed rules, checked once here:
 * - only an APPROVED CoA counts (a rejected one, or one LIMS later rejected, is never pickable);
 * - it is of this batch (a product sample, the batch number) or of this lot (a material sample, the lot number and the
 *   line's material); a CoA of another batch, lot, product or material is refused;
 * - a batch's CoA is of a release sample (not stability or an investigation); a lot's of a release or retest sample;
 * - a result gives LIMS's `reported` figure (rounded as its limit is written), in the unit the step asks for (pH: none).
 */

/** A row of LIMS coa_v1, as read. `rejected`: LIMS has a rejection of the same sample too. */
export interface Coa {
  coaId: string; coaNumber: string | null; sampleNumber: string; lotNumber: string | null; itemKind: string | null;
  itemMasterId: string | null; itemCode: string | null; itemName: string | null; purpose: string | null; decision: string;
  decidedAt: string | null; decidedBy: string | null; specNumber: string | null; specVersion: number | null; rejected?: boolean;
}
/** A row of LIMS result_v1 of an approved CoA, as read; `reported` is the figure as reported (null before LIMS kept it). */
export interface QcResult {
  resultId: string; coaId: string; coaNumber: string | null; testName: string | null; reported: string | null; unit: string | null;
  limitText: string | null; analysisNumber: string | null; outsideLab: string | null;
}
/** What the CoA must be of: this batch (its product), or this lot of the step's material. */
export type CoaFor =
  | { kind: 'PRODUCT'; batchNo: string; productCode: string }
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
  if (!PURPOSES[want.kind].includes(c.purpose ?? '')) return `CoA ${no} is of a ${c.purpose ?? 'other'} sample: only the ${PURPOSES[want.kind].join(' or ')} CoA of ${what} may be used.`;
  return null;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
/** Why this result may not fill a field in `unit`; null when it may (its CoA is checked by coaRefusal). */
export function resultRefusal(r: QcResult, unit: string): string | null {
  const what = `${r.testName ?? 'The result'} of CoA ${r.coaNumber ?? '—'}`;
  if (!r.reported || !NUMBER.test(r.reported.trim())) return `${what} has no reported figure in LIMS.`;
  // pH has no unit in LIMS: a pH field takes a result kept without one.
  if ((r.unit ?? '') !== unit && !(unit === 'pH' && !r.unit)) return `${what} is in ${r.unit || 'no unit'}, not in ${unit}.`;
  return null;
}

/** The CoA as the step, the review and the PDF show it (kept with the record as the source's `shown`). */
export const coaText = (c: Coa) => `LIMS CoA ${c.coaNumber}: sample ${c.sampleNumber}${c.itemCode ? `, ${c.itemCode}` : ''}${c.lotNumber ? ` ${c.lotNumber}` : ''}, approved${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.specNumber ? `, specification ${c.specNumber}${c.specVersion ? ` v${c.specVersion}` : ''}` : ''}`;
export const resultText = (r: QcResult) => `LIMS CoA ${r.coaNumber}: ${r.testName ?? 'result'} ${r.reported}${r.unit ? ` ${r.unit}` : ''} as reported${r.limitText ? ` (limit ${r.limitText})` : ''}${r.analysisNumber ? `, analysis ${r.analysisNumber}` : ''}${r.outsideLab ? `, outside lab ${r.outsideLab}` : ''}`;
/** The answer that picks a LIMS result for a field (the step screen sends it in place of a typed number). */
export const isPick = (x: unknown): x is { lims: string } => !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { lims?: unknown }).lims === 'string';
