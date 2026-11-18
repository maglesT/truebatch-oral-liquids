/** The calculation and check templates a block may name, by template ID. The engine only calls them. */
import * as T from '../templates/index.js';

export type Template = (input: never) => T.Outcome<object>;

export const TEMPLATES: Record<string, Template> = {
  T1: T.t1Difference, T2: T.t2Total, T3: T.t3PercentOfTarget, T4: T.t4Accountability, T5: T.t5PercentChange,
  T6: T.t6Ratio, T7: T.t7Statistics, T8: T.t8BatchScaling, T9: T.t9PotencyAdjusted, T10: T.t10Compensating,
  T11: T.t11SaltFactor, T12: T.t12DryBasis, T13: T.t13Duration, T14: T.t14ContentUniformity, T15: T.t15Rescale,
  T16: T.t16Overage, T17: T.t17LiquidMakeUp, T18: T.t18ContentAdjusted, T19: T.t19Split, T20: T.t20MultiLot,
  T21: T.t21LesserGreater, T22: T.t22SieveAnalysis, T23: T.t23CompactStrength, T24: T.t24SpecificEnergy,
  T25: T.t25AbsoluteHumidity, T26: T.t26MixToTarget,
  // Variants with their own result shape (formulation test, waves 3 and 5).
  'T14-stratified': T.t14Stratified, 'T22-mix': T.t22MixPsd,
  C1: T.c1WithinLimits, C2: T.c2Count, C3: T.c3AllIndividual, C4: T.c4Observation, C5: T.c5SameBasis,
  C6: T.c6StagedTest, C7: T.c7SamplingPlan,
  // Packing: expiry from the shelf life, printed data against the batch data, serialisation codes of sample packs.
  T27: T.t27Expiry, C8: T.c8PrintedData, C9: T.c9SerialCodes,
  // F2 "no further change": this round's reading against the previous round's ("$prev.name").
  F2: (i: { previous: T.Q; current: T.Q; limit: Parameters<typeof T.noFurtherChange>[2] }) => T.noFurtherChange(i.previous, i.current, i.limit),
};

/** Calls a template with arguments already resolved; a bug-level throw becomes a refusal so a batch never crashes. */
export function callTemplate(id: string, args: unknown): T.Outcome<object> {
  const t = TEMPLATES[id];
  if (!t) return { ok: false, message: `Unknown template ${id}` };
  try {
    return (t as (i: unknown) => T.Outcome<object>)(args);
  } catch (e) {
    return { ok: false, message: `Template ${id} could not use these inputs (${(e as Error).message})` };
  }
}
