import { PACKING_LINE, type Block } from './format.js';

// Packing, TB-P2 and TB-P7: the batch facts, recorded when the packing batch is issued (server/routes/batches.ts): the
// line (one active packing order per line), the RELEASED bulk batch of TrueBatch Tablets (pulled from its
// batch_fact_v1 with its date of manufacture, manufactured_on: the date its first processing step started; or typed
// from the bulk labels with a second-person check, never a future date) and the tablets issued. The expiry comes
// from the date of manufacture and the approved shelf life (T27, TB-P8). On the floor the operator confirms receipt.
export const bulkIssue: Block = {
  id: 'bulk-issue', version: 1, name: 'Bulk tablets issued to the line', checker: true, packing: true,
  atIssue: ['line', 'bulk', 'mfgDate', 'tablets'],
  instruction: 'Receive the bulk tablets at the line. Check that each container is closed and intact and that its label shows this bulk batch number and RELEASED.',
  fields: [
    { name: 'line', label: 'Packing line', kind: 'machine', types: PACKING_LINE },
    { name: 'bulk', label: 'Bulk batch no.', kind: 'bulk' },
    { name: 'mfgDate', label: 'Date of manufacture of the bulk', kind: 'text', date: true },
    { name: 'tablets', label: 'Bulk tablets issued', kind: 'number', unit: 'tablets' },
    { name: 'received', label: 'Containers closed and intact, labels show this bulk batch and RELEASED', kind: 'yes-no' },
  ],
  settings: [],
  calcs: [
    { name: 'expiry', label: 'Expiry date', template: 'T27', args: { manufactured: '$mfgDate', months: '$pack.shelfLifeMonths', rule: '$pack.expiryRule' } },
    { name: 'packs', label: 'Theoretical packs', template: 'T6', args: { mode: 'ratio', a: '$tablets', b: '$pack.unitsPerPack', unit: 'packs', decimals: 0 } },
    { name: 'receivedCheck', label: 'Bulk received', template: 'C4', args: { question: 'Bulk containers intact and labelled RELEASED', answers: ['$received'], expected: ['yes'] } },
  ],
};
