import type { Block } from './format.js';

// Packing, TB-P2 and TB-P6: the finished goods quantity, and the reconciliation of the bulk tablets issued: the tablets
// in good packs and in samples (packs × tablets per pack, T8), the good tablets returned and the rejected tablets
// counted by weight (T6), the yield in packs (T3) and the accountability of every tablet issued (T4). Always checked.
export const finishedGoods: Block = {
  id: 'finished-goods', version: 1, name: 'Finished goods and reconciliation of tablets', gmp: 'yield', checker: true, packing: true,
  instruction: 'Count the good packs in finished cartons and the packs taken as samples. Weigh the good bulk tablets returned and the tablets taken out of rejected packs.',
  fields: [
    { name: 'packs', label: 'Good packs in finished cartons', kind: 'number', unit: 'packs' },
    { name: 'cartons', label: 'Finished cartons', kind: 'number', unit: 'nos' },
    { name: 'shippers', label: 'Shippers', kind: 'number', unit: 'nos', optional: true },
    { name: 'samples', label: 'Packs taken as reserve and QC samples', kind: 'number', unit: 'packs' },
    { name: 'returnedWeight', label: 'Net weight of good bulk tablets returned', kind: 'number', unit: 'kg' },
    { name: 'rejectWeight', label: 'Net weight of rejected tablets', kind: 'number', unit: 'kg' },
  ],
  settings: [
    { name: 'meanWeight', label: 'Mean tablet weight', kind: 'quantity' },
    { name: 'yieldLimit', label: 'Yield limits (packs)', kind: 'limit' },
    { name: 'accountabilityLimit', label: 'Accountability limits (tablets)', kind: 'limit' },
  ],
  calcs: [
    { name: 'packed', label: 'Tablets in good packs', template: 'T8', args: { mode: 'per unit', perUnit: '$pack.unitsPerPack', count: '$packs' } },
    { name: 'sampled', label: 'Tablets in samples', template: 'T8', args: { mode: 'per unit', perUnit: '$pack.unitsPerPack', count: '$samples' } },
    { name: 'returned', label: 'Good tablets returned', template: 'T6', args: { mode: 'ratio', a: '$returnedWeight', b: '$meanWeight', unit: 'tablets', decimals: 0 } },
    { name: 'rejects', label: 'Rejected tablets', template: 'T6', args: { mode: 'ratio', a: '$rejectWeight', b: '$meanWeight', unit: 'tablets', decimals: 0 } },
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$packs', theoretical: '$batch.packs', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability of the tablets issued', template: 'T4', args: { input: '$batch.tablets',
      parts: [{ name: 'in packs', value: '$packed' }, { name: 'samples', value: '$sampled' }, { name: 'returned', value: '$returned' }, { name: 'rejects', value: '$rejects' }],
      limit: '$accountabilityLimit' } },
  ],
};
