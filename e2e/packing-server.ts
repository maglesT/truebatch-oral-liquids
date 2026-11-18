// Starts TrueBatch Tablets Packing with its built UI on a fresh schema of the test database, for its browser journey,
// with a stand-in for TrueBatch Tablets' batch_fact_v1 (two released bulk batches, with their good tablets). Master data is an in-memory stand-in.
// The Logbook's equipment_status_v1 is stood in too, knowing line BL-01 only (dirty); its link is down (no grant) until
// the journey grants it for its pick-list check (e2e/packing.spec.ts).
import { connect } from '../server/db.js';
import { migrate } from '../db/migrate.js';
import { buildApp } from '../server/app.js';
import { links } from '../server/links.js';
import { PACKING_APP_ROLE, PACKING_PLAN } from '../packing/migrate.js';
import { PACKING } from '../packing/product.js';
import globalSetup from '../test/global-setup.js';
import { TEST_DATABASE_URL, TEST_PROOF_KEY, fakeMaster, fakeSignOn, seedUser } from '../test/helpers.js';
import { E2E_PACKING_PORT, E2E_PACKING_SCHEMA, PACKING_USERS } from './config.js';

const S = E2E_PACKING_SCHEMA;
await globalSetup();
const owner = connect(TEST_DATABASE_URL);
await owner.unsafe(`drop schema if exists ${S} cascade; drop schema if exists ${S}_report cascade; drop schema if exists ${S}_tb cascade; drop schema if exists ${S}_lb cascade; create schema ${S}; create schema ${S}_tb; create schema ${S}_lb;
  create table ${S}_tb.batch_fact_v1 (batch_number text, product_code text, record_kind text, status text, issued_at timestamptz, completed_at timestamptz, released boolean,
    read_at timestamptz default now(), data_as_of timestamptz default now(), manufactured_on date, good_quantity numeric);
  insert into ${S}_tb.batch_fact_v1 values ('TB260001', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-02 06:00+00', '2026-11-08 06:00+00', true, now(), now(), '2026-11-03', 100000),
    ('TB260002', 'PRD-001', 'PROCESSING', 'RELEASED', '2026-11-04 06:00+00', '2026-11-09 06:00+00', true, now(), now(), '2026-11-05', 60000);
  grant usage on schema ${S}_tb to ${PACKING_APP_ROLE}; grant select on all tables in schema ${S}_tb to ${PACKING_APP_ROLE};
  create table ${S}_lb.equipment_status_v1 (master_id text, code text, kind text, state text, fit_for_use boolean, blockers text[], warnings text[], in_use_batch text,
    cleaned_at timestamptz, cleaned_by text, checked_at timestamptz default now(), read_at timestamptz default now(), data_as_of timestamptz default now());
  insert into ${S}_lb.equipment_status_v1 (master_id, code, kind, state, fit_for_use, blockers, warnings) values
    ('ln-1', 'BL-01', 'equipment', 'dirty', false, '{"Dirty: clean and verify before the next use."}', '{}');
  grant usage on schema ${S}_lb to ${PACKING_APP_ROLE};`);
await owner.end();

const schemaOwner = connect(TEST_DATABASE_URL, { searchPath: S });
await migrate(schemaOwner, PACKING_PLAN);
for (const [username, permissions] of Object.entries(PACKING_USERS)) await seedUser(schemaOwner, username, permissions);
await schemaOwner.end();

const master = fakeMaster();
const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
// Master data's kind: the pack and the bulk it is packed from; PRD-002 has no kind yet (offered in both lists).
master.products_.push({ ...item('pk-1', 'PK-001', 'Examplol 100 mg tablets, 10 x 10 blister'), strength: '100 mg', dosageForm: 'tablet', kind: 'pack' },
  { ...item('prd-1', 'PRD-001', 'Examplol 100 mg tablets'), strength: '100 mg', dosageForm: 'tablet', kind: 'bulk' },
  { ...item('prd-2', 'PRD-002', 'Examplol 200 mg tablets'), strength: '200 mg', dosageForm: 'tablet' });
master.materials_.push({ ...item('pm-foil', 'PM-101', 'Printed aluminium foil'), category: 'packing', unit: 'm' },
  { ...item('pm-ctn', 'PM-103', 'Carton'), category: 'packing', unit: 'nos' });
master.equipment_.push({ ...item('ln-1', 'BL-01', 'Blister line 1'), kind: 'equipment', type: 'blister line', room: 'PK-01' },
  { ...item('ln-2', 'BL-02', 'Blister line 2'), kind: 'equipment', type: 'blister line', room: 'PK-01' });
// The line stands in a packing room (the packing stages allow the Packing area).
master.rooms_.splice(0, master.rooms_.length, { ...item('rm-pk1', 'PK-01', 'Packing hall 1'), area: 'Packing', grade: 'D' });

const sql = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, searchPath: S });
const bulk = connect(TEST_DATABASE_URL, { role: PACKING_APP_ROLE, link: true });
const app = await buildApp({ sql, signOn: fakeSignOn(), proofKey: TEST_PROOF_KEY, master, links: links({ truebatch: bulk, logbook: bulk }, { truebatch: `${S}_tb`, logbook: `${S}_lb` }),
  webRoot: new URL('../dist/packing-web', import.meta.url).pathname, cookieSecure: false, product: PACKING });
await app.listen({ port: E2E_PACKING_PORT, host: '127.0.0.1' });
