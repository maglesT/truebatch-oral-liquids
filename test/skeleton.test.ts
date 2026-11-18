import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { buildApp } from '../server/app.js';
import { connect } from '../server/db.js';
import { fakeMaster, fakeSignOn, freshApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await freshApp();
});
afterAll(() => t.close());

describe('skeleton', () => {
  it('health reports ok with database and UTC server time', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
    expect(res.json().serverTime).toMatch(/Z$/);
  });

  it('health reports 503 when the database cannot be reached', async () => {
    const nowhere = connect('postgres://truebatch_app:x@127.0.0.1:1/truebatch', {});
    const app = await buildApp({ sql: nowhere, signOn: fakeSignOn(), master: fakeMaster(), webRoot: '/nonexistent' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', db: 'unreachable' });
    await app.close();
    await nowhere.end();
  });

  it('migrations are recorded and re-running applies nothing', async () => {
    const rows = await t.owner`select name from schema_migrations`;
    expect(rows.map((r) => r.name)).toContain('0001_accounts_audit.sql');
    expect(await migrate(t.owner)).toEqual([]);
  });

  it('unknown API routes return 404', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});
