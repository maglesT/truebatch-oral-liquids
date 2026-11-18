import type { Block } from './format.js';

// Compression with periodic in-process checks: one round every N minutes (at most 30, TB-15) until compression is
// finished. Each round: 20 tablet weights (T7 mean, C3 individual weights), hardness and thickness (T7).
export const compress: Block = {
  id: 'compress', version: 1, name: 'Compress with periodic checks', checker: false, stop: 'finished',
  periodic: { maxMinutes: 30 },
  instruction: 'Take 20 tablets and record their weights, then the hardness and thickness of 5 tablets.',
  fields: [
    { name: 'machine', label: 'Tablet press', kind: 'machine', types: ['press', 'compression'], notTypes: ['filter', 'compressor'] },
    { name: 'weights', label: 'Weights of 20 tablets', kind: 'number', unit: 'mg', count: 20 },
    { name: 'hardness', label: 'Hardness of 5 tablets', kind: 'number', unit: 'N', count: 5 },
    { name: 'thickness', label: 'Thickness of 5 tablets', kind: 'number', unit: 'mm', count: 5 },
    { name: 'compressionDone', label: 'Compression finished', kind: 'yes-no' },
  ],
  settings: [
    { name: 'meanLimit', label: 'Mean weight limits', kind: 'limit' },
    { name: 'weightBand', label: 'Individual weights (± % of the mean)', kind: 'number' },
    { name: 'weightOuterBand', label: 'No tablet outside (± % of the mean)', kind: 'number' },
    { name: 'hardnessLimit', label: 'Hardness limits', kind: 'limit' },
    { name: 'thicknessLimit', label: 'Thickness limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'meanWeight', label: 'Mean weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'individualWeights', label: 'Individual weights', template: 'C3', args: { readings: '$weights', band: { plusMinusPercent: '$weightBand', of: 'mean' }, allowedOutside: 2, outer: { plusMinusPercent: '$weightOuterBand', of: 'mean' }, noun: 'tablets', meanLimit: '$meanLimit' } },
    { name: 'meanHardness', label: 'Hardness', template: 'T7', args: { readings: '$hardness', limit: '$hardnessLimit' } },
    { name: 'meanThickness', label: 'Thickness', template: 'T7', args: { readings: '$thickness', limit: '$thicknessLimit' } },
    { name: 'finished', label: 'Compression finished', template: 'C4', args: { question: 'Compression finished', answers: ['$compressionDone'], expected: ['yes'] } },
  ],
};
