import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POLICY, requirePermission, sessionKey } from '../server/auth.js';
import { buildApp } from '../server/app.js';
import { call, directory, fakeMaster, fakeSignOn, freshApp, login, seedUser, TEST_PROOF_KEY, type TestApp } from './helpers.js';

// People, passwords, lockout and the permission register are Medhanta core's; TrueBatch signs people on through core
// (stand-in: helpers.fakeSignOn) and keeps sessions, per-action authority checks and its audit trail.

let t: TestApp;
let n = 0;
const uniq = (p: string) => `${p}${++n}`;

beforeAll(async () => {
  t = await freshApp();
});
afterAll(() => t.close());

const auditRows = (action: string, objectId: number) =>
  t.owner`select * from audit_log where action = ${action} and object_id = ${String(objectId)} order by id`;
const sid = (cookie: string) => sessionKey(cookie.slice(4));

describe('sign-on through core', () => {
  it('PL-01: the API refuses requests without a session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/master/products' })).statusCode).toBe(401);
  });

  it('PL-01: /login sends the browser to core with PKCE; sign-on opens a session with the permissions from core and is audited', async () => {
    const id = await seedUser(t.owner, uniq('op'), ['truebatch.batch.operate']);
    const username = `op${n}`;
    const start = await t.app.inject({ method: 'GET', url: `/login?login_hint=${username}` });
    expect(start.statusCode).toBe(302);
    const { res, cookie } = await login(t.app, username);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect((await call(t.app, cookie, 'GET', '/api/me')).json()).toEqual({ id, username, fullName: username.toUpperCase(), permissions: ['truebatch.batch.operate'] });
    expect(await auditRows('login', id)).toHaveLength(1);
  });

  it('PL-01: the oidc client asks core for a code with PKCE, this product\'s permissions and, for a signature, a fresh password', async () => {
    const { oidcSignOn } = await import('../server/signon.js');
    const s = oidcSignOn({ issuer: 'https://site.test/oidc', clientId: 'truebatch', clientSecret: 'x', redirectUri: 'https://truebatch.site.test/cb' });
    const url = new URL(s.authUrl({ state: 'st', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://site.test/oidc/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'truebatch', response_type: 'code', code_challenge: 'ch',
      code_challenge_method: 'S256', state: 'st', redirect_uri: 'https://truebatch.site.test/cb', scope: 'openid profile permissions' });
    expect(new URL(s.authUrl({ state: 'st', challenge: 'ch', prompt: 'login' })).searchParams.get('max_age')).toBe('0');
  });

  it('PL-01: a person without a TrueBatch permission is refused and the refusal is audited', async () => {
    const id = await seedUser(t.owner, uniq('nobody'), []);
    const { res, cookie } = await login(t.app, `nobody${n}`);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('no right to use TrueBatch Tablets');
    expect(cookie).toBe('');
    expect(await auditRows('login.failed', id)).toHaveLength(1);
  });

  it('PL-01: permissions come from core only; codes of another product or unknown codes give no right', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    directory.get(`op${n}`)!.permissions.push('logbook.audit.read', 'truebatch.unknown');
    const { cookie } = await login(t.app, `op${n}`);
    expect((await call(t.app, cookie, 'GET', '/api/me')).json().permissions).toEqual(['truebatch.view']);
  });

  it('PL-01: each action checks its own permission code, whatever else the person holds', async () => {
    // A guarded action of the shape every TrueBatch route uses (no domain routes exist yet).
    const app = await buildApp({ sql: t.sql, signOn: fakeSignOn(), proofKey: TEST_PROOF_KEY, master: fakeMaster(), webRoot: '/nonexistent' });
    app.post('/api/test/release', { preHandler: requirePermission('truebatch.qa.release') }, async () => ({ ok: true }));
    await seedUser(t.owner, uniq('op'), ['truebatch.batch.operate', 'truebatch.batch.check', 'truebatch.batch.supervise', 'truebatch.qc.approve']);
    const op = (await login(app, `op${n}`)).cookie;
    await seedUser(t.owner, uniq('qa'), ['truebatch.qa.release']);
    const qa = (await login(app, `qa${n}`)).cookie;
    expect((await call(app, op, 'POST', '/api/test/release')).statusCode).toBe(403);
    expect((await call(app, qa, 'POST', '/api/test/release')).statusCode).toBe(200);
    expect((await call(app, op, 'GET', '/api/master/products')).statusCode).toBe(200);   // reading needs any code
    await app.close();
  });

  it('PL-01: a sign-in this browser did not start is refused (no login CSRF)', async () => {
    await seedUser(t.owner, uniq('qa'), ['truebatch.qa.release']);
    const made = await t.app.inject({ method: 'GET', url: `/cb?code=qa${n}&state=made-up` });
    expect(made.statusCode).toBe(400);
    // Someone else's started sign-in, sent to this browser (which holds no matching sign-in cookie).
    const theirs = await t.app.inject({ method: 'GET', url: `/login?login_hint=qa${n}` });
    const res = await t.app.inject({ method: 'GET', url: String(theirs.headers.location) });
    expect(res.statusCode).toBe(400);
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });

  it(`PL-01: a revoked permission or a deactivated person is out within ${POLICY.roleCheckMinutes} minutes (renewal through core)`, async () => {
    await seedUser(t.owner, uniq('sup'), ['truebatch.batch.supervise', 'truebatch.view']);
    const username = `sup${n}`;
    const { cookie } = await login(t.app, username);
    directory.get(username)!.permissions = ['truebatch.view'];
    expect((await call(t.app, cookie, 'GET', '/api/me')).json().permissions).toContain('truebatch.batch.supervise');
    await t.owner`update sessions set checked_at = now() - interval '6 minutes' where id = ${sid(cookie)}`;
    expect((await call(t.app, cookie, 'GET', '/api/me')).json().permissions).toEqual(['truebatch.view']);

    directory.get(username)!.active = false;
    await t.owner`update sessions set checked_at = now() - interval '6 minutes' where id = ${sid(cookie)}`;
    expect((await call(t.app, cookie, 'GET', '/api/me')).statusCode).toBe(401);
    expect(await t.owner`select 1 from sessions where id = ${sid(cookie)}`).toHaveLength(0);
  });

  it('PL-05: /sign asks core for the signed-in person\'s password again and hands the sign window a signing proof', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.batch.operate']);
    const { cookie } = await login(t.app, `op${n}`);
    expect((await t.app.inject({ method: 'GET', url: '/sign?meanings=performed' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/sign?meanings=anything', headers: { cookie } })).statusCode).toBe(400);
    const start = await t.app.inject({ method: 'GET', url: '/sign?meanings=performed', headers: { cookie } });
    expect(start.statusCode).toBe(302);
    expect(new URL(String(start.headers.location), 'http://x').searchParams.get('code')).toBe(`op${n}`);   // login_hint: this person
    const pending = start.cookies.find((c) => c.name === 'signon')!;
    expect(pending.value).toMatch(/\.sign\.\d+\.performed$/);
    const page = await t.app.inject({ method: 'GET', url: String(start.headers.location), headers: { cookie: `signon=${pending.value}` } });
    expect(page.body).toMatch(/"signProof":"[^"]+"/);
    expect(page.body).toContain('location.origin');   // posted only to TrueBatch's own window
    expect(page.cookies.find((c) => c.name === 'sid')).toBeUndefined();   // a signature never opens a session
    expect(page.headers['cache-control']).toBe('no-store');
  });

  it('PL-05: a signature is refused when core did not ask for the password again after it started (auth_time)', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.batch.operate']);
    const { cookie } = await login(t.app, `op${n}`);
    const start = await t.app.inject({ method: 'GET', url: '/sign?meanings=performed', headers: { cookie } });
    const pending = start.cookies.find((c) => c.name === 'signon')!;
    // As if core answered from its existing session: the password was last entered before this signature started.
    const old = pending.value.replace(/\.sign\.\d+\./, `.sign.${Date.now() + 60_000}.`);
    const page = await t.app.inject({ method: 'GET', url: String(start.headers.location), headers: { cookie: `signon=${old}` } });
    expect(page.body).toContain('Your password was not asked for again');
    expect(page.body).not.toContain('signProof');
  });

  it(`PL-01: a session expires after ${POLICY.sessionIdleMinutes} idle minutes`, async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    const { cookie } = await login(t.app, `op${n}`);
    await t.owner`update sessions set last_seen_at = now() - interval '16 minutes' where id = ${sid(cookie)}`;
    expect((await call(t.app, cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('PL-01: logout ends the session and sends the browser to end the core session too (one person per browser)', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    const { cookie } = await login(t.app, `op${n}`);
    const out = await call(t.app, cookie, 'POST', '/api/logout');
    expect(out.json().logoutUrl).toBe(`/?signed-out=id-op${n}`);
    expect((await call(t.app, cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('PL-01: logout after the session went idle still ends the core session', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    const idle = (await login(t.app, `op${n}`)).cookie;
    await t.owner`update sessions set last_seen_at = now() - interval '16 minutes' where id = ${sid(idle)}`;
    expect((await call(t.app, idle, 'POST', '/api/logout')).json().logoutUrl).toBe(`/?signed-out=id-op${n}`);
    expect(await t.owner`select 1 from sessions where id = ${sid(idle)}`).toHaveLength(0);
  });

  it('writes without a JSON body type are refused', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/logout', headers: { 'content-type': 'text/plain' }, payload: 'x' });
    expect(res.statusCode).toBe(415);
  });

  it('PL-01: session ids are stored only as hashes', async () => {
    await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    const { cookie } = await login(t.app, `op${n}`);
    const raw = cookie.slice(4);
    expect(await t.owner`select 1 from sessions where id = ${raw}`).toHaveLength(0);
    expect(await t.owner`select 1 from sessions where id = ${sessionKey(raw)}`).toHaveLength(1);
  });

  it('PL-01: background polling does not keep an idle session alive', async () => {
    await seedUser(t.owner, uniq('qa'), ['truebatch.qa.release']);
    const { cookie } = await login(t.app, `qa${n}`);
    await t.owner`update sessions set last_seen_at = now() - interval '14 minutes' where id = ${sid(cookie)}`;
    const bg = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie, 'x-background-poll': '1' } });
    expect(bg.statusCode).toBe(200);
    const [row] = await t.owner`select now() - last_seen_at > interval '13 minutes' as stale from sessions where id = ${sid(cookie)}`;
    expect(row!.stale).toBe(true);
  });

  it('PL-01: the application database role cannot rename a person or delete one', async () => {
    const id = await seedUser(t.owner, uniq('op'), ['truebatch.view']);
    await expect(t.sql`update users set username = 'renamed' where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(t.sql`update users set employee_id = gen_random_uuid() where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(t.sql`delete from users where id = ${id}`).rejects.toThrow(/permission denied/);
  });
});
