import type { Block } from './format.js';

// A sample for QA: the number of tablets taken against the master's limits (C1), labelled and handed over (C4). A
// new master step from it is a QA hold: the next step waits until QA releases it.
export const qaSample: Block = {
  id: 'qa-sample', version: 1, name: 'Sample for QA (hold)', checker: true, qaHold: true,
  instruction: 'Take the number of tablets shown, put them in a labelled sample container and hand it to QA. Wait for QA to release the hold before going on.',
  fields: [
    { name: 'taken', label: 'Tablets taken', kind: 'number', unit: 'tablets' },
    { name: 'reference', label: 'Sample reference (QA request no.)', kind: 'text' },
    { name: 'handedOver', label: 'Sample labelled and handed to QA', kind: 'yes-no' },
  ],
  settings: [{ name: 'sampleLimit', label: 'Tablets to take', kind: 'limit' }],
  calcs: [
    { name: 'takenCheck', label: 'Tablets taken against the plan', template: 'C1', args: { value: '$taken', limit: '$sampleLimit' } },
    { name: 'handedCheck', label: 'Sample handed over', template: 'C4', args: { question: 'Sample labelled and handed to QA', answers: ['$handedOver'], expected: ['yes'] } },
  ],
};
