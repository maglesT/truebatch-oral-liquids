// Test-only blocks: the TrueBatch Tablets steps the engine's shared test master (engine-fixture.ts) is built from.
// They are not in the product (no liquids master can use them); the engine tests use them to exercise the same
// mechanisms as before: periodic rounds, repeat until, a later step reading an earlier result.
// A test file that uses them adds `vi.mock('../shared/blocks/index.js', withTestBlocks)` (as TrueBatch Injectables).
import type { Block } from '../shared/blocks/format.js';
// Compression with periodic in-process checks: one round every N minutes (at most 30, TB-15) until compression is
// finished. Each round: 20 tablet weights (T7 mean, C3 individual weights), hardness and thickness (T7).
export const compress: Block = {
  id: 'compress', version: 1, name: 'Compress with periodic checks', checker: false, stop: 'finished',
  periodic: { maxMinutes: 30 },
  instruction: 'Take 20 tablets and record their weights, then the hardness and thickness of 5 tablets.',
  fields: [
    { name: 'machine', label: 'Tablet press', kind: 'machine', types: ['press', 'compression'], notTypes: ['filter', 'compressor'] },
    { name: 'weights', label: 'Weights of 20 tablets', kind: 'number', unit: 'mg', count: 20 },
    { name: 'hardness', label: 'Hardness of 5 tablets', kind: 'number', unit: 'N', count: 5 },
    { name: 'thickness', label: 'Thickness of 5 tablets', kind: 'number', unit: 'mm', count: 5 },
    { name: 'compressionDone', label: 'Compression finished', kind: 'yes-no' },
  ],
  settings: [
    { name: 'meanLimit', label: 'Mean weight limits', kind: 'limit' },
    { name: 'weightBand', label: 'Individual weights (± % of the mean)', kind: 'number' },
    { name: 'weightOuterBand', label: 'No tablet outside (± % of the mean)', kind: 'number' },
    { name: 'hardnessLimit', label: 'Hardness limits', kind: 'limit' },
    { name: 'thicknessLimit', label: 'Thickness limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'meanWeight', label: 'Mean weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'individualWeights', label: 'Individual weights', template: 'C3', args: { readings: '$weights', band: { plusMinusPercent: '$weightBand', of: 'mean' }, allowedOutside: 2, outer: { plusMinusPercent: '$weightOuterBand', of: 'mean' }, noun: 'tablets', meanLimit: '$meanLimit' } },
    { name: 'meanHardness', label: 'Hardness', template: 'T7', args: { readings: '$hardness', limit: '$hardnessLimit' } },
    { name: 'meanThickness', label: 'Thickness', template: 'T7', args: { readings: '$thickness', limit: '$thicknessLimit' } },
    { name: 'finished', label: 'Compression finished', template: 'C4', args: { question: 'Compression finished', answers: ['$compressionDone'], expected: ['yes'] } },
  ],
};

// Coat to a weight gain: used as repeat-until, spraying continues in rounds until the gain on the core weight (T5)
// is within its limits.
export const coat: Block = {
  id: 'coat', version: 1, name: 'Coat to a weight gain', checker: false, stop: 'gain',
  instruction: 'Spray the coating, then weigh a sample of tablets and record the mean weight.',
  fields: [
    { name: 'machine', label: 'Coater', kind: 'machine', types: ['coat'] },
    { name: 'meanWeight', label: 'Mean weight of coated tablets', kind: 'number', unit: 'mg' },
  ],
  settings: [
    { name: 'coreWeight', label: 'Core weight', kind: 'quantity' },
    { name: 'gainLimit', label: 'Weight gain limits', kind: 'limit' },
  ],
  calcs: [{ name: 'gain', label: 'Weight gain', template: 'T5', args: { before: '$coreWeight', after: '$meanWeight', mode: 'gain', base: 'start', limit: '$gainLimit' } }],
};

export const TEST_BLOCKS: Block[] = [compress, coat];

/** The mock factory: the product's blocks plus the test blocks, found by the same findBlock. */
export async function withTestBlocks(original: () => Promise<typeof import('../shared/blocks/index.js')>) {
  const m = await original();
  const BLOCKS = [...m.BLOCKS, ...TEST_BLOCKS];
  return { ...m, BLOCKS, findBlock: (r: { id: string; version: number }) => BLOCKS.find((b) => b.id === r.id && b.version === r.version) };
}
