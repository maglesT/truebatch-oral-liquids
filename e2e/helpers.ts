import { expect, type Locator, type Page } from '@playwright/test';

// Sign-on goes through Medhanta core; the test server's stand-in signs in whoever login_hint names.
export async function logIn(page: Page, username: string) {
  await page.goto(`/login?login_hint=${encodeURIComponent(username)}`);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  // The browser goes on to core's sign-out page (here the stand-in's, on the app itself).
  await page.waitForURL(/signed-out=/);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}

/** The element is wholly in view and above the sticky action bar of a step screen (not partly hidden behind it). */
export async function clearOfActionBar(page: Page, what: Locator) {
  await expect(what).toBeVisible();
  await expect.poll(async () => {
    const box = (await what.boundingBox())!;
    const bar = (await page.locator('.action-bar').boundingBox())!;
    return box.y >= 0 && box.y + box.height <= bar.y;
  }).toBe(true);
}

/** Scrolls so the element sits just above the sticky action bar, as on a tablet scrolled down to the field. */
export async function justAboveActionBar(what: Locator) {
  await what.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - (document.querySelector('.action-bar')!.getBoundingClientRect().top - 4)));
}

/** A window wholly on the screen: within the viewport, with nothing in it scrolled out of sight. */
export async function wholeOnScreen(page: Page, what: Locator) {
  await expect(what).toBeVisible();
  const view = page.viewportSize()!;
  await expect.poll(async () => {
    const box = (await what.boundingBox())!;
    const hidden = await what.evaluate((el) => el.scrollHeight - el.clientHeight);
    const whole = box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height && hidden <= 1;
    return whole ? 'whole' : `at ${box.y}, ${box.height} px high (${hidden} px scrolled out of sight) in ${view.height} px`;
  }).toBe('whole');
}
