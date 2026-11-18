import { expect, test, type Browser, type Page } from '@playwright/test';
import { connect } from '../server/db.js';
import { TEST_DATABASE_URL } from '../test/helpers.js';
import { small } from '../test/engine-fixture.js';
import { E2E_SCHEMA } from './config.js';
import { logIn } from './helpers.js';

// QC approval and QA release in the browser, on a batch made complete through the API: a pH check out of limits with
// a deviation (DEV-26-021) and the stage yield, approved by production.

/** A signed-in person's browser, with its signing proofs (as the sign window gets them from the stand-in for core). */
async function person(browser: Browser, username: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await logIn(page, username);
  const proof = async (meaning: string) => {
    const r = await page.request.get(`/sign?meanings=${meaning}`);
    return /"signProof":"([^"]+)"/.exec(await r.text())![1]!;
  };
  return { ctx, page, proof };
}

/** A batch issued from a small effective master, nothing done yet. */
async function issuedBatch(browser: Browser): Promise<{ id: number; batchNo: string }> {
  const iss = await person(browser, 'iss1');
  const doc = small([{ name: 'Blending', steps: [{ checker: true },
    { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } }] }]);
  doc.header.productName = 'Demolol 50 mg tablets';
  const { id: mv } = await (await iss.page.request.post('/api/masters', { data: { doc } })).json() as { id: number };
  const owner = connect(TEST_DATABASE_URL, { searchPath: E2E_SCHEMA });
  for (const s of ['in_review', 'approved', 'effective']) await owner`update master_versions set state = ${s} where id = ${mv}`;
  await owner.end();
  const batch = await (await iss.page.request.post('/api/batches', { data: { masterVersionId: mv, proof: await iss.proof('issued') } })).json() as { id: number; batchNo: string };
  await iss.ctx.close();
  return batch;
}

async function productionApprovedBatch(browser: Browser): Promise<{ id: number; batchNo: string }> {
  const batch = await issuedBatch(browser);

  const op = await person(browser, 'op1');
  const chk = await person(browser, 'chk1');
  const hash = async (p: Page, key?: string) => {
    const b = await (await p.request.get(`/api/batches/${batch.id}`)).json() as { batch: { contentHash: string }; steps: { id: string; contentHash: string }[] };
    return key ? b.steps.find((s) => s.id === key)!.contentHash : b.batch.contentHash;
  };
  const step = async (who: typeof op, key: string, action: string, body: object = {}) => {
    const r = await who.page.request.post(`/api/batches/${batch.id}/steps/${key}/${action}`, { data: body });
    expect(r.ok(), `${action} ${key}: ${await r.text()}`).toBe(true);
  };
  const signed = async (who: typeof op, key: string, action: 'done' | 'check') =>
    step(who, key, action, { proof: await who.proof(action === 'done' ? 'performed' : 'verified'), contentHash: await hash(who.page, key) });
  await step(op, '0.1.0.1', 'start');
  await step(op, '0.1.0.1', 'record', { values: { reading: '7.4' } });
  await step(op, '0.1.0.1', 'note', { text: 'pH 7.4 after the buffer addition', reference: 'DEV-26-021' });
  await signed(op, '0.1.0.1', 'done');
  await signed(chk, '0.1.0.1', 'check');
  await step(op, '0.1.1.1', 'start');
  await step(op, '0.1.1.1', 'record', { values: { output: '0.099', samples: '0.000', rejects: '0.001' } });
  await signed(op, '0.1.1.1', 'done');
  await signed(chk, '0.1.1.1', 'check');
  const sup = await person(browser, 'sup1');
  const pa = await sup.page.request.post(`/api/batches/${batch.id}/production-approve`, { data: { proof: await sup.proof('production_approved'), contentHash: await hash(sup.page) } });
  expect(pa.ok(), await pa.text()).toBe(true);
  for (const p of [op, chk, sup]) await p.ctx.close();
  return batch;
}

/** Signs in the open sign dialog: the sign window opens, the stand-in for core confirms, the window closes. */
async function sign(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('TB-22 release journey: QC approves with its report number, QA reviews, closes the deviation, releases, and the batch record PDF downloads', async ({ browser }) => {
  const batch = await productionApprovedBatch(browser);

  // QC: the To review tab lists the batch; QC signs with the QC report number.
  const qc = await person(browser, 'qc1');
  await qc.page.getByRole('button', { name: 'To review' }).click();
  await qc.page.getByRole('region', { name: 'Waiting for QC approval' }).getByRole('button', { name: new RegExp(batch.batchNo) }).click();
  await expect(qc.page.getByRole('region', { name: 'Review of the record and its audit trail' })).toContainText('DEV-26-021');
  await expect(qc.page.getByRole('button', { name: 'Sign: QC approved' })).toBeDisabled();
  await qc.page.getByLabel('QC report number').fill('QC-26-0107');
  await qc.page.getByRole('button', { name: 'Sign: QC approved' }).click();
  await sign(qc.page);
  await expect(qc.page.getByRole('status')).toContainText('QC approval signed');
  await expect(qc.page.locator('.bh')).toContainText('QC approved');
  await qc.ctx.close();

  // QA: release is refused in plain words while the deviation is open; QA closes it with a reason, then releases.
  const qa = await person(browser, 'qa1');
  await qa.page.getByRole('button', { name: 'To review' }).click();
  await qa.page.getByRole('region', { name: 'Waiting for QA release' }).getByRole('button', { name: new RegExp(batch.batchNo) }).click();
  const review = qa.page.getByRole('region', { name: 'Review of the record and its audit trail' });
  await expect(review.locator('li.bad').first()).toContainText('Blending › Check a value against limits: pH');
  await expect(review).toContainText('limit 5.0 to 7.0: OUT OF LIMITS');
  await expect(review).toContainText('99.0 %');
  await expect(review).toContainText('QC approved');
  await expect(qa.page.getByRole('note')).toContainText('Deviation DEV-26-021 (Blending › Check a value against limits: pH) is open: close it first.');
  await expect(qa.page.getByRole('button', { name: 'Sign: released' })).toBeDisabled();
  await qa.page.getByRole('button', { name: 'Close the deviation…' }).click();
  await qa.page.getByLabel('Reason for closing').fill('Buffer lot re-tested; pH within limits after the investigation');
  await qa.page.getByRole('button', { name: 'Close the deviation', exact: true }).click();
  await expect(review).toContainText('Closed by QA1');
  // SHOTS=<folder>: a picture of the release screen for the docs (the sticky bar is unpinned for a full-page picture).
  if (process.env.SHOTS) {
    await qa.page.addStyleTag({ content: '.bar { position: static; }' });
    await qa.page.screenshot({ path: `${process.env.SHOTS}/release-screen.png`, fullPage: true });
  }
  await qa.page.getByRole('button', { name: 'Sign: released' }).click();
  await expect(qa.page.getByRole('dialog')).toContainText('audit trail');
  await sign(qa.page);
  await expect(qa.page.getByRole('status')).toContainText('The batch is released.');
  await expect(qa.page.locator('.bh')).toContainText('Released');

  // The batch record PDF.
  const [download] = await Promise.all([qa.page.waitForEvent('download'), qa.page.getByRole('link', { name: 'Batch record (PDF)' }).last().click()]);
  expect(download.suggestedFilename()).toBe(`batch-record-${batch.batchNo}.pdf`);
  const path = await download.path();
  const { readFileSync, copyFileSync } = await import('node:fs');
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  if (process.env.SHOTS) copyFileSync(path, `${process.env.SHOTS}/batch-record.pdf`);
  await qa.page.getByRole('button', { name: '← To review' }).click();
  await expect(qa.page.getByRole('region', { name: 'Waiting for QA release' })).not.toContainText(batch.batchNo);
  await qa.ctx.close();
});

test('TB-21 QA terminates a batch still in production from the To review list: a reason, a signature; the batch screen says who, when and why', async ({ browser }) => {
  const batch = await issuedBatch(browser);
  // The first step was performed and waits for its second-person check when QA terminates.
  const op = await person(browser, 'op1');
  const step = async (key: string, action: string, body: object = {}) => expect((await op.page.request.post(`/api/batches/${batch.id}/steps/${key}/${action}`, { data: body })).ok()).toBe(true);
  await step('0.1.0.1', 'start');
  await step('0.1.0.1', 'record', { values: { reading: '6.0' } });
  const hash = (await (await op.page.request.get(`/api/batches/${batch.id}`)).json() as { steps: { id: string; contentHash: string }[] }).steps.find((s) => s.id === '0.1.0.1')!.contentHash;
  await step('0.1.0.1', 'done', { proof: await op.proof('performed'), contentHash: hash });
  await op.ctx.close();
  const qa = await person(browser, 'qa1');
  await qa.page.getByRole('button', { name: 'To review' }).click();
  const inProduction = qa.page.getByRole('region', { name: 'In production' });
  await expect(inProduction).toContainText(batch.batchNo);
  if (process.env.SHOTS) await qa.page.screenshot({ path: `${process.env.SHOTS}/to-review-in-production.png`, fullPage: true });
  await inProduction.locator('.pending-row', { hasText: batch.batchNo }).getByRole('button', { name: 'Terminate batch' }).click();
  // Nothing was issued to the batch: the window asks nothing about materials.
  await expect(qa.page.getByRole('dialog')).toBeVisible();
  await expect(qa.page.getByRole('group', { name: 'Back to stores' })).toHaveCount(0);
  await qa.page.getByLabel('Reason for terminating').fill('The pH meter failed and no other is qualified: the batch cannot be finished');
  await qa.page.getByRole('button', { name: 'Continue to sign' }).click();
  await expect(qa.page.getByRole('dialog')).toContainText('Sign: Rejected');
  await sign(qa.page);
  await expect(inProduction).not.toContainText(batch.batchNo);
  await qa.page.goto(`/#/batch/${batch.id}`);
  await expect(qa.page.getByRole('note')).toContainText(/^Terminated by QA1 at \d{1,2} \w{3}, \d\d:\d\d IST: The pH meter failed/);
  await expect(qa.page.locator('.bh')).toContainText('Rejected');
  await expect(qa.page.getByRole('button', { name: 'Terminate batch' })).toHaveCount(0);
  await expect(qa.page.getByRole('region', { name: 'Production approval' })).toHaveCount(0);
  // The batch runs no more: no stage is "now"; the stages left unclosed say Terminated. The batch size is the master's.
  const stages = qa.page.getByRole('navigation', { name: 'Stages' });
  await expect(stages).toContainText('Terminated');
  await expect(stages.locator('small', { hasText: /^(Now|Open|Waiting)$/ })).toHaveCount(0);
  await expect(qa.page.locator('.bh')).toContainText('Batch size');
  // Its steps never read as still to come (owner, 16 Nov 2026): "Terminated, not started", no "Ready to start" or "Waits for".
  const steplist = qa.page.locator('.steplist');
  await expect(steplist).toContainText('Terminated, not started');
  await expect(steplist.locator('.chip', { hasText: /^(Waiting|Ready to start|In progress|Waiting for check)$/ })).toHaveCount(0);
  await expect(steplist).not.toContainText('Waits for');
  if (process.env.SHOTS) await qa.page.screenshot({ path: `${process.env.SHOTS}/batch-terminated.png`, fullPage: true });
  // The step left waiting for its check: no "Waiting for a second person" (owner, 16 Nov 2026).
  await steplist.locator('.step-row').first().click();
  await expect(qa.page.locator('.step-title .chip').first()).toHaveText('Terminated, not checked');
  await expect(qa.page.getByRole('region', { name: 'What was recorded' })).toBeVisible();
  await expect(qa.page.getByText(/Waiting for a second person|a second person checks it/)).toHaveCount(0);
  await qa.page.goto(`/#/batch/${batch.id}`);
  await steplist.locator('.step-row').nth(1).click();
  await expect(qa.page.locator('.step-title .chip').first()).toHaveText('Terminated, not started');
  await expect(qa.page.getByText('Not open yet')).toHaveCount(0);
  await qa.ctx.close();
});
