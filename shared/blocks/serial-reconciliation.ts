import type { Block } from './format.js';

// Packing, serialisation check: received = printed on good packs + rejected + destroyed + unused returned (T4). Any
// gap is out of limits: a deviation note first, and release waits for its deviation number (TB-18 mechanism).
export const serialReconciliation: Block = {
  id: 'serial-reconciliation', version: 1, name: 'Reconciliation of serial numbers', gmp: 'yield', checker: true, packing: true,
  instruction: 'Read the counts from the serialisation system at the end of packing.',
  fields: [
    { name: 'printedOk', label: 'Printed on good packs', kind: 'number', unit: 'nos' },
    { name: 'rejected', label: 'Rejected (camera or inspection)', kind: 'number', unit: 'nos' },
    { name: 'destroyed', label: 'Destroyed (printed on packs destroyed)', kind: 'number', unit: 'nos' },
    { name: 'unused', label: 'Unused, returned to the serialisation system', kind: 'number', unit: 'nos' },
  ],
  settings: [{ name: 'received', label: 'Serial numbers received', kind: 'quantity' }],
  calcs: [
    { name: 'reconciliation', label: 'Serial numbers accounted for', template: 'T4', args: { input: '$received',
      parts: [{ name: 'printed OK', value: '$printedOk' }, { name: 'rejected', value: '$rejected' }, { name: 'destroyed', value: '$destroyed' }, { name: 'unused', value: '$unused' }],
      unaccountedLimit: { low: '0', high: '0', unit: 'nos' } } },
  ],
};
