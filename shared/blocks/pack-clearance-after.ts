import { PACKING_LINE, type Block } from './format.js';

// Packing, TB-P3 and TB-P6: line clearance after packing, checked by a second person (TB-08).
export const packClearanceAfter: Block = {
  id: 'pack-clearance-after', version: 1, name: 'Line clearance after packing', gmp: 'line-clearance', checker: true, packing: true,
  instruction: 'Clear the line after packing: nothing of this batch left on, in or around it, and the coder cleared of its data.',
  fields: [
    { name: 'line', label: 'Packing line', kind: 'machine', types: PACKING_LINE },
    { name: 'noLeftover', label: 'No tablets, packs or printed materials of this batch left on, in or around the line', kind: 'yes-no' },
    { name: 'coderCleared', label: 'Coder cleared of this batch data', kind: 'yes-no' },
    { name: 'leftoversDone', label: 'Batch-coded leftovers destroyed and uncoded ones returned, as reconciled', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'clearance', label: 'Line clear', template: 'C4', args: { question: 'Line clear after packing', answers: ['$noLeftover', '$coderCleared', '$leftoversDone'], expected: ['yes'] } },
  ],
};
