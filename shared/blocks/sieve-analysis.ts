import type { Block } from './format.js';

// Particle size by sieve analysis (T22) on a nest of 5 sieves and the pan: % retained, % passing and the recovery of
// the sample; % fines below a named sieve when the master sets it.
const sieves = [1, 2, 3, 4, 5];
export const sieveAnalysis: Block = {
  id: 'sieve-analysis', version: 1, name: 'Particle size by sieve analysis', checker: false,
  instruction: 'Put the weighed sample on the top sieve of the nest, shake for the time of the method and weigh what is retained on each sieve and in the pan.',
  fields: [
    { name: 'machine', label: 'Sieve shaker', kind: 'machine', types: ['sieve'] },
    { name: 'sample', label: 'Sample weight', kind: 'number', unit: 'g' },
    ...sieves.map((n) => ({ name: `retained${n}`, label: `Retained on sieve ${n}`, kind: 'number' as const, unit: 'g' })),
    { name: 'pan', label: 'In the pan', kind: 'number', unit: 'g' },
  ],
  settings: [
    ...sieves.map((n) => ({ name: `sieve${n}`, label: `Sieve ${n} aperture${n === 1 ? ' (coarsest)' : ''}`, kind: 'quantity' as const })),
    { name: 'finesBelow', label: 'Fines: what passes this aperture', kind: 'quantity', optional: true },
    { name: 'finesLimit', label: 'Fines limits', kind: 'limit', optional: true },
    { name: 'recoveryLimit', label: 'Recovery limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'sizes', label: 'Sieve analysis', template: 'T22', args: { sample: '$sample', sieves: sieves.map((n) => ({ aperture: `$sieve${n}`, retained: `$retained${n}` })), pan: '$pan',
      finesBelow: '$finesBelow?', finesLimit: '$finesLimit?', recoveryLimit: '$recoveryLimit?' } },
  ],
};
