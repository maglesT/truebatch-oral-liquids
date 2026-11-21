// The master designer's server calls and types (server/routes/masters.ts, masterdata.ts).
import { api } from './api.js';
import type { MasterDoc, MasterState } from '../../shared/master/schema.js';

export interface MasterRow {
  id: number; masterId: number; versionNo: number; state: MasterState; header: MasterDoc['header'];
  createdAt: string; createdByName: string; materialIds: string[];
}
export interface Version { id: number; masterId: number; versionNo: number; state: MasterState; doc: MasterDoc; createdBy: number; createdAt: string }

interface Item { itemId: string; code: string; name: string; version: number; active: boolean }
export interface Product extends Item { strength: string | null; dosageForm: string | null; kind?: 'bulk' | 'pack' | null }
export interface Material extends Item { category: string | null; unit: string | null }
export interface Equipment extends Item { kind: 'equipment' | 'instrument'; type: string | null; room: string | null }
export interface Room extends Item { area: string | null; grade: string | null }
export interface MasterData { products: Product[]; materials: Material[]; equipment: Equipment[]; rooms: Room[] }

export type ReviewAction = 'submit' | 'pass' | 'return' | 'approve' | 'make-effective' | 'delete';
export interface MasterEvent { id: number; kind: 'submitted' | 'passed' | 'returned' | 'approved' | 'effective' | 'retired' | 'deleted'; payload: { reason?: string; changeControl?: string }; personName: string; at: string }
export interface Comment { id: number; path: string | null; text: string; personName: string; at: string }
export interface ReviewData {
  events: MasterEvent[]; comments: Comment[]; contentHash: string;
  previous: { id: number; versionNo: number; state: MasterState; doc: MasterDoc } | null;
  actions: ReviewAction[]; refusals: Record<ReviewAction, string | null>;
}

export const STATE_LABEL: Record<MasterState, string> = { draft: 'Draft', in_review: 'In review', approved: 'Approved', effective: 'Effective', retired: 'Retired', deleted: 'Deleted' };
export const STATE_CHIP: Record<MasterState, string> = { draft: 'chip chip-draft', in_review: 'chip chip-info', approved: 'chip chip-warn', effective: 'chip chip-ok', retired: 'chip chip-draft muted', deleted: 'chip chip-draft muted' };

export const listMasters = () => api<MasterRow[]>('GET', '/api/masters');
export const getVersion = (id: number) => api<Version>('GET', `/api/master-versions/${id}`);
export const saveVersion = (id: number, doc: MasterDoc) => api<{ ok: true }>('PUT', `/api/master-versions/${id}`, { doc });
export const createMaster = (doc: MasterDoc) => api<{ id: number; masterId: number; versionNo: number }>('POST', '/api/masters', { doc });
export const newVersion = (masterId: number) => api<{ id: number }>('POST', `/api/masters/${masterId}/versions`, {});
export const getReview = (id: number) => api<ReviewData>('GET', `/api/master-versions/${id}/review`);
export const addComment = (id: number, text: string, path?: string) => api<{ id: number }>('POST', `/api/master-versions/${id}/comments`, { text, ...(path ? { path } : {}) });
export const reviewAction = (id: number, action: ReviewAction, body: object) => api<{ ok: true; state: MasterState }>('POST', `/api/master-versions/${id}/${action}`, body);

let masterData: Promise<MasterData> | null = null;
/** Products, materials, equipment and rooms, read live from core's master data (once per page load). */
export function loadMasterData(): Promise<MasterData> {
  masterData ??= Promise.all([
    api<Product[]>('GET', '/api/master/products'), api<Material[]>('GET', '/api/master/materials'),
    api<Equipment[]>('GET', '/api/master/equipment'), api<Room[]>('GET', '/api/master/rooms'),
  ]).then(([products, materials, equipment, rooms]) => ({ products, materials, equipment, rooms }))
    .catch((e) => { masterData = null; throw e; });
  return masterData;
}
