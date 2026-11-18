import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from './db.js';
import type { SignOn } from './signon.js';

// Platform PL-01: rights are this product's permission codes from core's token, one code per action. The same list is
// declared to the platform in ops/manifest.draft.json (test/permissions.test.ts keeps the two equal).
export const PERMISSIONS = {
  'truebatch.master.author': 'Write master batch record versions',
  'truebatch.master.check': 'Check a master batch record version written by another person',
  'truebatch.master.approve': 'Approve a checked master batch record version (QA)',
  'truebatch.batch.issue': 'Issue a batch record from an approved master version',
  'truebatch.batch.operate': 'Record and sign steps of a batch as performed',
  'truebatch.batch.check': 'Check steps performed by another person (second person)',
  'truebatch.batch.supervise': 'Production approval of a completed batch record',
  'truebatch.qc.approve': 'QC approval of the results used for release',
  'truebatch.qa.release': 'QA review and release of bulk tablets',
  'truebatch.view': 'View batch records and master versions',
  'truebatch.demo.skip': 'Skip a running wait (demo installations only)',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const CODES = Object.keys(PERMISSIONS) as Permission[];

// Product defaults; not regulatory numbers. Passwords, their ageing and lockout are core's.
export const POLICY = {
  sessionIdleMinutes: 15,
  // A session's permissions are renewed from core at least this often, so a revoked right or a deactivated person is out
  // within this time (platform PL-01).
  roleCheckMinutes: 5,
};

// Background polls send this header; they must not keep an idle session alive.
export const BACKGROUND_HEADER = 'x-background-poll';

export const SESSION_COOKIE = 'sid';

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  permissions: Permission[];
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

// Only a hash of the session id is stored, so reading the table does not reveal live sessions.
export function sessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('base64url');
}

// Strict positive integer for :id route parameters.
export function parseId(raw: string): number | null {
  return /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null;
}

// Only this product's known codes count; anything else in the claim is ignored.
export const asPermissions = (codes: string[]): Permission[] => CODES.filter((c) => codes.includes(c));

// Loads the session and enforces the idle timeout; user-initiated requests refresh last_seen_at. Permissions older than
// POLICY.roleCheckMinutes are renewed from core first; if core refuses, the session ends (PL-01).
export async function loadSession(sql: Sql, signOn: SignOn, sessionId: string, touch = true): Promise<SessionUser | null> {
  const key = sessionKey(sessionId);
  const end = async () => { await sql`delete from sessions where id = ${key}`; return null; };
  // One request claims a due renewal (others go on with the current permissions); core is called outside any transaction.
  const [due] = await sql<{ refresh_token: string | null }[]>`
    update sessions set checked_at = now()
    where id = ${key} and checked_at < now() - make_interval(mins => ${POLICY.roleCheckMinutes})
      and last_seen_at > now() - make_interval(mins => ${POLICY.sessionIdleMinutes})
    returning refresh_token`;
  if (due) {
    try {
      // Core may keep the refresh token and send none back (RFC 6749 6): the stored one then stays.
      const id = await signOn.refresh(due.refresh_token ?? '');
      await sql`update sessions set permissions = ${asPermissions(id.permissions)}, refresh_token = coalesce(${id.refreshToken ?? null}, refresh_token),
                  id_token = coalesce(${id.idToken ?? null}, id_token)
                where id = ${key}`;
    } catch {
      return end();
    }
  }
  const [row] = await sql<{ id: number; username: string; full_name: string; permissions: Permission[] }[]>`
    update sessions s set last_seen_at = case when ${touch} then now() else s.last_seen_at end
    from users u
    where s.id = ${key} and u.id = s.user_id and s.last_seen_at > now() - make_interval(mins => ${POLICY.sessionIdleMinutes})
    returning u.id::int as id, u.username, u.full_name, s.permissions`;
  if (!row || !row.permissions.length) return end();
  return { id: row.id, username: row.username, fullName: row.full_name, permissions: row.permissions, sessionId };
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = req.user;
  if (!user) {
    void reply.code(401).send({ error: 'not_logged_in' });
    return null;
  }
  return user;
}

// Authority check per action, on the server: the session must hold one of the codes (none given: any session).
export function requirePermission(...codes: Permission[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (codes.length && !codes.some((c) => user.permissions.includes(c))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
