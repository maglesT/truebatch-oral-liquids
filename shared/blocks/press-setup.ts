import type { Block } from './format.js';

// Tablet press set-up: the tooling the master names is fitted (C4); the compression pressure is the force over the
// punch face area read from the tooling record (T6); the turret speed as in the mix block.
export const pressSetup: Block = {
  id: 'press-setup', version: 1, name: 'Tablet press set-up', checker: true,
  instruction: 'Fit the tooling shown and record its set no. Read the punch face area from the tooling record. Set the press and record the main compression force and the turret speed.',
  fields: [
    { name: 'machine', label: 'Tablet press', kind: 'machine', types: ['press', 'compression'], notTypes: ['filter', 'compressor'] },
    { name: 'tooling', label: 'Tooling set no.', kind: 'text' },
    { name: 'rightTooling', label: 'Tooling as shown', kind: 'yes-no' },
    { name: 'punchFaceArea', label: 'Punch face area (tooling record)', kind: 'number', unit: 'mm²' },
    { name: 'force', label: 'Main compression force', kind: 'number', unit: 'kN' },
    { name: 'speed', label: 'Turret speed', kind: 'number', unit: 'rpm' },
  ],
  settings: [
    { name: 'toolingType', label: 'Tooling (shape, size, embossing)', kind: 'text' },
    { name: 'pressureLimit', label: 'Compression pressure limits', kind: 'limit', optional: true },
    { name: 'speedLimit', label: 'Speed limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'toolingCheck', label: 'Tooling', template: 'C4', args: { question: 'Tooling as shown', answers: ['$rightTooling'], expected: ['yes'] } },
    { name: 'pressure', label: 'Compression pressure', template: 'T6', args: { mode: 'ratio', a: '$force', b: '$punchFaceArea', unit: 'MPa', decimals: 0, limit: '$pressureLimit?' } },
    { name: 'speedCheck', label: 'Speed against limits', template: 'C1', args: { value: '$speed', limit: '$speedLimit' } },
  ],
};
