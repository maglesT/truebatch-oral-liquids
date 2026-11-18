// Starts the real app with the built UI on a fresh database schema for the browser tests. The test people are seeded;
// master data is an in-memory stand-in.
import { connect } from '../server/db.js';
import { migrate } from '../db/migrate.js';
import { buildApp } from '../server/app.js';
import globalSetup from '../test/global-setup.js';
import { TEST_DATABASE_URL, TEST_PROOF_KEY, fakeMaster, fakeSignOn, seedUser } from '../test/helpers.js';
import { E2E_PORT, E2E_RECRUITMENT, E2E_SCHEMA, USERS } from './config.js';
import { links } from '../server/links.js';
import { seedMasterData } from './master-data.js';

await globalSetup();
const owner = connect(TEST_DATABASE_URL);
await owner.unsafe(`drop schema if exists ${E2E_SCHEMA} cascade`);
await owner.unsafe(`create schema ${E2E_SCHEMA}`);
await owner.end();

const schemaOwner = connect(TEST_DATABASE_URL, { searchPath: E2E_SCHEMA });
await migrate(schemaOwner);
for (const [username, permissions] of Object.entries(USERS)) await seedUser(schemaOwner, username, permissions);
await schemaOwner.end();

// The product and material of the small fixture master (test/engine-fixture.ts, small()).
const master = fakeMaster();
master.products_.push({ itemId: 'p', code: 'PRD-050', name: 'Demolol 50 mg tablets', version: 1, active: true, strength: null, dosageForm: 'tablet' });
master.materials_.push({ itemId: 'm', code: 'MAT-010', name: 'Demolol', version: 1, active: true, category: null, unit: 'kg' });
// The designer journey's products, materials, equipment and rooms.
seedMasterData(master);

// Recruitment's training_v1 (only trained people sign, owner 17 Nov 2026), a stand-in table in its own schema read with
// the app's login; the other links are absent. op1 is trained in SOP-STR-004; chk1 is not.
const rc = connect(TEST_DATABASE_URL);
await rc.unsafe(`drop schema if exists ${E2E_RECRUITMENT} cascade; create schema ${E2E_RECRUITMENT};
  create table ${E2E_RECRUITMENT}.training_v1 (person_id uuid, person_login text, person_name text, skill_code text, skill_title text, trained_on date,
    valid_until date, qualified boolean, approved_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now());
  insert into ${E2E_RECRUITMENT}.training_v1 (person_login, person_name, skill_code, skill_title, trained_on, valid_until, qualified) values
    ('op1', 'Operator One', 'SOP-STR-004', 'Operating the stirrer', '2026-01-10', '2099-01-09', true);
  grant usage on schema ${E2E_RECRUITMENT} to truebatch_app; grant select on all tables in schema ${E2E_RECRUITMENT} to truebatch_app;`);
await rc.end();

const sql = connect(TEST_DATABASE_URL, { role: 'truebatch_app', searchPath: E2E_SCHEMA });
const app = await buildApp({ sql, signOn: fakeSignOn(), proofKey: TEST_PROOF_KEY, master,
  links: links({ recruitment: connect(TEST_DATABASE_URL, { role: 'truebatch_app', link: true }) }, { recruitment: E2E_RECRUITMENT }),
  webRoot: new URL('../dist/web', import.meta.url).pathname, cookieSecure: false });
await app.listen({ port: E2E_PORT, host: '127.0.0.1' });
