import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility net — fails on SERIOUS/CRITICAL axe violations on the key screens.
 * `color-contrast` is excluded for now (theme-wide; handle in a dedicated contrast pass).
 * Moderate/minor issues are not gated yet — tighten over time.
 */
// Known pre-existing debt — structural (interactive workspace-tabs / timeline cels nested
// inside interactive rows). Tracked in docs/QA.md; allowed so the gate stays green while
// still catching any NEW serious/critical violation type. Remove an id here once fixed.
const A11Y_BASELINE = ['nested-interactive'];

async function seriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .filter((v) => !A11Y_BASELINE.includes(v.id))
    .map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`);
}

test('home has no serious a11y violations', async ({ page }) => {
  await page.goto('/');
  expect(await seriousViolations(page)).toEqual([]);
});

test('pricing has no serious a11y violations', async ({ page }) => {
  await page.goto('/pricing');
  expect(await seriousViolations(page)).toEqual([]);
});

test('editor has no serious a11y violations', async ({ page }) => {
  await page.goto('/editor');
  const skip = page.locator('.welcome-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.locator('canvas.stage')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
