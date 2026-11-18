import type { Block } from './format.js';

// Lubricate: the lubricant is re-scaled to the actual granule weight (T15, refused outside the window), weighed as in
// the weigh block (T1, C1 within ± tolerance of the re-scaled quantity) and mixed in for a time (T13).
export const lubricate: Block = {
  id: 'lubricate', version: 1, name: 'Lubricate', gmp: 'weighing', checker: true,
  instruction: 'Weigh the lubricant for the actual granule weight shown. Record the gross and tare weights, add it to the blender and mix for the time shown.',
  fields: [
    { name: 'lot', label: 'Lubricant lot', kind: 'lot' },
    { name: 'balance', label: 'Balance', kind: 'machine', types: ['balance'], notTypes: ['analytical', 'micro'] },
    { name: 'gross', label: 'Gross weight', kind: 'number', unit: 'kg' },
    { name: 'tare', label: 'Tare weight', kind: 'number', unit: 'kg' },
    { name: 'machine', label: 'Blender', kind: 'machine', types: ['blend', 'bin'] },
    { name: 'mixStart', label: 'Start of mixing', kind: 'timer' },
    { name: 'mixEnd', label: 'End of mixing', kind: 'timer' },
  ],
  settings: [
    { name: 'lubricant', label: 'Lubricant quantity in the formula', kind: 'quantity' },
    { name: 'granuleWeight', label: 'Actual granule weight', kind: 'quantity' },
    { name: 'theoretical', label: 'Theoretical granule weight', kind: 'quantity' },
    { name: 'window', label: 'Actual granules allowed (% of theoretical)', kind: 'limit', optional: true },
    { name: 'tolerance', label: 'Tolerance (± %)', kind: 'number' },
    { name: 'mixTimeLimit', label: 'Mixing time limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'rescaled', label: 'Lubricant for the actual granules', template: 'T15', args: { formulaQuantity: '$lubricant', actual: '$granuleWeight', theoretical: '$theoretical', window: '$window?', unit: 'kg' } },
    { name: 'net', label: 'Net weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Net against target', template: 'C1', args: { value: '$net', around: { centre: '$rescaled', name: 'target', plusMinusPercent: '$tolerance' } } },
    { name: 'mixTime', label: 'Mixing time', template: 'T13', args: { mode: 'duration', start: '$mixStart', end: '$mixEnd', limit: '$mixTimeLimit' } },
  ],
};
