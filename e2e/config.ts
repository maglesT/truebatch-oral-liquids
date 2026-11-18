import type { Permission } from '../server/auth.js';

// Overridable so two working copies can run their browser tests side by side.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8291);
export const E2E_SCHEMA = process.env.E2E_SCHEMA ?? 'e2e';
// Recruitment's stand-in training_v1 (e2e/server.ts).
export const E2E_RECRUITMENT = `${E2E_SCHEMA}_rc`;
// TrueBatch Liquids Packing's browser journey: its own server, schema and people (packing codes from core).
export const E2E_PACKING_PORT = Number(process.env.E2E_PACKING_PORT ?? E2E_PORT + 1);
export const E2E_PACKING_SCHEMA = `${E2E_SCHEMA}_packing`;
const pk = (...c: string[]) => c.map((x) => `truebatch_liquids_packing.${x}` as const);
export const PACKING_USERS = {
  pauthor: pk('master.author'), pcheck: pk('master.check'), pqa: pk('master.approve', 'qa.release'), pqa2: pk('master.approve'),
  piss: pk('batch.issue'), pop: pk('batch.operate'), pchk: pk('batch.check'), psup: pk('batch.supervise'), pqc: pk('qc.approve'),
};
// Invented test people and the TrueBatch permissions core gives them.
export const USERS: Record<string, Permission[]> = {
  op1: ['truebatch_liquids.batch.operate'],
  chk1: ['truebatch_liquids.batch.check'],
  qa1: ['truebatch_liquids.qa.release', 'truebatch_liquids.master.approve'],
  // Makes a version effective when the change control was typed by hand (no QMS link).
  qa2: ['truebatch_liquids.master.approve'],
  // The release journey: production supervisor and QC.
  sup1: ['truebatch_liquids.batch.supervise'],
  qc1: ['truebatch_liquids.qc.approve'],
  // Writes the fixture master and issues the batch of the floor journey.
  iss1: ['truebatch_liquids.master.author', 'truebatch_liquids.batch.issue'],
  // The master designer journey: an author and a second-person checker (qa1 approves).
  author1: ['truebatch_liquids.master.author'],
  mcheck1: ['truebatch_liquids.master.check'],
  norole: [],
};
