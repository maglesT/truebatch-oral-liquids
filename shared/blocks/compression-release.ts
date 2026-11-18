import type { Block } from './format.js';

// Release of compression (TB-15, every station at the start): tablets from every station, 20 weights (T7 mean, C3
// individual weights), hardness and thickness (T7) and appearance (C4), with the names of the compress block. The
// master may make it a QA hold before compression continues.
export const compressionRelease: Block = {
  id: 'compression-release', version: 1, name: 'Release of compression', checker: true,
  instruction: 'Take tablets from every station. Record the weights of 20 tablets, then the hardness and thickness of 10, and check their appearance.',
  fields: [
    { name: 'machine', label: 'Tablet press', kind: 'machine', types: ['press', 'compression'], notTypes: ['filter', 'compressor'] },
    { name: 'allStations', label: 'Tablets taken from every station', kind: 'yes-no' },
    { name: 'weights', label: 'Weights of 20 tablets', kind: 'number', unit: 'mg', count: 20 },
    { name: 'hardness', label: 'Hardness of 10 tablets', kind: 'number', unit: 'N', count: 10 },
    { name: 'thickness', label: 'Thickness of 10 tablets', kind: 'number', unit: 'mm', count: 10 },
    { name: 'appearance', label: 'Tablets as described, no capping, chipping or sticking', kind: 'yes-no' },
  ],
  settings: [
    { name: 'meanLimit', label: 'Mean weight limits', kind: 'limit' },
    { name: 'weightBand', label: 'Individual weights (± % of the mean)', kind: 'number' },
    { name: 'weightOuterBand', label: 'No tablet outside (± % of the mean)', kind: 'number' },
    { name: 'hardnessLimit', label: 'Hardness limits', kind: 'limit' },
    { name: 'thicknessLimit', label: 'Thickness limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'stations', label: 'Every station', template: 'C4', args: { question: 'Tablets taken from every station', answers: ['$allStations'], expected: ['yes'] } },
    { name: 'meanWeight', label: 'Mean weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'individualWeights', label: 'Individual weights', template: 'C3', args: { readings: '$weights', band: { plusMinusPercent: '$weightBand', of: 'mean' }, allowedOutside: 2, outer: { plusMinusPercent: '$weightOuterBand', of: 'mean' }, noun: 'tablets', meanLimit: '$meanLimit' } },
    { name: 'meanHardness', label: 'Hardness', template: 'T7', args: { readings: '$hardness', limit: '$hardnessLimit' } },
    { name: 'meanThickness', label: 'Thickness', template: 'T7', args: { readings: '$thickness', limit: '$thicknessLimit' } },
    { name: 'appearanceCheck', label: 'Appearance', template: 'C4', args: { question: 'Tablets as described, no capping, chipping or sticking', answers: ['$appearance'], expected: ['yes'] } },
  ],
};
