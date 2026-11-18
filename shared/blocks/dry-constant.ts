import type { Block } from './format.js';

// Dry to constant weight: used as repeat-until, a new round of drying until the sample weight has not changed by more
// than the largest change since the previous round (F2 "no further change").
export const dryConstant: Block = {
  id: 'dry-constant', version: 1, name: 'Dry to constant weight', checker: false, stop: 'constant',
  instruction: 'Dry, cool and weigh the sample, and record its weight.',
  fields: [
    { name: 'machine', label: 'Dryer or oven', kind: 'machine', types: ['dryer', 'drier', 'fbd', 'fluid bed', 'oven'] },
    { name: 'weight', label: 'Sample weight', kind: 'number', unit: 'g' },
  ],
  settings: [{ name: 'maxChange', label: 'Largest change between rounds', kind: 'quantity' }],
  calcs: [{ name: 'constant', label: 'No further change', template: 'F2', args: { previous: '$prev.weight', current: '$weight', limit: { maxChange: '$maxChange' } } }],
};
