import type { Block } from './format.js';

// Sieve or mill through a screen; the screen is checked intact before and after (C4).
export const sieve: Block = {
  id: 'sieve', version: 1, name: 'Sieve or mill', checker: true,
  instruction: 'Check the screen, sieve or mill the material, and check the screen again.',
  fields: [
    { name: 'machine', label: 'Sifter or mill', kind: 'machine', types: ['sift', 'sieve', 'mill', 'screen'] },
    { name: 'screen', label: 'Screen size', kind: 'text' },
    { name: 'intactBefore', label: 'Screen intact before use', kind: 'yes-no' },
    { name: 'intactAfter', label: 'Screen intact after use', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'integrity', label: 'Screen integrity', template: 'C4', args: { question: 'Screen intact before and after use', answers: ['$intactBefore', '$intactAfter'], expected: ['yes'] } },
  ],
};
