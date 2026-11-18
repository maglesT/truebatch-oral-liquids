import { masterSchema, type MasterDoc, type Pack } from '../shared/master/schema.js';
import { packingStages } from '../web/src/designer/skeletons.js';

// An invented pack: Examplol 100 mg tablets in Alu-PVC blisters of 10, 10 blisters per carton, for India domestic
// (MRP Rs. 125.00), shelf life 24 months, from the bulk product PRD-001. Its process is the designer's packing
// skeleton with the product's limits filled in.
export const GTIN = '08901234567890';
export const pack = (x: Partial<Pack> = {}): Pack => ({
  bulkItemId: 'prd-1', bulkCode: 'PRD-001', bulkName: 'Examplol 100 mg tablets', type: 'blister', unitsPerPack: 10, packsPerCarton: 10, shelfLifeMonths: 24,
  expiryRule: 'month before', destination: 'India domestic', mrp: '125.00', serialisation: false,
  materials: [
    { key: 'foil', materialItemId: 'pm-foil', code: 'PM-101', name: 'Printed aluminium foil', kind: 'foil', printed: true, coded: true, perPack: '0.120', unit: 'm' },
    { key: 'pvc', materialItemId: 'pm-pvc', code: 'PM-102', name: 'PVC/PVDC film', kind: 'forming film', printed: false, coded: false, perPack: '0.120', unit: 'm' },
    { key: 'carton', materialItemId: 'pm-ctn', code: 'PM-103', name: 'Carton', kind: 'carton', printed: true, coded: true, perPack: '0.1', unit: 'units' },
    { key: 'leaflet', materialItemId: 'pm-lft', code: 'PM-104', name: 'Leaflet', kind: 'leaflet', printed: true, coded: false, perPack: '0.1', unit: 'units' },
  ],
  ...x,
});

/** The packing master: the skeleton for the pack, its limits set. */
export function packing(x: Partial<Pack> = {}): MasterDoc {
  const p = pack(x);
  const stages = packingStages(p);
  for (const s of stages) for (const t of s.steps) {
    if (t.block.id === 'forming-check') t.settings.sealLimit = { low: '160', high: '190', unit: '°C' };
    if (t.block.id === 'leak-test') t.settings.vacuumLimit = { low: '400', high: '600', unit: 'mbar' };
    if (t.block.id === 'bulk-issue') t.checker = true;
  }
  stages[0]!.machineTypes = ['blister line'];
  return masterSchema.parse({ header: { productItemId: 'pk-1', productCode: 'PK-001', productName: 'Examplol 100 mg tablets, 10 x 10 blister', batchSize: '100000', coreWeightMg: '250.0' },
    formula: [], stages, pack: p });
}

/** A valid GS1 code of this batch. */
export const code = (serial: string, batch = 'TB260001', expiry = '281031', gtin = GTIN) => `(01)${gtin}(17)${expiry}(10)${batch}(21)${serial}`;
