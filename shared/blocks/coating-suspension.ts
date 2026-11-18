import type { Block } from './format.js';

// Coating suspension: as the binder solution, for a coating powder at its target solids (T17). The suspension is used
// within the hold time of its preparation stage (TB-17).
export const coatingSuspension: Block = {
  id: 'coating-suspension', version: 1, name: 'Prepare the coating suspension', checker: true,
  instruction: 'Add the solvent shown to the vessel, stir to form a vortex and add the coating powder slowly. Stir for the time shown, then pass the suspension through the screen. Use it within its hold time.',
  fields: [
    { name: 'machine', label: 'Vessel with stirrer', kind: 'machine', types: ['vessel', 'tank', 'stirrer'] },
    { name: 'solventAdded', label: 'Solvent added', kind: 'number', unit: 'kg' },
    { name: 'mixStart', label: 'Start of mixing', kind: 'timer' },
    { name: 'mixEnd', label: 'End of mixing', kind: 'timer' },
    { name: 'appearance', label: 'Suspension even, no lumps, passed through the screen', kind: 'yes-no' },
  ],
  settings: [
    { name: 'powder', label: 'Coating powder quantity', kind: 'quantity' },
    { name: 'targetSolids', label: 'Target solids (% w/w)', kind: 'quantity' },
    { name: 'tolerance', label: 'Tolerance on the solvent (± %)', kind: 'number' },
    { name: 'mixTimeLimit', label: 'Mixing time limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'makeUp', label: 'Solvent to add', template: 'T17', args: { mode: 'w/w', dry: [{ name: 'coating powder', quantity: '$powder' }], targetSolids: '$targetSolids', unit: 'kg' } },
    { name: 'solventCheck', label: 'Solvent added against the make-up', template: 'C1', args: { value: '$solventAdded', around: { centre: '$makeUp', name: 'solvent to add', plusMinusPercent: '$tolerance' } } },
    { name: 'mixTime', label: 'Mixing time', template: 'T13', args: { mode: 'duration', start: '$mixStart', end: '$mixEnd', limit: '$mixTimeLimit' } },
    { name: 'appearanceCheck', label: 'Appearance', template: 'C4', args: { question: 'Suspension even, no lumps, passed through the screen', answers: ['$appearance'], expected: ['yes'] } },
  ],
};
