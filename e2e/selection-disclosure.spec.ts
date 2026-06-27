import { test, expect } from '@playwright/test';

/**
 * Contextual-disclosure regression (AC-03-2). Guards the recent selection-bar
 * changes: with NO selection the selection-only actions (Copy / Cut / →Layer)
 * are absent and Paste is disabled (clipboard empty) — never a silent no-op.
 * After making a marquee selection, those actions appear. Asserts the DOM state
 * a user actually sees (titles + disabled), robust to the welcome overlay.
 *
 * Titles come from the `sel.*` en dictionary; the buttons render via [title].
 */

async function dismissWelcome(page: import('@playwright/test').Page) {
  // Deterministic: the first-run welcome shows on every fresh e2e context. Wait
  // for it to actually appear (it can lag under parallel load), dismiss it, then
  // wait for it to detach so its overlay can't intercept later clicks.
  const skip = page.locator('.welcome-skip');
  await skip.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await skip.count()) {
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  }
}

test('selection bar reveals selection-only actions only after a selection exists', async ({ page }) => {
  await page.goto('/editor');
  await dismissWelcome(page);

  const canvas = page.locator('canvas.stage');
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  const copyBtn = page.locator('.selection-bar button[title^="Copy"]').first();
  const cutBtn = page.locator('.selection-bar button[title^="Cut"]').first();
  const pasteBtn = page.locator('.selection-bar button[title^="Paste"]').first();
  const toLayerBtn = page.locator('.selection-bar button.sel-btn').first();

  // --- No selection: Copy/Cut/→Layer hidden, Paste present but disabled. ---
  await expect(copyBtn).toHaveCount(0);
  await expect(cutBtn).toHaveCount(0);
  await expect(toLayerBtn).toHaveCount(0);
  await expect(pasteBtn).toBeVisible();
  await expect(pasteBtn).toBeDisabled();
  await expect(page.locator('.selection-bar .sel-hint')).toHaveText(/no selection/i);

  // --- Activate the Select (marquee) tool via its tool button, then drag. ---
  await page.locator('button[aria-label^="Select"]').first().click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 20 });
  await page.mouse.up();

  // --- Selection exists: Copy/Cut/→Layer now visible. ---
  await expect(copyBtn).toBeVisible();
  await expect(cutBtn).toBeVisible();
  await expect(toLayerBtn).toBeVisible();
  await expect(page.locator('.selection-bar .sel-hint')).not.toHaveText(/no selection/i);

  // --- Copy populates the clipboard → Paste becomes enabled. ---
  await copyBtn.click();
  await expect(pasteBtn).toBeEnabled();
});
