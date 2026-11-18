import type { Block } from './format.js';

// Dry to an LOD limit: used as repeat-until, a new round of drying until the LOD is within the limit.
export const dry: Block = {
  id: 'dry', version: 1, name: 'Dry to an LOD limit', checker: false, stop: 'lodCheck',
  instruction: 'Dry the granules, take a sample and record the loss on drying.',
  fields: [
    { name: 'machine', label: 'Dryer', kind: 'machine', types: ['dryer', 'drier', 'fbd', 'fluid bed'] },
    { name: 'inletTemp', label: 'Inlet temperature', kind: 'number', unit: '°C' },
    { name: 'lod', label: 'Loss on drying', kind: 'number', unit: '%' },
  ],
  settings: [{ name: 'lodLimit', label: 'LOD limit', kind: 'limit' }],
  calcs: [{ name: 'lodCheck', label: 'LOD against limit', template: 'C1', args: { value: '$lod', limit: '$lodLimit' } }],
};
