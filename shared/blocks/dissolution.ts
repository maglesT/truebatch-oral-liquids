import type { Block } from './format.js';

// Fix round 21 Nov 2026 (A3): dissolution as an in-process test of the QC lab, picked from LIMS (the step's lab
// request, like blend and content uniformity): 6 units, then 6 more, then 12 more when a stage does not pass (C6, the
// pharmacopoeia's acceptance tables in stages). Immediate release and the buffer stage of a delayed-release product
// against Q (S1-S3, B1-B3); the acid stage against the most that may dissolve (A1-A3). LIMS keeps one result with every
// value in order (6, 12 or 24); its reported figure is their mean, worked out again here. An extended-release profile
// (several time points per unit) is not a block: it is one Dissolution step per time point only where the
// specification sets a Q at that time point.
export const dissolution: Block = {
  id: 'dissolution', version: 1, name: 'Dissolution (QC lab)', checker: true,
  instruction: 'Take the units for dissolution as the sampling plan says, label them and send them to QC. Pick the results from LIMS once QC has approved them; if a stage does not pass and QC tested more units, pick those too (typed from the QC report only while LIMS cannot be reached).',
  fields: [
    { name: 'results', label: 'Dissolved, 6 units (% of label claim)', kind: 'number', unit: '%', count: 6, qc: 'in_process', figure: 'mean', nextStage: 'moreResults' },
    { name: 'moreResults', label: 'Dissolved, 6 more units (% of label claim)', kind: 'number', unit: '%', count: 6, optional: true, qc: 'in_process', figure: 'mean', nextStage: 'lastResults' },
    { name: 'lastResults', label: 'Dissolved, 12 more units (% of label claim)', kind: 'number', unit: '%', count: 12, optional: true, qc: 'in_process', figure: 'mean' },
  ],
  settings: [
    { name: 'test', label: 'Kind of dissolution test', kind: 'text', options: ['dissolution IR', 'dissolution DR buffer', 'dissolution DR acid'] },
    { name: 'q', label: 'Q (% of label claim); for the acid stage: the most that may dissolve', kind: 'number' },
    { name: 'timePoint', label: 'Time point and medium (as the specification says)', kind: 'text', optional: true },
  ],
  calcs: [
    { name: 'stages', label: 'Dissolution', template: 'C6', args: { test: '$test', Q: '$q', max: '$q', stages: ['$results', '$moreResults?', '$lastResults?'] } },
  ],
};
