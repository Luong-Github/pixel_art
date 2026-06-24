import { test, expect } from '@playwright/test';

/**
 * Smoke E2E — proves the real app boots and the core screens render.
 * Seeded from BEH-* in docs/business/BEHAVIORS.md (first-draw entry, editor canvas).
 */

test('home page shows a Launch CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /launch/i }).first()).toBeVisible();
});

test('editor loads and shows the drawing canvas', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.locator('canvas.stage')).toBeVisible({ timeout: 20_000 });
});
