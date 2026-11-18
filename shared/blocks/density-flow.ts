import type { Block } from './format.js';

// Bulk and tapped density and flow (T6): densities as weight ÷ volume, Carr index and Hausner ratio from them, and
// the angle of repose from the cone (when it is measured).
export const densityFlow: Block = {
  id: 'density-flow', version: 1, name: 'Bulk and tapped density, flow', checker: false,
  instruction: 'Pour the weighed sample into the measuring cylinder and read the bulk volume. Tap it as the method says and read the tapped volume. For the angle of repose, pour the powder through the funnel and measure the height and radius of the cone.',
  fields: [
    { name: 'sampleWeight', label: 'Sample weight', kind: 'number', unit: 'g' },
    { name: 'bulkVolume', label: 'Bulk volume', kind: 'number', unit: 'mL' },
    { name: 'tappedVolume', label: 'Tapped volume', kind: 'number', unit: 'mL' },
    { name: 'coneHeight', label: 'Cone height', kind: 'number', unit: 'mm', optional: true },
    { name: 'coneRadius', label: 'Cone radius', kind: 'number', unit: 'mm', optional: true },
  ],
  settings: [
    { name: 'carrLimit', label: 'Carr index limits', kind: 'limit', optional: true },
    { name: 'hausnerLimit', label: 'Hausner ratio limits', kind: 'limit', optional: true },
    { name: 'reposeLimit', label: 'Angle of repose limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'bulkDensity', label: 'Bulk density', template: 'T6', args: { mode: 'ratio', a: '$sampleWeight', b: '$bulkVolume', unit: 'g/mL', decimals: 3 } },
    { name: 'tappedDensity', label: 'Tapped density', template: 'T6', args: { mode: 'ratio', a: '$sampleWeight', b: '$tappedVolume', unit: 'g/mL', decimals: 3 } },
    { name: 'carr', label: 'Carr index', template: 'T6', args: { mode: 'carr', a: '$bulkDensity', b: '$tappedDensity', limit: '$carrLimit?' } },
    { name: 'hausner', label: 'Hausner ratio', template: 'T6', args: { mode: 'hausner', a: '$bulkDensity', b: '$tappedDensity', limit: '$hausnerLimit?' } },
    { name: 'repose', label: 'Angle of repose', template: 'T6', args: { mode: 'angle of repose', a: '$coneHeight', b: '$coneRadius', limit: '$reposeLimit?' } },
  ],
};
