import type { Block } from './format.js';

// Fix round 21 Nov 2026 (A2): up to three in-process tests of the QC lab on one sample of this step (an assay of each
// layer, a water content, a pH), each a single result picked from LIMS (the step's lab request, one test per field:
// '<block id>.test1' ... ), each against its own limits (C1). The master names what each test is, its unit and its
// limits; a test whose unit is not set is not asked for (the lab request leaves it out), so one, two or three tests.
export const labTests: Block = {
  id: 'lab-tests', version: 1, name: 'In-process lab tests (QC lab)', checker: true,
  instruction: 'Take the sample as the sampling plan says, label it and send it to QC. Pick each result from LIMS once QC has approved it (typed from the QC report only while LIMS cannot be reached).',
  fields: [
    { name: 'test1', label: 'Lab test 1', labelFrom: 'what1', kind: 'number', unit: '$unit1', qc: 'in_process' },
    { name: 'test2', label: 'Lab test 2', labelFrom: 'what2', kind: 'number', unit: '$unit2', qc: 'in_process', optional: true },
    { name: 'test3', label: 'Lab test 3', labelFrom: 'what3', kind: 'number', unit: '$unit3', qc: 'in_process', optional: true },
  ],
  settings: [
    { name: 'what1', label: 'Test 1: what is tested', kind: 'text' },
    { name: 'unit1', label: 'Test 1: unit', kind: 'text' },
    { name: 'limit1', label: 'Test 1: limits', kind: 'limit' },
    { name: 'what2', label: 'Test 2: what is tested', kind: 'text', optional: true },
    { name: 'unit2', label: 'Test 2: unit', kind: 'text', optional: true },
    { name: 'limit2', label: 'Test 2: limits', kind: 'limit', optional: true },
    { name: 'what3', label: 'Test 3: what is tested', kind: 'text', optional: true },
    { name: 'unit3', label: 'Test 3: unit', kind: 'text', optional: true },
    { name: 'limit3', label: 'Test 3: limits', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'check1', label: 'Test 1 against its limits', template: 'C1', args: { value: '$test1', limit: '$limit1' } },
    { name: 'check2', label: 'Test 2 against its limits', template: 'C1', args: { value: '$test2', limit: '$limit2' } },
    { name: 'check3', label: 'Test 3 against its limits', template: 'C1', args: { value: '$test3', limit: '$limit3' } },
  ],
};
