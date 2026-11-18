import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '../server/auth.js';
import { authenticateSigner, contentHash, sign, SignError, type Meaning } from '../server/signatures.js';
import { call, freshApp, login, proofFor, seedUser, TEST_PROOF_KEY, type TestApp } from './helpers.js';

// PL-05: an e-signature needs core's fresh re-authentication of the signed-in person (a signing proof), the permission
// code its meaning needs, and the exact content the signer saw; it is stored with name, meaning and server time.
// PL-06: signatures are insert-only, and a signed row of a record table is locked.

let t: TestApp;
let n = 0;
beforeAll(async () => {
  t = await freshApp();
  // A record table as TrueBatch's domain migrations will make them: drafts editable, locked once signed.
  await t.owner`create table step (id bigint primary key, value text not null)`;
  await t.owner`create trigger step_locked_when_signed before update or delete on step for each row execute function refuse_change_when_signed('step')`;
  await t.owner`grant select, insert, update, delete on step to truebatch_app`;
});
afterAll(() => t.close());

async function signer(permissions: Parameters<typeof seedUser>[2]) {
  const username = `signer${++n}`;
  const id = await seedUser(t.owner, username, permissions);
  const { cookie } = await login(t.app, username);
  const me = (await call(t.app, cookie, 'GET', '/api/me')).json();
  const user: SessionUser = { id, username, fullName: me.fullName, permissions: me.permissions, sessionId: cookie.slice(4) };
  return { user, username, cookie };
}

// The proof the sign window gets: /sign, core's password prompt (stand-in), /cb.
async function proofThroughCore(cookie: string, meaning: Meaning) {
  const start = await t.app.inject({ method: 'GET', url: `/sign?meanings=${meaning}`, headers: { cookie } });
  const pending = start.cookies.find((c) => c.name === 'signon')!;
  const page = await t.app.inject({ method: 'GET', url: String(start.headers.location), headers: { cookie: `signon=${pending.value}` } });
  return /"signProof":"([^"]+)"/.exec(page.body)![1]!;
}

async function signStep(user: SessionUser, proof: string, stepId: number, meaning: Meaning, shown?: string) {
  const content = (await t.sql<{ value: string }[]>`select value from step where id = ${stepId}`)[0]!;
  const who = await authenticateSigner(t.sql, TEST_PROOF_KEY, user, { proof }, { objectType: 'step', objectId: stepId, meaning });
  return t.sql.begin((tx) => sign(tx, { signer: who, shownHash: shown ?? contentHash('step', stepId, content), objectType: 'step', objectId: stepId, meaning, content }));
}

describe('e-signatures', () => {
  it('PL-05: a signature with a proof from core is recorded with name, meaning, server time and content hash, and audited', async () => {
    const { user, cookie } = await signer(['truebatch.batch.operate']);
    await t.sql`insert into step (id, value) values (1, 'Granulation end point 12.5 kW')`;
    const s = await signStep(user, await proofThroughCore(cookie, 'performed'), 1, 'performed');
    const [row] = await t.owner`select * from signatures where id = ${s.id}`;
    expect(row).toMatchObject({ object_type: 'step', object_id: '1', user_id: String(user.id), printed_name: user.fullName, meaning: 'performed',
      content_hash: contentHash('step', 1, { value: 'Granulation end point 12.5 kW' }) });
    expect(Math.abs(Date.now() - new Date(row!.signed_at).getTime())).toBeLessThan(60_000);
    expect(await t.owner`select 1 from audit_log where action = 'signed.performed' and object_id = '1'`).toHaveLength(1);
  });

  it('PL-05: a proof is spent once; using it again is refused and audited', async () => {
    const { user, cookie } = await signer(['truebatch.batch.operate']);
    await t.sql`insert into step (id, value) values (2, 'a'), (3, 'b')`;
    const proof = await proofThroughCore(cookie, 'performed');
    await signStep(user, proof, 2, 'performed');
    await expect(signStep(user, proof, 3, 'performed')).rejects.toBeInstanceOf(SignError);
    expect(await t.owner`select 1 from audit_log where action = 'signature.failed' and object_id = '3' and reason like '%proof already used'`).toHaveLength(1);
  });

  it('PL-05: another person\'s proof, a proof without the meaning\'s permission, a stale proof or a forged one is refused', async () => {
    const a = await signer(['truebatch.batch.operate']);
    const b = await signer(['truebatch.batch.operate']);
    const viewer = await signer(['truebatch.view']);
    await t.sql`insert into step (id, value) values (4, 'c')`;
    await expect(signStep(a.user, proofFor(b.username), 4, 'performed')).rejects.toThrow('wrong_credentials');
    await expect(signStep(viewer.user, proofFor(viewer.username), 4, 'performed')).rejects.toThrow('wrong_credentials');
    await expect(signStep(a.user, proofFor(a.username, Date.now() - 10 * 60_000), 4, 'performed')).rejects.toThrow('wrong_credentials');
    await expect(signStep(a.user, `${proofFor(a.username).split('.')[0]}.forged`, 4, 'performed')).rejects.toThrow('wrong_credentials');
    await expect(signStep(a.user, proofFor(a.username, undefined, ['verified']), 4, 'performed')).rejects.toThrow('wrong_credentials');
    const reasons = (await t.owner<{ reason: string }[]>`select reason from audit_log where action = 'signature.failed' and object_id = '4' order by id`).map((r) => r.reason);
    expect(reasons).toEqual(['meaning performed: signed by another person', 'meaning performed: no truebatch.batch.operate at core',
      'meaning performed: proof expired', 'meaning performed: invalid proof', 'meaning performed: proof for another meaning']);
    expect(await t.owner`select 1 from signatures where object_id = 4`).toHaveLength(0);
  });

  it('PL-05: a signature is refused when the content changed since the signer saw it', async () => {
    const { user, username } = await signer(['truebatch.batch.check']);
    await t.sql`insert into step (id, value) values (5, 'shown')`;
    const shown = contentHash('step', 5, { value: 'shown' });
    await t.sql`update step set value = 'changed' where id = 5`;
    await expect(signStep(user, proofFor(username), 5, 'verified', shown)).rejects.toThrow('content_changed');
  });

  it('PL-06: the app role cannot change or delete a signature', async () => {
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);
    expect(await code(t.sql`update signatures set meaning = 'released'`)).toBe('42501');
    expect(await code(t.sql`delete from signatures`)).toBe('42501');
    expect(await code(t.sql`insert into signatures (object_type, object_id, user_id, printed_name, meaning, content_hash, signed_at)
      values ('step', 9, 1, 'X', 'performed', ${'0'.repeat(64)}, now() - interval '1 day')`)).toBe('42501');
  });

  it('PL-06: a signed record row is locked; an unsigned draft row can still be changed', async () => {
    const { user, username } = await signer(['truebatch.batch.operate']);
    await t.sql`insert into step (id, value) values (6, 'draft'), (7, 'to sign')`;
    await t.sql`update step set value = 'draft 2' where id = 6`;
    await signStep(user, proofFor(username), 7, 'performed');
    await expect(t.sql`update step set value = 'after' where id = 7`).rejects.toThrow(/step 7 is signed and cannot be changed/);
    await expect(t.sql`delete from step where id = 7`).rejects.toThrow(/signed/);
    await expect(t.owner`update step set value = 'after' where id = 7`).rejects.toThrow(/signed/);
  });
});
