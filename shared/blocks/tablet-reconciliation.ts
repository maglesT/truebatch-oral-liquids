import type { Block } from './format.js';

// Reconciliation of tablets: the good and rejected tablets counted by weight (T6, ÷ the mean tablet weight), the
// yield in tablets (T3) and the accountability of every tablet (T4). A yield step: always checked (TB-08).
export const tabletReconciliation: Block = {
  id: 'tablet-reconciliation', version: 1, name: 'Reconciliation of tablets', gmp: 'yield', checker: true,
  instruction: 'Weigh the good tablets and the rejected tablets. Count the tablets taken as samples (in-process and QC).',
  fields: [
    { name: 'output', label: 'Net weight of good tablets', kind: 'number', unit: 'kg' },
    { name: 'rejectWeight', label: 'Net weight of rejected tablets', kind: 'number', unit: 'kg' },
    { name: 'samples', label: 'Tablets taken as samples', kind: 'number', unit: 'tablets' },
  ],
  settings: [
    { name: 'theoretical', label: 'Theoretical number of tablets', kind: 'quantity' },
    { name: 'meanWeight', label: 'Mean tablet weight', kind: 'quantity' },
    { name: 'yieldLimit', label: 'Yield limits', kind: 'limit' },
    { name: 'accountabilityLimit', label: 'Accountability limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'goodTablets', label: 'Good tablets', template: 'T6', args: { mode: 'ratio', a: '$output', b: '$meanWeight', unit: 'tablets', decimals: 0 } },
    { name: 'rejects', label: 'Rejected tablets', template: 'T6', args: { mode: 'ratio', a: '$rejectWeight', b: '$meanWeight', unit: 'tablets', decimals: 0 } },
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$goodTablets', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$theoretical', parts: [{ name: 'good tablets', value: '$goodTablets' }, { name: 'samples', value: '$samples' }, { name: 'rejects', value: '$rejects' }], limit: '$accountabilityLimit' } },
  ],
};
