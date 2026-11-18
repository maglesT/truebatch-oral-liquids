import type { Block } from './format.js';

// Sift dispensed materials through the sieve the master names; the sieve is checked intact before and after use
// (C4, TB-16), with the same names as the sieve block.
export const sift: Block = {
  id: 'sift', version: 1, name: 'Sift materials', checker: true,
  instruction: 'Check that the sieve is the one shown and is intact. Sift the materials, then check the sieve again.',
  fields: [
    { name: 'machine', label: 'Sifter', kind: 'machine', types: ['sift', 'sieve', 'screen'] },
    { name: 'sieveId', label: 'Sieve identification no.', kind: 'text' },
    { name: 'rightSieve', label: 'Sieve no. as shown', kind: 'yes-no' },
    { name: 'intactBefore', label: 'Sieve intact before use', kind: 'yes-no' },
    { name: 'intactAfter', label: 'Sieve intact after use', kind: 'yes-no' },
  ],
  settings: [{ name: 'sieve', label: 'Sieve no. (mesh and aperture)', kind: 'text' }],
  calcs: [
    { name: 'sieveCheck', label: 'Sieve no.', template: 'C4', args: { question: 'Sieve no. as shown', answers: ['$rightSieve'], expected: ['yes'] } },
    { name: 'integrity', label: 'Sieve integrity', template: 'C4', args: { question: 'Sieve intact before and after use', answers: ['$intactBefore', '$intactAfter'], expected: ['yes'] } },
  ],
};
