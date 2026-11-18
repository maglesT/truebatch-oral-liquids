import type { Block } from './format.js';

// Check one value against limits (C1); the master step names what is checked, its unit and its limits.
export const check: Block = {
  id: 'check', version: 1, name: 'Check a value against limits', checker: false,
  instruction: 'Measure and record the value.',
  fields: [{ name: 'reading', label: 'Reading', kind: 'number', unit: '$unit' }],
  settings: [
    { name: 'what', label: 'What is checked', kind: 'text' },
    { name: 'unit', label: 'Unit', kind: 'text' },
    { name: 'limit', label: 'Limits', kind: 'limit' },
  ],
  calcs: [{ name: 'readingCheck', label: 'Result against limits', template: 'C1', args: { value: '$reading', limit: '$limit' } }],
};
