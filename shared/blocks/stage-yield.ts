import type { Block } from './format.js';

// Stage yield (T3) and accountability (T4), always checked by a second person (TB-08). Accountability is worked out
// even without its limits; the limits only add the check.
export const stageYield: Block = {
  id: 'stage-yield', version: 1, name: 'Stage yield', gmp: 'yield', checker: true,
  instruction: 'Weigh the output, the samples taken and the rejects of this stage.',
  fields: [
    { name: 'output', label: 'Output', kind: 'number', unit: 'kg' },
    { name: 'samples', label: 'Samples', kind: 'number', unit: 'kg' },
    { name: 'rejects', label: 'Rejects', kind: 'number', unit: 'kg' },
  ],
  settings: [
    { name: 'theoretical', label: 'Theoretical quantity', kind: 'quantity' },
    { name: 'yieldLimit', label: 'Yield limits', kind: 'limit' },
    { name: 'accountabilityLimit', label: 'Accountability limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$output', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$theoretical', parts: [{ name: 'output', value: '$output' }, { name: 'samples', value: '$samples' }, { name: 'rejects', value: '$rejects' }], limit: '$accountabilityLimit?' } },
  ],
};
