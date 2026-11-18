import type { Block } from './format.js';

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
