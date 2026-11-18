import type { Block } from './format.js';

// Charge (add) a dispensed material into the machine: right lot, all of it charged (C4).
export const charge: Block = {
  id: 'charge', version: 1, name: 'Charge a material', gmp: 'charge-in', checker: true,
  instruction: 'Check the label of the dispensed material and charge all of it into the machine.',
  fields: [
    { name: 'lot', label: 'Lot charged', kind: 'lot' },
    { name: 'machine', label: 'Machine charged', kind: 'machine', types: ['mix', 'blend', 'granulat', 'rmg', 'vessel', 'stirrer', 'fluid bed'] },
    { name: 'allCharged', label: 'All of the dispensed material charged', kind: 'yes-no' },
  ],
  settings: [{ name: 'material', label: 'Material (formula line)', kind: 'material' }],
  calcs: [
    { name: 'charged', label: 'Charged completely', template: 'C4', args: { question: 'All of the dispensed material charged', answers: ['$allCharged'], expected: ['yes'] } },
  ],
};
