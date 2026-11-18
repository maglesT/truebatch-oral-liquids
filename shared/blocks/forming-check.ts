import type { Block } from './format.js';

// Packing, TB-P3: blister or strip forming and sealing (C1 against the master's limits), and the pockets and seal
// inspected, alongside the line.
export const formingCheck: Block = {
  id: 'forming-check', version: 1, name: 'Blister or strip forming and sealing', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 60, alongside: true },
  instruction: 'Read the sealing (and forming) temperature on the machine and inspect a strip or blister from each track.',
  fields: [
    { name: 'sealTemp', label: 'Sealing temperature', kind: 'number', unit: '°C' },
    { name: 'formTemp', label: 'Forming temperature', kind: 'number', unit: '°C', optional: true },
    { name: 'pockets', label: 'Pockets fully formed, one whole tablet in each', kind: 'yes-no' },
    { name: 'seal', label: 'Seal even, no wrinkles, channels or pin-holes; knurling and perforation clear', kind: 'yes-no' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [
    { name: 'sealLimit', label: 'Sealing temperature limits', kind: 'limit' },
    { name: 'formLimit', label: 'Forming temperature limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'sealCheck', label: 'Sealing temperature', template: 'C1', args: { value: '$sealTemp', limit: '$sealLimit' } },
    { name: 'formCheck', label: 'Forming temperature', template: 'C1', args: { value: '$formTemp', limit: '$formLimit' } },
    { name: 'packsCheck', label: 'Pockets and seal', template: 'C4', args: { question: 'Pockets and seal as they should be', answers: ['$pockets', '$seal'], expected: ['yes'] } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
