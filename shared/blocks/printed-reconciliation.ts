import type { Block } from './format.js';

// Packing, TB-P6: reconciliation of one printed packing material: issued = used + destroyed + returned (T4). Any gap
// is out of limits: a deviation note first, and release waits for its deviation number (TB-18 mechanism).
export const printedReconciliation: Block = {
  id: 'printed-reconciliation', version: 1, name: 'Reconciliation of a printed material', gmp: 'yield', checker: true, packing: true, title: 'Reconcile {material}',
  instruction: 'Count what was used in good packs, what was destroyed (batch-coded leftovers and rejects) and what goes back to stores uncoded.',
  fields: [
    { name: 'used', label: 'Used in good packs', kind: 'number', unit: '$unit' },
    { name: 'destroyed', label: 'Destroyed (batch-coded leftovers and rejects)', kind: 'number', unit: '$unit' },
    { name: 'returned', label: 'Returned to stores uncoded, after a documented check', kind: 'number', unit: '$unit' },
  ],
  settings: [
    { name: 'material', label: 'Printed material', kind: 'material' },
    { name: 'unit', label: 'Unit', kind: 'text' },
    { name: 'issued', label: 'Quantity issued', kind: 'quantity' },
  ],
  calcs: [
    { name: 'reconciliation', label: 'Printed material accounted for', template: 'T4', args: { input: '$issued',
      parts: [{ name: 'used', value: '$used' }, { name: 'destroyed', value: '$destroyed' }, { name: 'returned', value: '$returned' }],
      unaccountedLimit: { low: '0', high: '0', unit: '$unit' } } },
  ],
};
