import { PACKING_LINE, type Block } from './format.js';

// Packing, TB-P3: line clearance before packing against a checklist, always checked by a second person (TB-08). The
// line's cleaning facts come from the Logbook while its link answers (server/pull.ts).
export const packClearance: Block = {
  id: 'pack-clearance', version: 1, name: 'Line clearance before packing', gmp: 'line-clearance', checker: true, packing: true,
  instruction: 'Clear the line before packing starts: nothing of the previous batch on, in or around it, the coder cleared, the reject bins empty and the line clean.',
  fields: [
    { name: 'line', label: 'Packing line', kind: 'machine', types: PACKING_LINE },
    { name: 'previous', label: 'Previous product and batch no.', kind: 'text', optional: true },
    { name: 'noPrevious', label: 'No tablets, packs or printed materials of the previous batch on, in or around the line', kind: 'yes-no' },
    { name: 'coderCleared', label: 'Coder and printing plates cleared of the previous batch data', kind: 'yes-no' },
    { name: 'rejectsEmpty', label: 'Reject bins, collection trays and the camera reject chute empty', kind: 'yes-no' },
    { name: 'clean', label: 'Line clean (status label)', kind: 'yes-no' },
    { name: 'cleanedOn', label: 'Cleaned on (date and time on the label)', kind: 'text' },
    { name: 'cleanedBy', label: 'Cleaned by (name on the label)', kind: 'text' },
  ],
  settings: [],
  calcs: [
    { name: 'clearance', label: 'Line clear', template: 'C4',
      args: { question: 'Line clear', answers: ['$noPrevious', '$coderCleared', '$rejectsEmpty', '$clean'], expected: ['yes'] } },
  ],
};
