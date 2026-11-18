import type { Block } from './format.js';

// Dry mix for a time: the mixing time is the time from start to end as recorded on the server clock (T13), within
// the master's limits (too short does not mix, too long can segregate). Speed as in the mix block.
export const dryMix: Block = {
  id: 'dry-mix', version: 1, name: 'Dry mix for a time', checker: false,
  instruction: 'Load the materials, record the start, mix at the speed shown, and record the end when the time is up.',
  fields: [
    { name: 'machine', label: 'Mixer or blender', kind: 'machine', types: ['mix', 'blend', 'granulat', 'rmg'] },
    { name: 'speed', label: 'Speed', kind: 'number', unit: 'rpm' },
    { name: 'mixStart', label: 'Start of mixing', kind: 'timer' },
    { name: 'mixEnd', label: 'End of mixing', kind: 'timer' },
  ],
  settings: [
    { name: 'speedLimit', label: 'Speed limits', kind: 'limit', optional: true },
    { name: 'mixTimeLimit', label: 'Mixing time limits', kind: 'limit' },
  ],
  calcs: [
    { name: 'speedCheck', label: 'Speed against limits', template: 'C1', args: { value: '$speed', limit: '$speedLimit' } },
    { name: 'mixTime', label: 'Mixing time', template: 'T13', args: { mode: 'duration', start: '$mixStart', end: '$mixEnd', limit: '$mixTimeLimit' } },
  ],
};
