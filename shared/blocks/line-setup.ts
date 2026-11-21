import { PACKING_LINE, type Block } from './format.js';

// The machines of a filling and packing line besides the line itself (master data's types).
const LINE_MACHINES = [...PACKING_LINE, 'carton', 'check weigh', 'labeller', 'case packer', 'bundling', 'serialisation', 'induction sealer', 'tray loader', 'capping', 'coder'];

// Packing, TL-P4 and TL-P2: at line start every component is checked against the packing master, the coder is set to
// this batch's data and specimens of the coded printed materials go with the record.
export const lineSetup: Block = {
  id: 'line-setup', version: 1, name: 'Line set-up and component check', checker: true, packing: true,
  instruction: 'Set up the line for this pack. Check every component against the packing master, set the coder to this batch, and keep specimens of the coded printed materials.',
  fields: [
    // Fix round 21 Nov 2026 (A9): a packing line of several machines (the filling line of the issue, then a labeller,
    // a cartoner, a check weigher ...): each recorded here is pulled from the Logbook and in use by the batch.
    { name: 'machine2', label: 'Another machine of the line (e.g. labeller)', kind: 'machine', types: LINE_MACHINES, optional: true },
    { name: 'machine3', label: 'Another machine of the line (e.g. check weigher)', kind: 'machine', types: LINE_MACHINES, optional: true },
    { name: 'machine4', label: 'Another machine of the line (e.g. cartoner)', kind: 'machine', types: LINE_MACHINES, optional: true },
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
