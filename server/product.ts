import { PERMISSIONS } from './auth.js';
import type { SignOn } from './signon.js';

// The products this server runs (owner, 15 Nov 2026): TrueBatch Tablets, and TrueBatch Tablets Packing, a separate
// product on the platform (own tile, licence, permissions, database and sign-on client) that shares this server, its
// engine, templates, signatures, audit trail, links and screens. Inside the app every permission is known by its
// TrueBatch code (server/auth.ts): a product's own codes in core's token are read as those
// (truebatch_packing.batch.operate is truebatch.batch.operate), and every other code is ignored.
export interface Product {
  // The platform name of the product, its database and its sign-on client (lower case and _ only, as the platform's
  // manifest check requires).
  id: string;
  name: string;
  // What the product declares to the platform: its permission codes and labels (ops/*manifest.draft.json).
  permissions: Record<string, string>;
  // The fixed start of its batch numbers (TB-03).
  batchPrefix: string;
}

export const TABLETS: Product = { id: 'truebatch', name: 'TrueBatch Tablets', permissions: PERMISSIONS, batchPrefix: 'TB' };

/** The product's own codes from core, as the app's codes; any other code is dropped. */
export const ownCodes = (p: Product, codes: string[]) => codes.filter((c) => c in p.permissions).map((c) => `truebatch${c.slice(p.id.length)}`);

/** Core's sign-on, with the product's codes read as the app's (who someone is still comes from core only). */
export function productSignOn(s: SignOn, p: Product): SignOn {
  if (p.id === TABLETS.id) return s;
  const own = <T extends { permissions: string[] }>(i: T): T => ({ ...i, permissions: ownCodes(p, i.permissions) });
  return { ...s, exchange: async (code, verifier) => own(await s.exchange(code, verifier)), refresh: async (token) => own(await s.refresh(token)) };
}
