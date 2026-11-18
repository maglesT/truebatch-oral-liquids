/** The block library: each block is a description file; a new block (or a new version of one) is a new file here. */
import type { Block } from './format.js';
import { binderSolution } from './binder-solution.js';
import { blendUniformity } from './blend-uniformity.js';
import { charge } from './charge.js';
import { check } from './check.js';
import { coatingSuspension } from './coating-suspension.js';
import { densityFlow } from './density-flow.js';
import { dryConstant } from './dry-constant.js';
import { dryMix } from './dry-mix.js';
import { dry } from './dry.js';
import { granulate } from './granulate.js';
import { lineClearance } from './line-clearance.js';
import { mix } from './mix.js';
import { qaSample } from './qa-sample.js';
import { sieve } from './sieve.js';
import { sift } from './sift.js';
import { sprayCoat } from './spray-coat.js';
import { stageYield } from './stage-yield.js';
import { subBatchCombine } from './sub-batch-combine.js';
import { tabletReconciliation } from './tablet-reconciliation.js';
import { weigh } from './weigh.js';
import { bulkIssue } from './bulk-issue.js';
import { cartonCheck } from './carton-check.js';
import { codingCheck } from './coding-check.js';
import { destruction } from './destruction.js';
import { finishedGoods } from './finished-goods.js';
import { formingCheck } from './forming-check.js';
import { leakTest } from './leak-test.js';
import { lineSetup } from './line-setup.js';
import { onlineInspection } from './online-inspection.js';
import { packClearance } from './pack-clearance.js';
import { packClearanceAfter } from './pack-clearance-after.js';
import { packMaterialIssue } from './pack-material-issue.js';
import { printedReconciliation } from './printed-reconciliation.js';
import { serialReceived } from './serial-received.js';
import { serialReconciliation } from './serial-reconciliation.js';
import { serialSample } from './serial-sample.js';
import { visionChallenge } from './vision-challenge.js';

export type { Block, BlockField, BlockSetting } from './format.js';
// In the order of a process: dispensing and preparation, (dry syrup) granulation, blending and coating of granules,
// then the steps of any stage. tablet-reconciliation, bulk-issue and finished-goods stay until their liquid
// replacements (bulk-yield, liquid-bulk-issue, liquid-finished-goods) are in.
export const BLOCKS: readonly Block[] = [
  weigh, charge, sift, binderSolution, coatingSuspension, dryMix, mix, granulate, dry, dryConstant, sieve,
  subBatchCombine, blendUniformity, densityFlow, sprayCoat, check, qaSample, stageYield, tabletReconciliation, lineClearance,
  // TrueBatch Liquids Packing, in the order of a packing record.
  bulkIssue, packMaterialIssue, packClearance, lineSetup, visionChallenge, serialReceived, codingCheck, formingCheck, leakTest, onlineInspection,
  cartonCheck, serialSample, finishedGoods, printedReconciliation, serialReconciliation, destruction, packClearanceAfter,
];
// The blocks either product's masters may use besides its own.
export const GENERAL_BLOCKS = ['check', 'qa-sample'];
/** The blocks a master offers: a packing master's (it has a pack) or a tablet master's. */
export const blocksFor = (packing: boolean) => BLOCKS.filter((b) => GENERAL_BLOCKS.includes(b.id) || !!b.packing === packing);

export function findBlock(ref: { id: string; version: number }): Block | undefined {
  return BLOCKS.find((b) => b.id === ref.id && b.version === ref.version);
}
