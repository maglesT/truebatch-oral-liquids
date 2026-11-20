import { PACKING_LINE, type Block } from './format.js';

// TrueBatch Liquids Packing (plan section 4, rules TL-P2, TL-P6, TL-17): the released bulk issued to the filling line and
// its reconciliation at the end. Copies of TrueBatch Tablets' bulk-issue and finished-goods, by volume (a liquid, L)
// or by weight (a dry syrup powder, kg): the unit is the block's, so each has a variant (Tablets way).
//
// Issue: the batch facts recorded when the packing batch is issued (server/routes/batches.ts): the line (one active
// packing order per line, TL-P7), the RELEASED bulk batch of TrueBatch Liquids pulled from its batch_fact_v1 with its
// date of manufacture, the bulk issued (what is left of its good quantity), when the bulk was ready and its hold
// (bulk_ready_at, bulk_hold_hours; refused once the hold is over); typed from the bulk's labels and record with a
// second-person check when the link is off. The containers to fill are the bulk ÷ the fill target (T6).
const issueFields = (unit: 'L' | 'kg') => [
  { name: 'line', label: 'Filling line', kind: 'machine' as const, types: PACKING_LINE },
  { name: 'bulk', label: 'Bulk batch no.', kind: 'bulk' as const },
  { name: 'mfgDate', label: 'Date of manufacture of the bulk', kind: 'text' as const, date: true },
  { name: 'quantity', label: 'Bulk issued', kind: 'number' as const, unit },
  { name: 'readyAt', label: 'Bulk ready (end of manufacturing), date and time', kind: 'text' as const },
  { name: 'holdHours', label: 'Bulk hold (hours, from the master of the bulk)', kind: 'text' as const },
  { name: 'received', label: 'Bulk received: holding tank or containers closed, labelled with this bulk batch and RELEASED', kind: 'yes-no' as const },
];
const issueCalcs = (per: string) => [
  { name: 'expiry', label: 'Expiry date', template: 'T27', args: { manufactured: '$mfgDate', months: '$pack.shelfLifeMonths', rule: '$pack.expiryRule' } },
  { name: 'packs', label: 'Theoretical packs (containers to fill)', template: 'T6', args: { mode: 'ratio', a: '$quantity', b: per, unit: 'packs', decimals: 0 } },
  { name: 'receivedCheck', label: 'Bulk received', template: 'C4', args: { question: 'Bulk received, labelled RELEASED', answers: ['$received'], expected: ['yes'] } },
];
const ATISSUE = ['line', 'bulk', 'mfgDate', 'quantity', 'readyAt', 'holdHours'];

export const liquidBulkIssue: Block = {
  id: 'liquid-bulk-issue', version: 1, name: 'Bulk liquid issued to the filling line', checker: true, packing: true, atIssue: ATISSUE,
  instruction: 'Receive the bulk at the filling line. Check that the holding tank or containers are closed and labelled with this bulk batch number and RELEASED.',
  fields: issueFields('L'), settings: [], calcs: issueCalcs('$pack.fillTarget'),
};
export const powderBulkIssue: Block = {
  id: 'powder-bulk-issue', version: 1, name: 'Bulk powder issued to the filling line', checker: true, packing: true, atIssue: ATISSUE,
  instruction: 'Receive the bulk powder at the filling line. Check that each container is closed and intact and labelled with this bulk batch number and RELEASED.',
  fields: issueFields('kg'), settings: [], calcs: issueCalcs('$pack.fillWeight'),
};

// Finished goods and reconciliation of the bulk (TL-P6): the good packs and samples, the rejected filled containers, the
// bulk left; the bulk accounted as (three decimals, as the accountability line shows them) containers × the fill target (or fill weight) + what is left (T8, T4), the yield in
// packs (T3). Always checked.
const goodsFields = (unit: 'L' | 'kg') => [
  { name: 'packs', label: 'Good packs in finished cartons', kind: 'number' as const, unit: 'packs' },
  { name: 'cartons', label: 'Finished shipper cartons', kind: 'number' as const, unit: 'nos' },
  { name: 'samples', label: 'Packs taken as reserve and QC samples', kind: 'number' as const, unit: 'packs' },
  { name: 'rejects', label: 'Filled containers rejected', kind: 'number' as const, unit: 'units' },
  { name: 'left', label: 'Bulk left (returned or destroyed)', kind: 'number' as const, unit },
];
const goodsCalcs = (per: string, unit: 'L' | 'kg') => [
  { name: 'packed', label: 'Bulk in good packs', template: 'T8', args: { mode: 'per unit', perUnit: per, count: '$packs', unit, decimals: 3 } },
  { name: 'sampled', label: 'Bulk in samples', template: 'T8', args: { mode: 'per unit', perUnit: per, count: '$samples', unit, decimals: 3 } },
  { name: 'rejected', label: 'Bulk in rejected containers', template: 'T8', args: { mode: 'per unit', perUnit: per, count: '$rejects', unit, decimals: 3 } },
  { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$packs', theoretical: '$batch.packs', limit: '$yieldLimit' } },
  { name: 'accountability', label: 'Accountability of the bulk issued', template: 'T4', args: { input: '$batch.quantity',
    parts: [{ name: 'in packs', value: '$packed' }, { name: 'samples', value: '$sampled' }, { name: 'rejected', value: '$rejected' }, { name: 'left', value: '$left' }],
    limit: '$accountabilityLimit' } },
];
const goodsSettings = [
  { name: 'yieldLimit', label: 'Yield limits (packs)', kind: 'limit' as const },
  { name: 'accountabilityLimit', label: 'Accountability limits (bulk)', kind: 'limit' as const },
];
export const liquidFinishedGoods: Block = {
  id: 'liquid-finished-goods', version: 1, name: 'Finished goods and reconciliation of the bulk', gmp: 'yield', checker: true, packing: true,
  instruction: 'Count the good packs in finished cartons, the packs taken as samples and the filled bottles rejected; read the bulk left.',
  fields: goodsFields('L'), settings: goodsSettings, calcs: goodsCalcs('$pack.fillTarget', 'L'),
};
export const powderFinishedGoods: Block = {
  id: 'powder-finished-goods', version: 1, name: 'Finished goods and reconciliation of the bulk powder', gmp: 'yield', checker: true, packing: true,
  instruction: 'Count the good packs in finished cartons, the packs taken as samples and the filled containers rejected; weigh the powder left.',
  fields: goodsFields('kg'), settings: goodsSettings, calcs: goodsCalcs('$pack.fillWeight', 'kg'),
};
