import type { Block } from './format.js';

// Packing, TB-P4: issue of one packing material of the master to the batch: a released lot of that material (MMS, or
// the lot label with a second person), the quantity issued and its label. Always checked by a second person.
export const packMaterialIssue: Block = {
  id: 'pack-material-issue', version: 1, name: 'Issue a packing material', gmp: 'weighing', checker: true, packing: true, title: 'Issue {material}',
  instruction: 'Issue the packing material shown from a released lot. Count or weigh the quantity issued.',
  fields: [
    { name: 'lot', label: 'Lot', kind: 'lot' },
    { name: 'issued', label: 'Quantity issued', kind: 'number', unit: '$unit' },
    { name: 'matches', label: 'Material code and artwork version on the label are those of the packing master', kind: 'yes-no' },
  ],
  settings: [
    { name: 'material', label: 'Packing material', kind: 'material' },
    { name: 'unit', label: 'Unit', kind: 'text' },
  ],
  calcs: [
    { name: 'matchesCheck', label: 'Material as in the packing master', template: 'C4', args: { question: 'Material and artwork as in the packing master', answers: ['$matches'], expected: ['yes'] } },
  ],
};
