import type { Block } from './format.js';

// Packing, TB-P4 and TB-P2: at line start every component is checked against the packing master, the coder is set to
// this batch's data and specimens of the coded printed materials go with the record.
export const lineSetup: Block = {
  id: 'line-setup', version: 1, name: 'Line set-up and component check', checker: true, packing: true,
  instruction: 'Set up the line for this pack. Check every component against the packing master, set the coder to this batch, and keep specimens of the coded printed materials.',
  fields: [
    { name: 'components', label: 'Every component on the line is the one the packing master lists, with the lot issued', kind: 'yes-no' },
    { name: 'changeParts', label: 'Change parts and tooling for this pack fitted and checked', kind: 'yes-no' },
    { name: 'coderSet', label: 'Coder set to this batch data (batch no., dates, MRP)', kind: 'yes-no' },
    { name: 'specimens', label: 'Specimens of the coded printed materials signed and attached to the record', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'setupCheck', label: 'Line set up as the packing master says', template: 'C4',
      args: { question: 'Line set up as the packing master says', answers: ['$components', '$changeParts', '$coderSet', '$specimens'], expected: ['yes'] } },
  ],
};
