import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTION_OFF, NotUsable, usableItem } from '../server/master.js';
import { call, freshApp, login, seedUser, type TestApp } from './helpers.js';

// PL-08: master data is read live from core's views; a cut link says "connection off" and serves nothing from a copy;
// an unknown or inactive item is refused when a record would refer to it.

let t: TestApp;
let cookie: string;
const base = (code: string, active = true) => ({ itemId: randomUUID(), code, name: `Name ${code}`, version: 1, active });
beforeAll(async () => {
  t = await freshApp();
  t.master.products_.push({ ...base('PRD-001'), strength: '500 mg', dosageForm: 'tablet' });
  t.master.materials_.push({ ...base('MAT-001'), category: 'API', unit: 'kg' }, { ...base('MAT-002', false), category: 'excipient', unit: 'kg' });
  t.master.equipment_.push({ ...base('RMG-01'), kind: 'equipment', type: 'rapid mixer granulator', room: 'GRN-01' });
  t.master.rooms_.push({ ...base('GRN-01'), area: 'granulation', grade: 'D' });
  await seedUser(t.owner, 'md1', ['truebatch.view']);
  cookie = (await login(t.app, 'md1')).cookie;
});
afterAll(() => t.close());

describe('master data', () => {
  it('PL-08: products, materials, equipment and rooms are read from master data, inactive ones included', async () => {
    expect((await call(t.app, cookie, 'GET', '/api/master/products')).json().map((p: { code: string }) => p.code)).toEqual(['PRD-001']);
    expect((await call(t.app, cookie, 'GET', '/api/master/materials')).json().map((p: { code: string; active: boolean }) => [p.code, p.active]))
      .toEqual([['MAT-001', true], ['MAT-002', false]]);
    expect((await call(t.app, cookie, 'GET', '/api/master/equipment')).json()[0]).toMatchObject({ code: 'RMG-01', room: 'GRN-01' });
    expect((await call(t.app, cookie, 'GET', '/api/master/rooms')).json().find((r: { code: string }) => r.code === 'GRN-01')).toMatchObject({ code: 'GRN-01', grade: 'D' });
  });

  it('PL-08: with the link off every master-data read answers "connection off"', async () => {
    t.master.cut = true;
    try {
      for (const what of ['products', 'materials', 'equipment', 'rooms']) {
        const res = await call(t.app, cookie, 'GET', `/api/master/${what}`);
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'connection_off', message: CONNECTION_OFF });
      }
    } finally {
      t.master.cut = false;
    }
  });

  it('PL-08: the write-time check refuses an inactive or unknown item', async () => {
    const materials = await t.master.materials();
    expect(usableItem(materials, materials[0]!.itemId, 'material').code).toBe('MAT-001');
    expect(() => usableItem(materials, materials[1]!.itemId, 'material')).toThrow('MAT-002 is not active in master data.');
    expect(() => usableItem(materials, randomUUID(), 'material')).toThrow(NotUsable);
  });
});
