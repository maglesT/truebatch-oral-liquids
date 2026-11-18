import type { Block } from './format.js';

// Pan or fluid-bed (Wurster) coating with periodic spray checks (F6): a round every N minutes, at most 30, with the
// spray conditions against their limits (C1) and the weight gain on the base the master chooses (T5). The rounds
// stop when the gain is within its limits.
export const sprayCoat: Block = {
  id: 'spray-coat', version: 1, name: 'Coat with periodic spray checks', checker: false, stop: 'gain',
  periodic: { maxMinutes: 30 },
  instruction: 'Record the inlet and product temperatures, the spray rate, the atomising air pressure and the pan speed. Weigh 20 tablets and record their mean weight.',
  fields: [
    { name: 'machine', label: 'Coater', kind: 'machine', types: ['coat'] },
    { name: 'inletTemp', label: 'Inlet temperature', kind: 'number', unit: '°C' },
    { name: 'bedTemp', label: 'Product temperature', kind: 'number', unit: '°C' },
    { name: 'sprayRate', label: 'Spray rate', kind: 'number', unit: 'g/min' },
    { name: 'airPressure', label: 'Atomising air pressure', kind: 'number', unit: 'bar' },
    { name: 'speed', label: 'Pan speed', kind: 'number', unit: 'rpm' },
    { name: 'meanWeight', label: 'Mean weight of coated tablets', kind: 'number', unit: 'mg' },
  ],
  settings: [
    { name: 'coreWeight', label: 'Weight before this coat', kind: 'quantity' },
    { name: 'base', label: 'Weight gain on (start: before this coat; final: after it)', kind: 'text', options: ['start', 'final'] },
    { name: 'gainLimit', label: 'Weight gain limits', kind: 'limit' },
    { name: 'inletLimit', label: 'Inlet temperature limits', kind: 'limit', optional: true },
    { name: 'bedLimit', label: 'Product temperature limits', kind: 'limit', optional: true },
    { name: 'sprayRateLimit', label: 'Spray rate limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'inletCheck', label: 'Inlet temperature', template: 'C1', args: { value: '$inletTemp', limit: '$inletLimit' } },
    { name: 'bedCheck', label: 'Product temperature', template: 'C1', args: { value: '$bedTemp', limit: '$bedLimit' } },
    { name: 'sprayRateCheck', label: 'Spray rate', template: 'C1', args: { value: '$sprayRate', limit: '$sprayRateLimit' } },
    { name: 'gain', label: 'Weight gain', template: 'T5', args: { before: '$coreWeight', after: '$meanWeight', mode: 'gain', base: '$base', limit: '$gainLimit' } },
  ],
};
