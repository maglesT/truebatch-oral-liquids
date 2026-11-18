import type { Block } from './format.js';

// Blend uniformity: one sample from each of 10 locations of the blender; the results (from QC) as the mean and % RSD
// (T7) and each location against its limits (C3).
export const blendUniformity: Block = {
  id: 'blend-uniformity', version: 1, name: 'Blend uniformity sampling', checker: true,
  instruction: 'Take one sample from each of the 10 locations of the sampling plan with the sampling thief, label them and send them to QC. Record the result of each location from the QC report.',
  fields: [
    { name: 'machine', label: 'Blender', kind: 'machine', types: ['blend', 'bin'] },
    { name: 'results', label: 'Content at 10 locations (% of label claim)', kind: 'number', unit: '%', count: 10 },
  ],
  settings: [
    { name: 'meanLimit', label: 'Mean content limits', kind: 'limit' },
    { name: 'rsdLimit', label: 'RSD limit', kind: 'limit' },
    { name: 'individualLimit', label: 'Limits for each location', kind: 'limit' },
  ],
  calcs: [
    { name: 'meanContent', label: 'Mean content', template: 'T7', args: { readings: '$results', limit: '$meanLimit', rsdLimit: '$rsdLimit' } },
    { name: 'locations', label: 'Each location', template: 'C3', args: { readings: '$results', band: { limit: '$individualLimit' }, noun: 'locations' } },
  ],
};
