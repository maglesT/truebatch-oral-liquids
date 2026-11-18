import type { Block } from './format.js';

// Combine the sub-batches (up to 10): their weights in total (T2), and the combined weight accounted for against
// that total (T4).
const subs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const subBatchCombine: Block = {
  id: 'sub-batch-combine', version: 1, name: 'Combine the sub-batches', checker: true,
  instruction: 'Check the label of each sub-batch container and record its net weight. Load them all into the blender and record the combined weight.',
  fields: [
    { name: 'machine', label: 'Blender', kind: 'machine', types: ['blend', 'bin'] },
    ...subs.map((n) => ({ name: `sub${n}`, label: `Sub-batch ${n}`, kind: 'number' as const, unit: 'kg', ...(n > 2 ? { optional: true } : {}) })),
    { name: 'output', label: 'Combined weight', kind: 'number', unit: 'kg' },
  ],
  settings: [{ name: 'accountabilityLimit', label: 'Accountability limits', kind: 'limit' }],
  calcs: [
    { name: 'total', label: 'Total of the sub-batches', template: 'T2', args: { values: subs.map((n) => `$sub${n}${n > 2 ? '?' : ''}`), unit: 'kg' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$total', parts: [{ name: 'combined', value: '$output' }], limit: '$accountabilityLimit' } },
  ],
};
