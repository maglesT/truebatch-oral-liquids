import postgres from 'postgres';
import { TEST_DATABASE_URL } from './helpers.js';

// Roles are cluster-wide: create the app role once, before test files run in parallel.
export default async function setup() {
  const sql = postgres(TEST_DATABASE_URL, { onnotice: () => {} });
  // TrueBatch Tablets' app role, and TrueBatch Tablets Packing's (its own database on the platform).
  for (const role of ['truebatch_app', 'truebatch_packing_app']) {
    await sql.unsafe(`do $$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
    // The test login switches to the app role (SET ROLE), so it must be a member.
    await sql.unsafe(`grant ${role} to current_user`);
  }
  await sql.end();
}
