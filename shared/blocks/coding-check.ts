import type { Block } from './format.js';

// Packing, TB-P5, TB-P8 and TB-P9: the printed batch number, dates and MRP as read from the pack, against the batch data
// (C8): the bulk batch number and its date of manufacture, the expiry worked out from the approved shelf life and the
// master's MRP. At the start, then every N minutes alongside the line, and at the end.
export const codingCheck: Block = {
  id: 'coding-check', version: 1, name: 'Coding check', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 60, alongside: true },
  instruction: 'Take a pack from the line and type the batch number, dates and MRP exactly as printed.',
  fields: [
    { name: 'printedBatch', label: 'Batch no. as printed', kind: 'text' },
    { name: 'printedMfg', label: 'Date of manufacture as printed', kind: 'text' },
    { name: 'printedExpiry', label: 'Expiry date as printed', kind: 'text' },
    { name: 'printedMrp', label: 'MRP as printed (type none when the pack has no MRP)', kind: 'text' },
    { name: 'legible', label: 'Print legible, complete and in the right place', kind: 'yes-no' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'batchCheck', label: 'Batch no.', template: 'C8', args: { what: 'Batch no.', kind: 'text', printed: '$printedBatch', expected: '$batch.bulk' } },
    { name: 'mfgCheck', label: 'Date of manufacture', template: 'C8', args: { what: 'Date of manufacture', kind: 'month', printed: '$printedMfg', expected: '$batch.mfgDate' } },
    { name: 'expiryCheck', label: 'Expiry date', template: 'C8',
      args: { what: 'Expiry', kind: 'expiry', printed: '$printedExpiry', manufactured: '$batch.mfgDate', months: '$pack.shelfLifeMonths', rule: '$pack.expiryRule' } },
    { name: 'mrpCheck', label: 'MRP', template: 'C8', args: { what: 'MRP', kind: 'money', printed: '$printedMrp', expected: '$pack.mrp?' } },
    { name: 'legibleCheck', label: 'Print legible', template: 'C4', args: { question: 'Print legible, complete and in place', answers: ['$legible'], expected: ['yes'] } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
