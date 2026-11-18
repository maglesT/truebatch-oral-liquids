import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../server/audit.js';
import { freshApp, login, seedUser, type TestApp } from './helpers.js';

// PL-06: one audit trail, insert-only in the database: the app role may add rows, never change or remove them, and
// cannot choose their time or id. A trigger refuses changes by anyone, the database owner included.

let t: TestApp;
let userId: number;
beforeAll(async () => {
  t = await freshApp();
  userId = await seedUser(t.owner, 'auditor1', ['truebatch.view']);
  await login(t.app, 'auditor1');
});
afterAll(() => t.close());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

describe('audit trail', () => {
  it('PL-06: the app role adds audit rows with the actor, the change and a server timestamp', async () => {
    await audit(t.sql, { actorId: userId, action: 'test.changed', objectType: 'test', objectId: 7, old: { a: 1 }, new: { a: 2 }, reason: 'typing error' });
    const [row] = await t.owner`select * from audit_log where action = 'test.changed'`;
    expect(row).toMatchObject({ actor_id: String(userId), object_type: 'test', object_id: '7', old_value: { a: 1 }, new_value: { a: 2 }, reason: 'typing error' });
    expect(Math.abs(Date.now() - new Date(row!.at).getTime())).toBeLessThan(60_000);
  });

  it('PL-06: sign-on is in the audit trail', async () => {
    expect(await t.owner`select 1 from audit_log where action = 'login' and actor_id = ${userId}`).toHaveLength(1);
  });

  it('PL-06: an UPDATE, DELETE or TRUNCATE of the audit trail by the app role fails', async () => {
    expect(await code(t.sql`update audit_log set action = 'x'`)).toBe('42501');
    expect(await code(t.sql`delete from audit_log`)).toBe('42501');
    expect(await code(t.sql`truncate audit_log`)).toBe('42501');
    expect((await t.owner`select count(*)::int as n from audit_log`)[0]!.n).toBeGreaterThan(0);
  });

  it('PL-06: the database owner cannot change or remove audit rows either (insert-only trigger)', async () => {
    expect(await code(t.owner`update audit_log set reason = 'x'`)).toBe('42501');
    expect(await code(t.owner`delete from audit_log`)).toBe('42501');
  });

  it('PL-06: the app role cannot choose the audit timestamp or id', async () => {
    expect(await code(t.sql`insert into audit_log (at, action, object_type) values (now() - interval '1 year', 'x', 'y')`)).toBe('42501');
    // The id is generated always (428C9 before any right is checked).
    expect(await code(t.sql`insert into audit_log (id, action, object_type) values (999999, 'x', 'y')`)).toMatch(/^(42501|428C9)$/);
  });
});
