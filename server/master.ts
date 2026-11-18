import type { Sql } from './db.js';

// Master data is Medhanta core's. TrueBatch reads it live through master_data's report.*_v1 views with its own login
// (platform PL-08) and keeps no copy (platform D-02). A record that refers to an item keeps the item id plus the code,
// name and version as at signing (PL-07); that copy belongs to the record, not to a master-data cache.

interface Base { itemId: string; code: string; name: string; version: number; active: boolean }
// kind: 'bulk' (made in TrueBatch Tablets) or 'pack' (packed in TrueBatch Tablets Packing); null when master data does
// not say (not set yet, or an older platform whose view has no kind column).
export interface MasterProduct extends Base { strength: string | null; dosageForm: string | null; kind?: 'bulk' | 'pack' | null }
export interface MasterMaterial extends Base { category: string | null; unit: string | null }
export interface MasterEquipment extends Base { kind: 'equipment' | 'instrument'; type: string | null; room: string | null }
export interface MasterRoom extends Base { area: string | null; grade: string | null }

export interface Master {
  products(): Promise<MasterProduct[]>;
  materials(): Promise<MasterMaterial[]>;
  equipment(): Promise<MasterEquipment[]>;   // equipment and instruments
  rooms(): Promise<MasterRoom[]>;
}

export const CONNECTION_OFF = 'Connection to master data is off. Ask your administrator.';
export class ConnectionOff extends Error {
  statusCode = 503;
  constructor() { super(CONNECTION_OFF); }
}
// A cut link: the grant is gone (42501), the login is off (28000), or master_data cannot be reached (connection
// errors: class 08, admin shutdown 57P01, or the client's own connect errors).
const isCut = (e: unknown) => {
  const code = (e as { code?: string }).code ?? '';
  return ['42501', '28000', '57P01', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED',
    'CONNECTION_ENDED', 'CONNECTION_DESTROYED'].includes(code) || code.startsWith('08');
};

/** Reads master_data's views; a cut link throws ConnectionOff and nothing is served from a copy (platform D-02). */
export function sqlMaster(md: Sql): Master {
  const read = async <T>(q: () => Promise<T>) => {
    try { return await q(); } catch (e) { if (isCut(e)) throw new ConnectionOff(); throw e; }
  };
  return {
    // kind is read through the row as JSON, so a view without the column (an older platform) gives null, not an error.
    products: () => read(async () => [...await md<MasterProduct[]>`
      select id as "itemId", code, name, version, active, strength, dosage_form as "dosageForm",
        case when to_jsonb(p)->>'kind' in ('bulk', 'pack') then to_jsonb(p)->>'kind' end as kind
      from report.product_v1 p order by code`]),
    materials: () => read(async () => [...await md<MasterMaterial[]>`
      select id as "itemId", code, name, version, active, category, unit from report.material_v1 order by code`]),
    equipment: () => read(async () => [
      ...(await md<MasterEquipment[]>`select id as "itemId", code, name, version, active, 'equipment' as kind, type, room_code as room from report.equipment_v1`),
      ...(await md<MasterEquipment[]>`select id as "itemId", code, name, version, active, 'instrument' as kind, type, room_code as room from report.instrument_v1`),
    ].sort((a, b) => a.code.localeCompare(b.code))),
    rooms: () => read(async () => [...await md<MasterRoom[]>`
      select id as "itemId", code, name, version, active, area, grade from report.room_v1 order by code`]),
  };
}

export class NotUsable extends Error {
  statusCode = 409;
  constructor(public code: 'unknown_item' | 'inactive_item', message: string) { super(message); }
}

/**
 * Platform PL-08 write-time check: before a record refers to a master-data item, read it through the view and refuse
 * the write if it is missing or inactive. Returns the item as read now (its values are what the record keeps, PL-07).
 */
export function usableItem<T extends Base>(items: T[], itemId: string, what: string): T {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) throw new NotUsable('unknown_item', `No such ${what} in master data.`);
  if (!item.active) throw new NotUsable('inactive_item', `${item.code} is not active in master data.`);
  return item;
}
