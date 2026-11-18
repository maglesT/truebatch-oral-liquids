import type { Block } from './format.js';

// Weigh one formula material: gross − tare = net (T1), net within ± tolerance of the target (C1). The target is the
// formula line's batch quantity, adjusted as the line says (T11, T9 or T18, T16, T10) with the lot's certificate values.
export const weigh: Block = {
  id: 'weigh', version: 1, name: 'Weigh a material', gmp: 'weighing', checker: true,
  instruction: 'Weigh the material for the lot shown. Record the gross and tare weights.',
  fields: [
    { name: 'lot', label: 'Lot', kind: 'lot' },
    { name: 'balance', label: 'Balance', kind: 'machine', types: ['balance'], notTypes: ['analytical', 'micro'] },
    { name: 'assay', label: 'Assay (certificate)', kind: 'number', unit: '%', optional: true },
    { name: 'water', label: 'Water content (certificate)', kind: 'number', unit: '%', optional: true },
    { name: 'lod', label: 'Loss on drying (certificate)', kind: 'number', unit: '%', optional: true },
    { name: 'content', label: 'Content (certificate)', kind: 'number', unit: '%', optional: true },
    { name: 'gross', label: 'Gross weight', kind: 'number', unit: 'kg' },
    { name: 'tare', label: 'Tare weight', kind: 'number', unit: 'kg' },
  ],
  settings: [
    { name: 'target', label: 'Target quantity', kind: 'quantity' },
    { name: 'tolerance', label: 'Tolerance (± %)', kind: 'number' },
  ],
  calcs: [
    { name: 'net', label: 'Net weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Net against target', template: 'C1', args: { value: '$net', around: { centre: '$target', name: 'target', plusMinusPercent: '$tolerance' } } },
  ],
};
