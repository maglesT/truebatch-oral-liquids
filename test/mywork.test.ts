import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshApp, login, proofFor, seedUser, type TestApp } from './helpers.js';
import { small } from './engine-fixture.js';

// GET /api/batches: "My work" on the floor screens: the batches in production with what waits for each person.

let t: TestApp;
const cookies: Record<string, string> = {};
const item = (itemId: string, c: string, name: string) => ({ itemId, code: c, name, version: 1, active: true });
const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
interface Work { id: number; batchNo: string; status: string; current: { step: string; stage: string; title: string; state: string } | null; badges: { kind: string; step?: string; title: string; at?: string }[] }
const mine = async (who: string) => (await as(who, 'GET', '/api/batches')).json() as Work[];
const step = async (id: number, key: string, who: string) =>
  ((await as(who, 'GET', `/api/batches/${id}`)).json() as { steps: { id: string; contentHash: string }[] }).steps.find((s) => s.id === key)!;
const act = (who: string, id: number, key: string, action: string, body: object = {}) => as(who, 'POST', `/api/batches/${id}/steps/${key}/${action}`, body);
const sign = async (who: string, id: number, key: string, action: string) =>
  act(who, id, key, action, { proof: proofFor(who), contentHash: (await step(id, key, who)).contentHash });

async function issue(doc: ReturnType<typeof small>) {
  const { id: mv } = (await as('author', 'POST', '/api/masters', { doc })).json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${mv}`;
  return (await as('issuer', 'POST', '/api/batches', { masterVersionId: mv, proof: proofFor('issuer') })).json() as { id: number; batchNo: string };
}

beforeAll(async () => {
  t = await freshApp();
  t.master.products_.push({ ...item('p', 'P', 'P'), strength: null, dosageForm: 'tablet' });
  t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
  t.master.equipment_.push({ ...item('eq-prs', 'PRS-01', 'Tablet press'), kind: 'equipment', type: 'tablet press', room: 'CMP-01' });
  const people = { author: ['truebatch.master.author'], issuer: ['truebatch.batch.issue'], asha: ['truebatch.batch.operate', 'truebatch.batch.check'],
    ravi: ['truebatch.batch.check'], sam: ['truebatch.batch.supervise'], viewer: ['truebatch.view'] } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(() => t.close());

describe('My work', () => {
  let b: { id: number; batchNo: string };
  beforeAll(async () => {
    b = await issue(small([{ steps: [{ checker: true }, { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]));
  });

  it('an operator sees the batch with its current step; a checker without work does not; the batch shows the server time', async () => {
    expect((await mine('asha')).find((w) => w.id === b.id)).toMatchObject({ batchNo: b.batchNo, status: 'in production',
      current: { step: '0.1.0.1', stage: 'Stage 0', title: 'Check a value against limits: pH', state: 'open' }, badges: [] });
    expect((await mine('ravi')).some((w) => w.id === b.id)).toBe(false);
    expect((await mine('viewer'))).toEqual([]);
    const now = ((await as('viewer', 'GET', `/api/batches/${b.id}`)).json() as { now: string }).now;
    expect(Math.abs(Date.parse(now) - Date.now())).toBeLessThan(60_000);
  });

  it('TB-08 the checker\'s own list: a step waiting for check is listed for a second person only, never for its performer', async () => {
    await act('asha', b.id, '0.1.0.1', 'start');
    await act('asha', b.id, '0.1.0.1', 'record', { values: { reading: '6.0' } });
    expect((await sign('asha', b.id, '0.1.0.1', 'done')).statusCode).toBe(200);
    expect((await mine('ravi')).find((w) => w.id === b.id)!.badges).toEqual([{ kind: 'check', step: '0.1.0.1', stage: 'Stage 0', title: 'Check a value against limits: pH' }]);
    expect((await mine('asha')).find((w) => w.id === b.id)!.badges).toEqual([]);
  });

  it('a corrected value asks for signing again; a complete record waits for production approval, then leaves the list', async () => {
    expect((await act('asha', b.id, '0.1.0.1', 'correct', { values: { reading: '6.1' }, reason: 'Misread the meter' })).statusCode).toBe(200);
    expect((await mine('asha')).find((w) => w.id === b.id)!.badges).toMatchObject([{ kind: 'resign', step: '0.1.0.1' }]);
    await sign('asha', b.id, '0.1.0.1', 'done');
    await sign('ravi', b.id, '0.1.0.1', 'check');
    await act('asha', b.id, '0.1.1.1', 'start');
    await act('asha', b.id, '0.1.1.1', 'record', { values: { output: '0.099', samples: '0.000', rejects: '0.001' } });
    await sign('asha', b.id, '0.1.1.1', 'done');
    expect((await mine('sam')).some((w) => w.id === b.id)).toBe(false);
    await sign('ravi', b.id, '0.1.1.1', 'check');
    const w = (await mine('sam')).find((x) => x.id === b.id)!;
    expect(w).toMatchObject({ status: 'manufacturing complete', current: null, badges: [{ kind: 'approve' }] });
    const full = (await as('sam', 'GET', `/api/batches/${b.id}`)).json() as { batch: { contentHash: string } };
    expect((await as('sam', 'POST', `/api/batches/${b.id}/production-approve`, { proof: proofFor('sam'), contentHash: full.batch.contentHash })).statusCode).toBe(200);
    expect((await mine('sam')).some((x) => x.id === b.id)).toBe(false);
  });

  it('TB-15 a compression round started shows when the next check is due', async () => {
    const c = await issue(small([{ machineTypes: ['tablet press'], steps: [{ block: { id: 'compress', version: 1 }, everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 40 },
      settings: { meanLimit: { low: '95.0', high: '105.0', unit: 'mg' }, weightBand: '5.0', weightOuterBand: '10.0', hardnessLimit: { low: '40', high: '80', unit: 'N' }, thicknessLimit: { low: '2.8', high: '3.2', unit: 'mm' } } },
    { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]));
    await act('asha', c.id, '0.1.0.1', 'start');
    const due = (await mine('asha')).find((w) => w.id === c.id)!.badges;
    expect(due).toMatchObject([{ kind: 'due', step: '0.1.0.1', stage: 'Stage 0', title: 'Compress with periodic checks' }]);
    expect(Date.parse(due[0]!.at!) - Date.now()).toBeGreaterThan(29 * 60_000);
  });
});
