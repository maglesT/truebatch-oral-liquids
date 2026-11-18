import type { Block } from './format.js';

// Friability: the loss on the starting weight (T5, loss mode) against its limit (C1), and no tablet broken (C4).
export const friability: Block = {
  id: 'friability', version: 1, name: 'Friability', checker: false,
  instruction: 'Dedust and weigh the tablets, run the friability tester for 100 turns, dedust and weigh them again. Check that no tablet is broken, cracked or split.',
  fields: [
    { name: 'machine', label: 'Friability tester', kind: 'machine', types: ['friab'] },
    { name: 'before', label: 'Weight before', kind: 'number', unit: 'g' },
    { name: 'after', label: 'Weight after', kind: 'number', unit: 'g' },
    { name: 'intact', label: 'No tablet broken, cracked or split', kind: 'yes-no' },
  ],
  settings: [{ name: 'lossLimit', label: 'Friability limit', kind: 'limit' }],
  calcs: [
    { name: 'loss', label: 'Friability', template: 'T5', args: { before: '$before', after: '$after', mode: 'loss', base: 'start' } },
    { name: 'lossCheck', label: 'Friability against the limit', template: 'C1', args: { value: '$loss', limit: '$lossLimit' } },
    { name: 'intactCheck', label: 'Tablets intact', template: 'C4', args: { question: 'No tablet broken, cracked or split', answers: ['$intact'], expected: ['yes'] } },
  ],
};
