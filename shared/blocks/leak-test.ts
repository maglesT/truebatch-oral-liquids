import type { Block } from './format.js';

// Packing, TB-P3: vacuum leak test of strips or blisters alongside the line. The sample comes from the AQL plan for
// the batch's theoretical packs (C7); a pack that leaks is a defect.
export const leakTest: Block = {
  id: 'leak-test', version: 1, name: 'Leak test', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 120, alongside: true },
  instruction: 'Put the sample in the leak tester at the set vacuum for the set time. Count the packs that leak (coloured water in a pocket).',
  fields: [
    { name: 'vacuum', label: 'Vacuum', kind: 'number', unit: '$vacuumUnit' },
    { name: 'tested', label: 'Packs tested', kind: 'number', unit: 'packs' },
    { name: 'leaking', label: 'Packs that leak', kind: 'number', unit: 'packs' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [
    { name: 'vacuumUnit', label: 'Vacuum unit', kind: 'text' },
    { name: 'vacuumLimit', label: 'Vacuum limits', kind: 'limit' },
    { name: 'level', label: 'Inspection level', kind: 'text', options: ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'] },
    { name: 'aql', label: 'AQL for a pack that leaks', kind: 'text', options: ['0', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0'] },
  ],
  calcs: [
    { name: 'vacuumCheck', label: 'Vacuum', template: 'C1', args: { value: '$vacuum', limit: '$vacuumLimit' } },
    { name: 'plan', label: 'Leak test (AQL)', template: 'C7', args: { lotSize: '$batch.packs', level: '$level', classes: { leaking: '$aql' }, found: { leaking: '$leaking' } } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
