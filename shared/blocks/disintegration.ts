import type { Block } from './format.js';

// Disintegration in stages (C6): 6 tablets; when 1 or 2 fail, 12 more (16 of the 18 must pass). The medium
// temperature against its limits when the master sets them.
export const disintegration: Block = {
  id: 'disintegration', version: 1, name: 'Disintegration', checker: false,
  instruction: 'Put one tablet in each tube and start the apparatus. Record the time at which each tablet has disintegrated. If one or two have not by the time limit, test 12 more tablets.',
  fields: [
    { name: 'machine', label: 'Disintegration tester', kind: 'machine', types: ['disintegra'] },
    { name: 'temperature', label: 'Medium temperature', kind: 'number', unit: '°C' },
    { name: 'times', label: 'Times of 6 tablets', kind: 'number', unit: 'min', count: 6 },
    { name: 'moreTimes', label: 'Times of 12 more tablets', kind: 'number', unit: 'min', count: 12, optional: true },
  ],
  settings: [
    { name: 'maxTime', label: 'Time limit (min)', kind: 'number' },
    { name: 'temperatureLimit', label: 'Medium temperature limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'temperatureCheck', label: 'Medium temperature', template: 'C1', args: { value: '$temperature', limit: '$temperatureLimit' } },
    { name: 'stages', label: 'Disintegration', template: 'C6', args: { test: 'disintegration', maxTime: '$maxTime', noun: 'tablets', stages: ['$times', '$moreTimes?'] } },
  ],
};
