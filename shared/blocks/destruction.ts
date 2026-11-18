import type { Block } from './format.js';

// Packing, TB-P6: batch-coded leftovers destroyed so they cannot be used, witnessed by a second person.
export const destruction: Block = {
  id: 'destruction', version: 1, name: 'Destruction of batch-coded leftovers', checker: true, packing: true,
  instruction: 'Destroy every batch-coded leftover (printed materials and rejected packs) as reconciled, with a second person watching.',
  fields: [
    { name: 'what', label: 'What was destroyed (materials and quantities)', kind: 'text' },
    { name: 'method', label: 'How', kind: 'choice', options: ['shredded', 'incinerated', 'defaced and sent for disposal'] },
    { name: 'destroyed', label: 'All batch-coded leftovers destroyed so they cannot be used', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'destroyedCheck', label: 'Leftovers destroyed', template: 'C4', args: { question: 'Batch-coded leftovers destroyed', answers: ['$destroyed'], expected: ['yes'] } },
  ],
};
