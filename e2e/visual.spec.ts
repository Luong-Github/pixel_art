import { test, expect } from '@playwright/test';

/**
 * Visual regression — screenshots compared against committed baselines.
 * Baselines are OS-specific, so this is NOT part of `npm run e2e` (CI runs on Linux).
 *   npm run e2e:visual         compare against baselines
 *   npm run e2e:visual:update  regenerate baselines (after an intended visual change)
 * Run on the same OS the baselines were generated on.
 */
test.describe('@visual', () => {
  for (const path of ['/', '/pricing', '/guide']) {
    test(`page ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot({ fullPage: true, animations: 'disabled' });
    });
  }

  test('editor chrome', async ({ page }) => {
    await page.goto('/editor');
    const skip = page.locator('.welcome-skip');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(page.locator('canvas.stage')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Empty canvas + default dock layout is deterministic; small tolerance for AA.
    await expect(page).toHaveScreenshot({ animations: 'disabled', maxDiffPixelRatio: 0.02 });
  });
});
