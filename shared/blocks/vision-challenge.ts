import type { Block } from './format.js';

// Packing, TB-P5: the code reader or camera challenged at the start: a bad code must be rejected. Checked by a second
// person.
export const visionChallenge: Block = {
  id: 'vision-challenge', version: 1, name: 'Camera challenge', checker: true, packing: true,
  instruction: 'Run the challenge packs through the camera: a pack with a wrong code, one with no or an unreadable code, and a good pack.',
  fields: [
    { name: 'wrongRejected', label: 'The pack with a wrong code was rejected', kind: 'yes-no' },
    { name: 'missingRejected', label: 'The pack with no or an unreadable code was rejected', kind: 'yes-no' },
    { name: 'goodAccepted', label: 'The good pack was accepted', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'challenge', label: 'Camera rejects bad codes', template: 'C4', args: { question: 'Camera challenge', answers: ['$wrongRejected', '$missingRejected', '$goodAccepted'], expected: ['yes'] } },
  ],
};
