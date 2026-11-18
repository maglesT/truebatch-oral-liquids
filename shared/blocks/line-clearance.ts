import type { Block } from './format.js';

// TB-10: line clearance before each stage, by the performer and checked by a second person. The cleaning facts come
// from the Logbook while its link answers (server/pull.ts); without it they are typed from the room's status label.
export const lineClearance: Block = {
  id: 'line-clearance', version: 1, name: 'Line clearance', gmp: 'line-clearance', checker: true,
  instruction: 'Check the room and its equipment before the stage starts: nothing of the previous product or batch, clean, and no materials or documents of other products.',
  fields: [
    { name: 'room', label: 'Room', kind: 'room' },
    { name: 'previous', label: 'Previous product and batch no.', kind: 'text', optional: true },
    { name: 'previousRemoved', label: 'Previous product and batch removed', kind: 'yes-no' },
    { name: 'clean', label: 'Area and equipment clean (status label)', kind: 'yes-no' },
    { name: 'cleanedOn', label: 'Cleaned on (date and time on the label)', kind: 'text' },
    { name: 'cleanedBy', label: 'Cleaned by (name on the label)', kind: 'text' },
    { name: 'noOther', label: 'No materials or documents of other products', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'clearance', label: 'Line clear', template: 'C4',
      args: { question: 'Line clear', answers: ['$previousRemoved', '$clean', '$noOther'], expected: ['yes'] } },
  ],
};
