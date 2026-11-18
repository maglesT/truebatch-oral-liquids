import { masterSchema, type MasterDoc, type Pack } from '../shared/master/schema.js';
import { packingStages } from '../web/src/designer/skeletons.js';

// An invented pack: Examplol 120 mg/5 mL syrup, 60 mL amber bottle with a child-resistant cap and a measuring cup, in a
// carton with a leaflet, 48 packs per shipper, for India domestic (MRP Rs. 45.00), shelf life 24 months, filled from
// the bulk product PRD-001 (a solution) at 60 mL + 1.5 mL excess. Its process is the designer's packing skeleton with
// the product's limits filled in.
export const GTIN = '08901234567890';
export const pack = (x: Partial<Pack> = {}): Pack => ({
  bulkItemId: 'prd-1', bulkCode: 'PRD-001', bulkName: 'Examplol 120 mg/5 mL syrup', type: 'bottle', closure: 'child-resistant cap', device: 'measuring cup',
  fillVolumeMl: '60', fillExcessMl: '1.5', packsPerCarton: 48, shelfLifeMonths: 24, expiryRule: 'month before', destination: 'India domestic', mrp: '45.00', serialisation: false,
  materials: [
    { key: 'bottle', materialItemId: 'pm-btl', code: 'PM-201', name: 'Amber PET bottle 60 mL', kind: 'bottle', printed: false, coded: false, perPack: '1', unit: 'units' },
    { key: 'cap', materialItemId: 'pm-cap', code: 'PM-202', name: 'Child-resistant cap 25 mm', kind: 'closure', printed: false, coded: false, perPack: '1', unit: 'units' },
    { key: 'cup', materialItemId: 'pm-cup', code: 'PM-203', name: 'Measuring cup 10 mL', kind: 'measuring device', printed: false, coded: false, perPack: '1', unit: 'units' },
    { key: 'label', materialItemId: 'pm-lbl', code: 'PM-204', name: 'Printed label', kind: 'label', printed: true, coded: true, perPack: '1', unit: 'units' },
    { key: 'carton', materialItemId: 'pm-ctn', code: 'PM-205', name: 'Carton', kind: 'carton', printed: true, coded: true, perPack: '1', unit: 'units' },
    { key: 'leaflet', materialItemId: 'pm-lft', code: 'PM-206', name: 'Leaflet', kind: 'leaflet', printed: true, coded: false, perPack: '1', unit: 'units' },
  ],
  ...x,
});

/** The packing master: the skeleton for the pack and bulk type, its limits set. */
export function packing(x: Partial<Pack> = {}, type: MasterDoc['header']['type'] = 'solution'): MasterDoc {
  const p = pack(x);
  const stages = packingStages(p, type);
  for (const s of stages) for (const t of s.steps) {
    const id = t.block.id;
    // 61.5 mL at 1.250 g/mL is 76.875 g.
    if (id.startsWith('liquid-fill')) Object.assign(t.settings, { meanLimit: { low: '76.0', high: '77.8', unit: 'g' }, eachLimit: { low: '75.0', high: '78.8', unit: 'g' } });
    if (id.startsWith('powder-fill')) Object.assign(t.settings, { meanLimit: { low: '24.5', high: '25.5', unit: 'g' }, eachLimit: { low: '24.0', high: '26.0', unit: 'g' }, humidityLimit: { high: '40', unit: '%RH' } });
    if (id === 'cap-check') t.settings.defectLimit = { high: '0', unit: 'units' };
    if (id === 'room-status') t.settings.temperatureLimit = { high: '30', unit: '°C' };
    if (id === 'forming-check') t.settings.sealLimit = { low: '160', high: '190', unit: '°C' };
    if (id === 'leak-test') t.settings.vacuumLimit = { low: '400', high: '600', unit: 'mbar' };
  }
  stages[0]!.machineTypes = ['filling line'];
  return masterSchema.parse({ header: { productItemId: 'pk-1', productCode: 'PK-001', productName: 'Examplol 120 mg/5 mL syrup, 60 mL bottle', type, batchSize: '1000', batchUnit: 'packs' },
    formula: [], stages, pack: p });
}

/** A valid GS1 code of this batch. */
export const code = (serial: string, batch = 'TL260001', expiry = '281031', gtin = GTIN) => `(01)${gtin}(17)${expiry}(10)${batch}(21)${serial}`;
