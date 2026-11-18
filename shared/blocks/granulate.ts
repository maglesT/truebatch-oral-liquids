import type { Block } from './format.js';

// Wet granulation to an end point (e.g. the impeller power reading).
export const granulate: Block = {
  id: 'granulate', version: 1, name: 'Granulate to an end point', checker: false,
  instruction: 'Add the binder and granulate until the end point is reached. Record the reading at the end point.',
  fields: [
    { name: 'machine', label: 'Granulator', kind: 'machine', types: ['granulat', 'rmg'] },
    { name: 'endPoint', label: 'End-point reading', kind: 'number', unit: 'kW' },
    { name: 'endPointAt', label: 'End point reached at', kind: 'timer' },
  ],
  settings: [{ name: 'endPointLimit', label: 'End-point limits', kind: 'limit' }],
  calcs: [{ name: 'endPointCheck', label: 'End point against limits', template: 'C1', args: { value: '$endPoint', limit: '$endPointLimit' } }],
};
