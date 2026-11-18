import type { Block } from './format.js';

// Binder solution: the solvent to add for the target solids (T17, worked out from the binder quantity, and the
// quantities of up to two more dissolved materials such as a surfactant, before the batch), the solvent added within ± tolerance of it (C1), the mixing time (T13) and a clear solution (C4). The hold
// time is the preparation stage's (TB-17).
export const binderSolution: Block = {
  id: 'binder-solution', version: 1, name: 'Prepare the binder solution', checker: true,
  instruction: 'Add the solvent shown to the vessel, start the stirrer, add the binder slowly and stir until it has dissolved. Check that the solution is clear and has no lumps.',
  fields: [
    { name: 'machine', label: 'Vessel with stirrer', kind: 'machine', types: ['vessel', 'tank', 'stirrer'] },
    { name: 'solventAdded', label: 'Solvent added', kind: 'number', unit: 'kg' },
    { name: 'mixStart', label: 'Start of mixing', kind: 'timer' },
    { name: 'mixEnd', label: 'End of mixing', kind: 'timer' },
    { name: 'appearance', label: 'Solution clear, no lumps', kind: 'yes-no' },
  ],
  settings: [
    { name: 'binder', label: 'Binder quantity', kind: 'quantity' },
    { name: 'binder2', label: 'Second material dissolved (e.g. polysorbate)', kind: 'quantity', optional: true },
    { name: 'binder3', label: 'Third material dissolved', kind: 'quantity', optional: true },
    { name: 'targetSolids', label: 'Target solids (% w/w)', kind: 'quantity' },
    { name: 'tolerance', label: 'Tolerance on the solvent (± %)', kind: 'number' },
    { name: 'mixTimeLimit', label: 'Mixing time limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'makeUp', label: 'Solvent to add', template: 'T17', args: { mode: 'w/w', dry: [{ name: 'binder', quantity: '$binder' },
      { name: 'second material', quantity: '$binder2?' }, { name: 'third material', quantity: '$binder3?' }], targetSolids: '$targetSolids', unit: 'kg' } },
    { name: 'solventCheck', label: 'Solvent added against the make-up', template: 'C1', args: { value: '$solventAdded', around: { centre: '$makeUp', name: 'solvent to add', plusMinusPercent: '$tolerance' } } },
    { name: 'mixTime', label: 'Mixing time', template: 'T13', args: { mode: 'duration', start: '$mixStart', end: '$mixEnd', limit: '$mixTimeLimit' } },
    { name: 'appearanceCheck', label: 'Appearance', template: 'C4', args: { question: 'Solution clear, no lumps', answers: ['$appearance'], expected: ['yes'] } },
  ],
};
