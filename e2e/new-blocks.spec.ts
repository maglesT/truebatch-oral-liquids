import { expect, test, type Page } from '@playwright/test';
import { connect } from '../server/db.js';
import { TEST_DATABASE_URL, handLabels } from '../test/helpers.js';
import { small } from '../test/engine-fixture.js';
import { E2E_SCHEMA } from './config.js';
import { logIn } from './helpers.js';

// Round 46: the device assembly block in the master designer and on the floor (Liquids has no roller compaction).

const pct = (low: string, high: string) => ({ low, high, unit: '%' });
const DEVICE = { component: { formula: 'x' }, theoretical: '1000 units', functionSample: '5', level: 'II', criticalAql: '0', majorAql: '0.65', minorAql: '2.5',
  yieldLimit: pct('97.0', '100.5'), accountabilityLimit: pct('99.0', '100.5'), componentLimit: pct('99.0', '100.5') };
// One stage: the device assembly (a yield step, so the stage needs no other).
const stages = () => small([
  { name: 'Assembly', steps: [{ key: 'assemble', block: { id: 'device-assembly', version: 1 }, checker: true, settings: DEVICE }] },
]);

async function sign(page: Page) {
  await page.getByRole('dialog').last().getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('the designer offers the device assembly block: added from the library, their limits asked by the master check, described in the plain view', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await logIn(page, 'author1');
  const doc = small([{ name: 'Assembly', steps: [{ key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: pct('97.0', '100.5') } }] }]);
  const m = await page.request.post('/api/masters', { data: { doc } });
  expect(m.ok(), await m.text()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Master records' }).click();
  await page.getByRole('row', { name: /PRD-050.*Draft/ }).last().getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await page.getByRole('button', { name: '+ Add a step' }).click();
  await page.getByLabel('Search the block library').fill('device');
  await expect(page.locator('.library .pick-list button')).toHaveCount(1);
  await page.getByRole('button', { name: /Device assembly/ }).click();
  await expect(page.getByRole('heading', { name: 'Device assembly' })).toBeVisible();
  const check = page.getByRole('complementary', { name: 'Master check' });
  await expect(check).toContainText('Theoretical number of devices is not set');
  await page.getByLabel('Inspection level').selectOption('II');
  await expect(page.locator('.settings-col')).toContainText(/devices tested for function must be at least/i);
  await page.getByRole('button', { name: 'Review and approval' }).click();
  await expect(page.locator('.plain-view')).toContainText('The devices that failed the function test must be 0: none allowed.');
  await expect(page.locator('.plain-view')).toContainText('The AQL inspection is a sample of the good devices assembled at inspection level II, with AQL (not set) for a critical defect');
  await expect(page.locator('.plain-view')).toContainText('The components used is the components issued minus the components returned to stores.');
});

test('on the floor: a device assembly shows its function test, AQL and accountability, and is checked', async ({ browser }) => {
  // Issue: the fixture master written through the API and made effective by the database owner (as in floor.spec.ts).
  const iss = await (await browser.newContext()).newPage();
  await logIn(iss, 'iss1');
  const m = await iss.request.post('/api/masters', { data: { doc: stages() } });
  expect(m.ok(), await m.text()).toBe(true);
  const { id: masterId } = (await m.json()) as { id: number };
  const owner = connect(TEST_DATABASE_URL, { searchPath: E2E_SCHEMA });
  for (const s of ['in_review', 'approved', 'effective']) await owner`update master_versions set state = ${s} where id = ${masterId}`;
  await owner.end();
  await iss.goto('/');
  await iss.getByRole('button', { name: 'Master records' }).click();
  await iss.getByRole('row', { name: /PRD-050/ }).last().getByRole('button', { name: 'Issue a batch' }).click();
  await iss.getByRole('button', { name: 'Next: sign' }).click();
  await sign(iss);
  await iss.waitForURL(/#\/batch\/\d+$/);
  const batch = { id: Number(/#\/batch\/(\d+)$/.exec(iss.url())![1]), batchNo: (await iss.locator('.bno').textContent())! };

  // The device assembly: recorded through the API (a lot and the line typed by hand, MMS and the Logbook absent here),
  // then shown and signed on the screen, and checked by a second person.
  const op = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await logIn(op, 'op1');
  await op.goto(`/#/batch/${batch.id}`);
  const key = '0.1.0.1';
  const post = async (p: Page, action: string, data: object = {}) => {
    const r = await p.request.post(`/api/batches/${batch.id}/steps/${key}/${action}`, { data });
    expect(r.ok(), `${action}: ${await r.text()}`).toBe(true);
  };
  await post(op, 'start');
  await post(op, 'record', { values: { lot: 'AI-HSG-2601', ...handLabels('lot', 'lot'), machine: 'eq-al', ...handLabels('machine', 'machine'),
    issued: '1010', unitsIn: '1000', tested: '5', failed: '0', works: 'yes', complete: 'yes', inspected: '80', critical: '0', major: '0', minor: '1',
    good: '980', rejected: '10', samples: '5', componentRejects: '5', returned: '5' } });
  await op.reload();
  await op.getByRole('button', { name: /Device assembly/ }).click();
  const r2 = op.getByRole('region', { name: 'Results' });
  for (const text of ['AQL inspection', 'Sample 80 of 980', 'Yield', '98.0 %', 'Accountability of the units fed', 'Accountability of the component', 'Components used']) await expect(r2).toContainText(text);
  await expect(r2).not.toContainText('Out of limits');
  await op.getByRole('button', { name: 'Done', exact: true }).click();
  await sign(op);
  await expect(op.locator('.step-title')).toContainText('Waiting for check');

  const chk = await (await browser.newContext()).newPage();
  await logIn(chk, 'chk1');
  await chk.getByRole('region', { name: 'Waiting for your check' }).getByRole('button', { name: /Device assembly/ }).click();
  await expect(chk.getByRole('region', { name: 'What was recorded' })).toContainText('AI-HSG-2601');
  await chk.getByRole('button', { name: 'Checked', exact: true }).click();
  await sign(chk);
  await expect(chk.locator('.step-title')).toContainText('Checked');
});
