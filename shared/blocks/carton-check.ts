import type { Block } from './format.js';

// Packing, TB-P5: cartons and leaflets checked alongside the line. The leaflet question applies only to a pack with a
// leaflet among its materials (the step screen leaves it out otherwise; shared/engine/batch.ts names the step).
export const cartonCheck: Block = {
  id: 'carton-check', version: 1, name: 'Carton and leaflet check', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 60, alongside: true },
  instruction: 'Open cartons from the end of the line and check their contents and coding.',
  fields: [
    { name: 'cartons', label: 'Cartons checked', kind: 'number', unit: 'nos' },
    { name: 'leaflet', label: 'Each carton holds the leaflet of the packing master', kind: 'yes-no', optional: true },
    { name: 'count', label: 'Each carton holds the number of packs the packing master says', kind: 'yes-no' },
    { name: 'coded', label: 'Carton coding legible, complete and in place', kind: 'yes-no' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'cartonCheck', label: 'Cartons as they should be', template: 'C4', args: { question: 'Cartons as they should be', answers: ['$leaflet?', '$count', '$coded'], expected: ['yes'] } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
