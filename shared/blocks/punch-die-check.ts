import type { Block } from './format.js';

// TB-16: the punches and dies of the tooling set checked before use and again after use (one step each): every set
// present, clean and undamaged (C4), and the number damaged (C1, none allowed).
export const punchDieCheck: Block = {
  id: 'punch-die-check', version: 1, name: 'Punch and die check', checker: true,
  instruction: 'Check every upper punch, lower punch and die of the tooling set: present, clean and not chipped, worn or bent. Count any that are damaged.',
  fields: [
    { name: 'tooling', label: 'Tooling set no.', kind: 'text' },
    { name: 'upperPunches', label: 'Upper punches present, clean and undamaged', kind: 'yes-no' },
    { name: 'lowerPunches', label: 'Lower punches present, clean and undamaged', kind: 'yes-no' },
    { name: 'dies', label: 'Dies present, clean and undamaged', kind: 'yes-no' },
    { name: 'damaged', label: 'Punches or dies damaged', kind: 'number', unit: 'nos' },
  ],
  settings: [],
  calcs: [
    { name: 'toolingCheck', label: 'Punches and dies', template: 'C4', args: { question: 'Punches and dies present, clean and undamaged', answers: ['$upperPunches', '$lowerPunches', '$dies'], expected: ['yes'] } },
    { name: 'damagedCheck', label: 'Damaged punches and dies', template: 'C1', args: { value: '$damaged', limit: { high: '0', unit: 'nos' } } },
  ],
};
