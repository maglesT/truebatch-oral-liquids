import type { Block } from './format.js';

// Packing, serialisation check: codes read from sample packs at the start, at intervals and at the end (C9): GTIN,
// batch and expiry of this batch, a well-formed serial, never read twice in the batch.
export const serialSample: Block = {
  id: 'serial-sample', version: 1, name: 'Serialisation sample check', checker: false, packing: true, stop: 'finished',
  periodic: { maxMinutes: 60, alongside: true },
  instruction: 'Scan (or type) the 2D code of each sample pack, one after another, separated by spaces.',
  fields: [
    { name: 'codes', label: 'Codes of the sample packs', kind: 'text' },
    { name: 'packingDone', label: 'Packing of the batch is finished (end check)', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'codesCheck', label: 'Codes', template: 'C9', args: { codes: '$codes', gtin: '$pack.gtin', batch: '$batch.bulk', manufactured: '$batch.mfgDate',
      months: '$pack.shelfLifeMonths', rule: '$pack.expiryRule', earlier: '$earlier.codes' } },
    { name: 'finished', label: 'Packing finished', template: 'C4', args: { question: 'Packing finished', answers: ['$packingDone'], expected: ['yes'] } },
  ],
};
