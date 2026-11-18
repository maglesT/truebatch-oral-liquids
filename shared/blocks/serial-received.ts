import type { Block } from './format.js';

// Packing, serialisation check (optional per product): the serial numbers the customer's serialisation system gave
// this batch. TrueBatch generates no serial numbers and keeps no register: it only checks.
export const serialReceived: Block = {
  id: 'serial-received', version: 1, name: 'Serial numbers received', checker: true, packing: true,
  instruction: 'Read from the serialisation system (or its file) how many serial numbers it gave this batch.',
  fields: [
    { name: 'received', label: 'Serial numbers received for the batch', kind: 'number', unit: 'nos' },
    { name: 'reference', label: 'Order or file reference in the serialisation system', kind: 'text' },
    { name: 'forBatch', label: 'The numbers were given for this batch number and the pack GTIN', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'forBatchCheck', label: 'Numbers for this batch', template: 'C4', args: { question: 'Numbers given for this batch and GTIN', answers: ['$forBatch'], expected: ['yes'] } },
  ],
};
