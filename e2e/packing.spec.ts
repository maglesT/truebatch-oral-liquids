import { expect, test, type Browser, type Page } from '@playwright/test';
import { connect } from '../server/db.js';
import { PACKING_APP_ROLE } from '../packing/migrate.js';
import { TEST_DATABASE_URL } from '../test/helpers.js';
import { E2E_PACKING_PORT, E2E_PACKING_SCHEMA } from './config.js';
import { clearOfActionBar, justAboveActionBar, logIn, wholeOnScreen } from './helpers.js';

// TrueBatch Tablets Packing in the browser: a packing master built in the designer from the packing skeleton (its
// materials picked from master data), checked and approved; a packing batch issued from the released bulk batch of
// TrueBatch Tablets; the record run (the first step on the floor screen, the rest through the API); then QC approval
// with the QC report number, QA release and the packing record PDF.

const baseURL = `http://127.0.0.1:${E2E_PACKING_PORT}`;
test.use({ baseURL });

async function person(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ baseURL, viewport });
  const page = await ctx.newPage();
  await logIn(page, username);
  const proof = async (meaning: string) => /"signProof":"([^"]+)"/.exec(await (await page.request.get(`/sign?meanings=${meaning}`)).text())![1]!;
  return { ctx, page, proof };
}
async function sign(page: Page) {
  await page.getByRole('dialog').last().getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const masters = async (page: Page) => page.getByRole('button', { name: 'Packing masters' }).click();

test('TB-P2 packing journey: packing master from the skeleton, approved; a packing batch from the released bulk batch, run, QC approved, then QA released; the packing record PDF', async ({ browser }) => {
  // The author: a new packing master for the pack, from the packing skeleton.
  const author = await person(browser, 'pauthor');
  await expect(author.page.locator('.brand')).toContainText('TrueBatch Tablets Packing');
  await masters(author.page);
  // The product's own words: the page is headed as its tab.
  await expect(author.page.getByRole('heading', { level: 1 })).toHaveText('Packing masters');
  await author.page.getByRole('button', { name: 'New master' }).click();
  // The pack is picked from master data's packs, the bulk from its bulk products (and those without a kind yet).
  await expect(author.page.locator('.picker').first().locator('.pick b')).toHaveText(['PK-001', 'PRD-002']);
  await expect(author.page.locator('.picker').nth(1).locator('.pick b')).toHaveText(['PRD-001', 'PRD-002']);
  await author.page.getByLabel('Pack product').fill('PK-001');
  await author.page.locator('.picker').first().getByRole('button', { name: /PK-001/ }).click();
  await author.page.getByLabel('Bulk product').fill('PRD-001');
  await author.page.getByRole('button', { name: /PRD-001/ }).click();
  await author.page.getByLabel('Packs per carton').fill('10');
  await author.page.getByLabel('Standard packing batch (tablets)').fill('100000');
  await author.page.getByLabel('Tablet weight (mg)').fill('250.0');
  await author.page.getByLabel('MRP per pack').fill('125.00');
  await author.page.getByText('Process skeleton: Packing record').click();
  await author.page.getByRole('button', { name: 'Create draft' }).click();
  await expect(author.page.getByRole('heading', { name: 'PK-001 · Examplol 100 mg tablets, 10 x 10 blister' })).toBeVisible();

  // Its packing materials, picked from master data: the printed foil and carton carry the batch coding.
  await author.page.getByRole('button', { name: 'Packing materials', exact: true }).click();
  for (const [code, name, kind] of [['PM-101', 'Printed aluminium foil', 'foil'], ['PM-103', 'Carton', 'carton']]) {
    await author.page.getByRole('button', { name: '+ Add a packing material' }).click();
    await author.page.getByLabel('Packing material').fill(code!);
    await author.page.getByRole('button', { name: new RegExp(code!) }).click();
    await author.page.getByLabel(`Kind of ${name}`).selectOption(kind!);
    await author.page.getByLabel(`${name} is printed`).check();
    await author.page.getByLabel(`${name} carries the batch coding`).check();
  }
  await author.page.getByLabel('Unit of Printed aluminium foil').selectOption('m');
  const check = author.page.getByRole('complementary', { name: 'Master check' });
  await expect(check).toContainText('Printed aluminium foil has no issue step');
  await author.page.getByRole('button', { name: 'Add their issue and reconciliation steps' }).click();
  await expect(check).not.toContainText('has no issue step');

  // The product's limits, from the master check.
  await check.getByRole('button', { name: /Sealing temperature limits is not set/ }).click();
  await author.page.getByLabel('Sealing temperature limits: lowest').fill('160');
  await author.page.getByLabel('Sealing temperature limits: highest').fill('190');
  // The forming temperature is recorded: the check asks for its limits too (a temperature recorded without a check).
  await check.getByRole('button', { name: /Forming temperature is recorded but not checked/ }).click();
  await author.page.getByLabel('Forming temperature limits: lowest').fill('120');
  await author.page.getByLabel('Forming temperature limits: highest').fill('150');
  await check.getByRole('button', { name: /Vacuum limits is not set/ }).click();
  await author.page.getByLabel('Vacuum limits: lowest').fill('400');
  await author.page.getByLabel('Vacuum limits: highest').fill('600');
  await expect(check).toContainText('No problems');
  await expect(author.page.getByRole('status')).toHaveText('All changes saved');
  await author.page.getByRole('button', { name: 'Review and approval' }).click();
  // The plain view names each step's packing material by its name and code, and a count as master data names it (nos).
  await expect(author.page.locator('.review')).toContainText(/Carton \(PM-103\), carton: [\d.]+ nos per pack/);
  await expect(author.page.locator('.review')).toContainText('Packing material: Carton (PM-103). Unit: nos.');
  await expect(author.page.locator('.review')).toContainText('Packing material: Printed aluminium foil (PM-101). Unit: m.');
  await expect(author.page.locator('.review')).not.toContainText('the batch quantity of');
  await author.page.getByRole('button', { name: 'Send for review' }).click();
  await sign(author.page);
  await expect(author.page.locator('.d-title')).toContainText('In review');
  await author.ctx.close();

  // Checked by a second person, approved by QA, made effective by another QA person (no QMS link: typed change control).
  for (const [who, button] of [['pcheck', 'Pass the check'], ['pqa', 'Approve'], ['pqa2', 'Make effective']] as const) {
    const p = await person(browser, who);
    await masters(p.page);
    await p.page.getByRole('row', { name: /PK-001/ }).getByRole('button', { name: 'Open' }).click();
    await p.page.getByRole('button', { name: button }).click();
    if (button === 'Approve') {
      await p.page.getByLabel('Change control number').fill('CC-2026-077');
      await p.page.getByRole('button', { name: 'Continue to sign' }).click();
    }
    if (button === 'Make effective') await p.page.getByRole('dialog').getByRole('button', { name: 'Make effective' }).click();
    else await sign(p.page);
    await expect(p.page.locator('.d-title')).toContainText({ 'Pass the check': 'In review', Approve: 'Approved', 'Make effective': 'Effective' }[button]);
    await p.ctx.close();
  }

  // The packing batch, issued on the packing masters screen from the released bulk batch TB260001 (picked from TrueBatch
  // Tablets) on line BL-01.
  const iss = await person(browser, 'piss');
  await masters(iss.page);
  const issue = iss.page.getByRole('dialog', { name: 'Issue a batch' });
  // While the Logbook answers, the line picker offers only the lines it has (BL-01, not BL-02); a picker with choices
  // has no "not offered" note. The Logbook's reason for refusing a dirty line reads as one sentence, with one full stop.
  const lb = connect(TEST_DATABASE_URL);
  await lb.unsafe(`grant select on ${E2E_PACKING_SCHEMA}_lb.equipment_status_v1 to ${PACKING_APP_ROLE}`);
  try {
    await iss.page.getByRole('row', { name: /Effective/ }).getByRole('button', { name: 'Issue a batch' }).click();
    await expect(issue.getByRole('group', { name: 'Packing line' }).getByRole('button')).toHaveText([/BL-01/]);
    await expect(issue.getByText(/Not offered, because the Logbook does not have/)).toHaveCount(0);
    await issue.getByRole('group', { name: 'Packing line' }).getByRole('button', { name: /BL-01/ }).click();
    await issue.getByLabel('Bulk batch no.').fill('TB260001');
    // Pull, don't type: the tablets issued are what is left of the bulk batch's good tablets, from TrueBatch Tablets,
    // offered in the field; less may be typed (a part issue), more is refused.
    await expect(issue.getByLabel('Bulk tablets issued')).toHaveValue('100000');
    await expect(issue.getByText('Left to issue of TB260001: 1,00,000 tablets (1,00,000 good tablets in TrueBatch Tablets). Issue all of it, or type less for a part issue.')).toBeVisible();
    await issue.getByLabel('Bulk tablets issued').fill('100001');
    await issue.getByRole('button', { name: 'Next: sign' }).click();
    await iss.page.getByRole('dialog').last().getByRole('button', { name: 'Sign', exact: true }).click();
    await expect(issue.getByRole('alert')).toContainText('BL-01 is not fit for use (Logbook): Dirty: clean and verify before the next use.');
    await expect(issue.getByRole('alert')).toContainText('Only 100000 tablets of bulk batch TB260001 are left to issue (100000 good tablets, 0 already issued to other packing batches): issue 100000 or less.');
    await issue.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await lb.unsafe(`revoke select on ${E2E_PACKING_SCHEMA}_lb.equipment_status_v1 from ${PACKING_APP_ROLE}`);
    await lb.end();
  }
  // The Logbook link down: every line is offered again, and the line's status labels are asked for.
  await iss.page.getByRole('row', { name: /Effective/ }).getByRole('button', { name: 'Issue a batch' }).click();
  await expect(issue.getByRole('group', { name: 'Packing line' }).getByRole('button')).toHaveText([/BL-01/, /BL-02/]);
  await issue.getByRole('group', { name: 'Packing line' }).getByRole('button', { name: /BL-01/ }).click();
  await expect(issue.locator('datalist option[value="TB260001"]')).toHaveCount(1);
  await issue.getByLabel('Bulk batch no.').fill('TB260001');
  await issue.getByRole('button', { name: 'Next: sign' }).click();
  await iss.page.getByRole('dialog').last().getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(issue.getByRole('alert')).toContainText('the status label says clean, within its clean hold is not recorded');
  for (const g of await issue.getByRole('group', { name: /^Packing line: / }).all()) await g.getByRole('button', { name: 'Yes' }).click();
  await issue.getByRole('button', { name: 'Next: sign' }).click();
  await sign(iss.page);
  await iss.page.waitForURL(/#\/batch\/\d+$/);
  const batch = { id: Number(/#\/batch\/(\d+)$/.exec(iss.page.url())![1]), batchNo: (await iss.page.locator('.bno').textContent())! };
  await iss.ctx.close();

  // The operator receives the bulk on the floor screen: the bulk batch and its date of manufacture come from TrueBatch Tablets.
  const op = await person(browser, 'pop');
  const chk = await person(browser, 'pchk');
  await op.page.getByRole('button', { name: new RegExp(`${batch.batchNo} · Examplol 100 mg tablets, 10 x 10 blister`) }).click();
  await expect(op.page.getByRole('navigation', { name: 'Stages' })).toContainText('Issue to the line');
  await op.page.getByRole('button', { name: /^1 Bulk tablets issued to the line/ }).click();
  await expect(op.page.locator('main')).toContainText('TB260001');
  await expect(op.page.locator('main')).toContainText('From TrueBatch Tablets: TrueBatch Tablets batch TB260001: RELEASED, PRD-001, manufactured 3 Nov 2026');
  await op.page.getByRole('group', { name: 'Containers closed and intact, labels show this bulk batch and RELEASED' }).getByRole('button', { name: 'Yes' }).click();
  await expect(op.page.getByRole('region', { name: 'Results' })).toContainText('expiry 10/2028');
  await op.page.getByRole('button', { name: 'Done', exact: true }).click();
  await sign(op.page);

  // The rest of the record through the API: each step started, recorded, signed and (where needed) checked.
  type Detail = { batch: { contentHash: string }; steps: { id: string; state: string; actions: string[]; contentHash: string }[] };
  const detail = async (p: Page) => (await (await p.request.get(`/api/batches/${batch.id}`)).json()) as Detail;
  const post = async (who: typeof op, key: string, action: string, data: object = {}) => {
    const r = await who.page.request.post(`/api/batches/${batch.id}/steps/${key}/${action}`, { data });
    expect(r.ok(), `${action} ${key}: ${await r.text()}`).toBe(true);
  };
  const run = async (key: string, values: Record<string, string>) => {
    if ((await detail(op.page)).steps.find((s) => s.id === key)!.actions.includes('start')) await post(op, key, 'start');
    await post(op, key, 'record', { values });
    await post(op, key, 'done', { proof: await op.proof('performed'), contentHash: (await detail(op.page)).steps.find((s) => s.id === key)!.contentHash });
    const s = (await detail(chk.page)).steps.find((x) => x.id === key)!;
    if (s.state === 'done_awaiting_check') await post(chk, key, 'check', { proof: await chk.proof('verified'), contentHash: s.contentHash });
  };
  await post(chk, '0.1.0.1', 'check', { proof: await chk.proof('verified'), contentHash: (await detail(chk.page)).steps[0]!.contentHash });
  const lot = (n: string) => ({ lot: n, 'lot.released': 'yes', 'lot.expiry': '2099-12-31' });
  const yes = (...n: string[]) => Object.fromEntries(n.map((x) => [x, 'yes']));
  const labels = { 'line.clean': 'yes', 'line.calibrated': 'yes', 'line.inService': 'yes', 'line.qualified': 'yes' };
  const line = { line: 'ln-1', ...labels };
  await run('0.1.1.1', { ...lot('FOIL-1'), issued: '1250', matches: 'yes' });
  await run('0.1.2.1', { ...lot('CTN-1'), issued: '1000', matches: 'yes' });
  await run('1.1.0.1', { ...line, ...yes('noPrevious', 'coderCleared', 'rejectsEmpty', 'clean'), cleanedOn: '2026-11-15 07:00', cleanedBy: 'CLEANER ONE' });
  await run('1.1.1.1', yes('components', 'changeParts', 'coderSet', 'specimens'));
  await run('1.1.2.1', { printedBatch: 'TB260001', printedMfg: '11/2026', printedExpiry: '10/2028', printedMrp: 'Rs. 125.00', ...yes('legible', 'packingDone') });
  await run('1.1.3.1', { sealTemp: '175', ...yes('pockets', 'seal', 'packingDone') });
  await run('1.1.4.1', { vacuum: '500', tested: '20', leaking: '0', packingDone: 'yes' });
  await run('1.1.5.1', yes('appearance', 'complete', 'samplesKept', 'packingDone'));
  await run('1.1.6.1', { cartons: '10', ...yes('leaflet', 'count', 'coded', 'packingDone') });
  await run('2.1.0.1', { packs: '9800', cartons: '980', samples: '40', returnedWeight: '0.375', rejectWeight: '0.125' });
  await run('2.1.1.1', { used: '1176', destroyed: '20', returned: '54' });
  await run('2.1.2.1', { used: '984', destroyed: '6', returned: '10' });
  await run('2.1.3.1', { what: 'Foil 20 m, cartons 6', method: 'shredded', destroyed: 'yes' });
  await run('2.1.4.1', { ...line, ...yes('noLeftover', 'coderCleared', 'leftoversDone') });
  await op.ctx.close();
  await chk.ctx.close();
  const sup = await person(browser, 'psup');
  const pa = await sup.page.request.post(`/api/batches/${batch.id}/production-approve`, { data: { proof: await sup.proof('production_approved'), contentHash: (await detail(sup.page)).batch.contentHash } });
  expect(pa.ok(), await pa.text()).toBe(true);
  await sup.ctx.close();

  // QC signs first: the batch waits for QC approval after production approval, not for QA.
  const qc = await person(browser, 'pqc');
  await qc.page.getByRole('button', { name: 'To review' }).click();
  await qc.page.getByRole('region', { name: 'Waiting for QC approval' }).getByRole('button', { name: new RegExp(batch.batchNo) }).click();
  await expect(qc.page.getByText('the finished packed product was tested and complies with its specification')).toBeVisible();
  await expect(qc.page.getByRole('button', { name: 'Sign: QC approved' })).toBeDisabled();
  await qc.page.getByLabel('QC report number').fill('QC-26-0101');
  await qc.page.getByRole('button', { name: 'Sign: QC approved' }).click();
  await sign(qc.page);
  await expect(qc.page.getByRole('status')).toContainText('QC approval signed');
  await expect(qc.page.locator('.bh')).toContainText('QC approved');
  await qc.ctx.close();

  // QA: then the batch waits for QA release; QA releases it.
  const qa = await person(browser, 'pqa');
  await qa.page.getByRole('button', { name: 'To review' }).click();
  await qa.page.getByRole('region', { name: 'Waiting for QA release' }).getByRole('button', { name: new RegExp(batch.batchNo) }).click();
  await expect(qa.page.getByRole('region', { name: 'Review of the record and its audit trail' })).toContainText('Bulk tablets issued to the line');
  // Whole-suite run, S24: TrueBatch Tablets publishes no deviation notes here (the link does not answer), so the bulk
  // batch's deviations are not checked: QA checks them in the Deviations system and types what was found.
  await expect(qa.page.getByRole('region', { name: 'Review of the record and its audit trail' })).toContainText('Bulk deviations not checked (TrueBatch Tablets link down): bulk batch TB260001');
  await expect(qa.page.getByRole('button', { name: 'Sign: released' })).toBeDisabled();
  await qa.page.getByLabel(/Bulk deviations not checked/).fill('Checked in the Deviations system: none open for TB260001');
  await qa.page.getByRole('button', { name: 'Sign: released' }).click();
  await expect(qa.page.getByRole('dialog')).toContainText('Bulk deviations, typed by hand: Checked in the Deviations system: none open for TB260001');
  await sign(qa.page);
  await expect(qa.page.getByRole('status')).toContainText('The batch is released.');
  await expect(qa.page.getByRole('region', { name: 'Decision' })).toContainText('QA confirmed by hand (typed): Checked in the Deviations system: none open for TB260001');
  const [download] = await Promise.all([qa.page.waitForEvent('download'), qa.page.getByRole('link', { name: 'Packing record (PDF)' }).last().click()]);
  expect(download.suggestedFilename()).toBe(`packing-record-${batch.batchNo}.pdf`);
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe('%PDF-');
  await qa.ctx.close();
});

test('TB-21 QA terminates a packing batch after materials were issued: the window, whole on the screen, asks what went back to stores of each lot, shown with the termination; a refusal on the step screen is not hidden behind the action bar', async ({ browser }) => {
  const tablet = { width: 1366, height: 900 };
  // A packing batch on line BL-01 (free again after the journey), its bulk received and checked, through the API.
  const iss = await person(browser, 'piss');
  const mv = ((await (await iss.page.request.get('/api/masters')).json()) as { id: number; state: string }[]).find((v) => v.state === 'effective')!.id;
  const labels = { 'line.clean': 'yes', 'line.calibrated': 'yes', 'line.inService': 'yes', 'line.qualified': 'yes' };
  const res = await iss.page.request.post('/api/batches', { data: { masterVersionId: mv, proof: await iss.proof('issued'), values: { line: 'ln-1', ...labels, bulk: 'TB260002' } } });
  expect(res.ok(), await res.text()).toBe(true);
  const batch = await res.json() as { id: number; batchNo: string };
  await iss.ctx.close();
  const op = await person(browser, 'pop', tablet);
  const chk = await person(browser, 'pchk');
  type Detail = { steps: { id: string; state: string; actions: string[]; contentHash: string }[] };
  const step = async (p: Page, key: string) => ((await (await p.request.get(`/api/batches/${batch.id}`)).json()) as Detail).steps.find((s) => s.id === key)!;
  const post = async (who: typeof op, key: string, action: string, data: object = {}) => {
    const r = await who.page.request.post(`/api/batches/${batch.id}/steps/${key}/${action}`, { data });
    expect(r.ok(), `${action} ${key}: ${await r.text()}`).toBe(true);
  };
  const signed = async (key: string) => {
    await post(op, key, 'done', { proof: await op.proof('performed'), contentHash: (await step(op.page, key)).contentHash });
    const s = await step(chk.page, key);
    if (s.state === 'done_awaiting_check') await post(chk, key, 'check', { proof: await chk.proof('verified'), contentHash: s.contentHash });
  };
  const lot = (n: string) => ({ lot: n, 'lot.released': 'yes', 'lot.expiry': '2099-12-31' });
  await post(op, '0.1.0.1', 'record', { values: { received: 'yes' } });
  await signed('0.1.0.1');
  await post(op, '0.1.1.1', 'start');
  await post(op, '0.1.1.1', 'record', { values: { ...lot('FOIL-2'), issued: '1250', matches: 'yes' } });
  await signed('0.1.1.1');
  await post(op, '0.1.2.1', 'start');
  await post(op, '0.1.2.1', 'record', { values: { ...lot('CTN-2'), matches: 'yes' } });

  // The carton issue on the line's tablet: the quantity in the material's unit (nos, as MMS and its refusals say), and
  // a refusal under the field shown in full, above the sticky Done bar.
  await op.page.goto(`/#/batch/${batch.id}/step/0.1.2.1`);
  const quantity = op.page.locator('.fl-field', { hasText: 'Quantity issued' });
  await expect(quantity.locator('.unit')).toHaveText('nos');
  // The step's header says the material's unit as master data names it too.
  await expect(op.page.getByRole('region', { name: 'Instruction' })).toContainText(/PM-103 · Carton \(carton, [\d.]+ nos per pack\)/);
  const refused = async () => {
    await justAboveActionBar(quantity.getByRole('textbox'));
    await quantity.getByRole('textbox').fill('105 cartons');
    await quantity.getByRole('textbox').press('Enter');
    await clearOfActionBar(op.page, quantity.getByRole('alert'));
    await quantity.getByRole('textbox').fill('');
  };
  await refused();
  // The same 1366 × 900 screen in a browser window (its tabs and address bar take some 140 px), the field scrolled down
  // to just above the bar: the refusal is scrolled up into view.
  await op.page.setViewportSize({ width: 1366, height: 760 });
  await refused();
  await op.page.setViewportSize(tablet);
  await quantity.getByRole('textbox').fill('105');
  await quantity.getByRole('textbox').press('Enter');
  await expect(quantity.getByRole('alert')).toHaveCount(0);
  await expect(quantity).toContainText('Saved');
  await post(op, '0.1.2.1', 'done', { proof: await op.proof('performed'), contentHash: (await step(op.page, '0.1.2.1')).contentHash });
  // The checker's screen waits for master data's unit: the quantity never reads "105 units" first and "105 nos" a moment later.
  let answer!: () => void;
  const held = new Promise<void>((r) => { answer = r; });
  await chk.page.route('**/api/master/materials', async (r) => { await held; await r.continue(); });
  await chk.page.goto(`/#/batch/${batch.id}/step/0.1.2.1`);
  await expect(chk.page.getByLabel('Loading the step')).toBeVisible();
  await expect(chk.page.locator('body')).not.toContainText('105 units');
  answer();
  await expect(chk.page.getByRole('region', { name: 'What was recorded' })).toContainText('105 nos');
  await expect(chk.page.locator('body')).not.toContainText('105 units');
  await post(chk, '0.1.2.1', 'check', { proof: await chk.proof('verified'), contentHash: (await step(chk.page, '0.1.2.1')).contentHash });
  await op.ctx.close();
  await chk.ctx.close();

  // QA terminates it: the window is whole on the screen, over the page, at 1366 × 900 and in a browser window (760), from
  // the batch screen and from the To review list (where the row moves on hover: the window is not held inside its card).
  const qa = await person(browser, 'pqa', tablet);
  const window = qa.page.getByRole('dialog', { name: `Terminate batch ${batch.batchNo}` });
  for (const height of [900, 760]) {
    await qa.page.setViewportSize({ width: 1366, height });
    for (const where of ['batch', 'list'] as const) {
      if (where === 'batch') await qa.page.goto(`/#/batch/${batch.id}`);
      else await qa.page.getByRole('button', { name: 'To review' }).click();
      const button = where === 'batch' ? qa.page.getByRole('button', { name: 'Terminate batch' })
        : qa.page.getByRole('region', { name: 'In production' }).locator('.pending-row', { hasText: batch.batchNo }).getByRole('button', { name: 'Terminate batch' });
      await button.click();
      await wholeOnScreen(qa.page, window.locator('form'));
      for (const what of [window.getByLabel('Reason for terminating'), window.getByLabel('Lot TB260002 back to stores'), window.getByLabel('Lot FOIL-2 back to stores'), window.getByLabel('Lot CTN-2 back to stores'), window.getByRole('button', { name: 'Continue to sign' })]) {
        await expect(what).toBeInViewport({ ratio: 1 });
      }
      if (process.env.SHOTS) await qa.page.screenshot({ path: `${process.env.SHOTS}/packing-terminate-${where}-${height}.png` });
      await window.getByRole('button', { name: 'Cancel' }).click();
      await expect(window).toHaveCount(0);
    }
  }
  await qa.page.getByRole('region', { name: 'In production' }).locator('.pending-row', { hasText: batch.batchNo }).getByRole('button', { name: 'Terminate batch' }).click();
  const back = qa.page.getByRole('group', { name: 'Back to stores' });
  // The bulk tablets issued to it first: what went back of them can be issued to another packing batch.
  await expect(back).toContainText('Lot TB260002 · bulk PRD-001 · Examplol 100 mg tablets (used 60000 tablets)');
  await expect(back).toContainText('Lot FOIL-2 · PM-101 · Printed aluminium foil (used 1250 m)');
  await expect(back).toContainText('Lot CTN-2 · PM-103 · Carton (used 105 nos)');
  await qa.page.getByLabel('Reason for terminating').fill('Blister line 1 down for repair: the batch cannot be finished');
  if (process.env.SHOTS) await qa.page.screenshot({ path: `${process.env.SHOTS}/packing-terminate-window.png` });
  await qa.page.getByRole('button', { name: 'Continue to sign' }).click();
  await expect(qa.page.getByRole('dialog').getByRole('alert')).toContainText('Say how much of lot TB260002, FOIL-2, CTN-2 went back to stores unused');
  await back.getByLabel('Lot TB260002 back to stores').fill('60000');
  await back.getByLabel('Lot FOIL-2 back to stores').fill('300');
  await back.getByLabel('Lot CTN-2 back to stores').fill('5');
  await qa.page.getByRole('button', { name: 'Continue to sign' }).click();
  await expect(qa.page.getByRole('dialog')).toContainText('Back to stores unused: lot TB260002 60000 tablets, lot FOIL-2 300 m, lot CTN-2 5 nos; the rest counts as used.');
  await wholeOnScreen(qa.page, qa.page.getByRole('dialog').locator('form'));
  await sign(qa.page);
  await expect(qa.page.getByRole('region', { name: 'In production' }).locator('.pending-row', { hasText: batch.batchNo })).toHaveCount(0);
  await qa.page.setViewportSize(tablet);
  await qa.page.goto(`/#/batch/${batch.id}`);
  await expect(qa.page.getByRole('note')).toContainText(/^Terminated by PQA at .* IST: Blister line 1 down for repair: the batch cannot be finished · Back to stores unused: lot TB260002 \(bulk PRD-001 · Examplol 100 mg tablets\) 60000 tablets, lot FOIL-2 \(PM-101 · Printed aluminium foil\) 300 m, lot CTN-2 \(PM-103 · Carton\) 5 nos; the rest counts as used$/);
  // The batch screen: the bulk tablets issued to this batch (not the master's standard batch), and no stage is "now".
  await expect(qa.page.getByRole('region', { name: 'Batch', exact: true })).toContainText('Bulk tablets issued 60,000 tablets');
  await expect(qa.page.getByRole('region', { name: 'Batch', exact: true })).not.toContainText('Batch size');
  const stages = qa.page.getByRole('navigation', { name: 'Stages' });
  await expect(stages).toContainText('Terminated');
  await expect(stages.locator('small', { hasText: /^(Now|Open|Waiting)$/ })).toHaveCount(0);
  // Its steps never read as still to come (owner, 16 Nov 2026): "Terminated, not started", no "Ready to start" or "Waits for".
  const steplist = qa.page.locator('.steplist');
  await expect(steplist).toContainText('Terminated, not started');
  await expect(steplist.locator('.chip', { hasText: /^(Waiting|Ready to start|In progress|Waiting for check)$/ })).toHaveCount(0);
  await expect(steplist).not.toContainText('Waits for');
  if (process.env.SHOTS) await qa.page.screenshot({ path: `${process.env.SHOTS}/packing-terminated-returns.png`, fullPage: true });
  await qa.ctx.close();
});
