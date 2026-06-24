import { test, expect } from '@playwright/test';

/**
 * Visual demo E2E — does real actions so it's watchable with:
 *   SLOWMO=700 npx playwright test --headed --workers=1 e2e/editor.demo.spec.ts
 * Flow: dismiss welcome → pick Pen → draw a stroke → open Adjust (Ctrl+L) → nudge a slider.
 */
test('draw a stroke then tweak Adjust', async ({ page }) => {
  await page.goto('/editor');

  // First-run welcome overlays the canvas — dismiss it.
  const skip = page.locator('.welcome-skip');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }

  const canvas = page.locator('canvas.stage');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // Select the Pen tool and draw a little zig-zag.
  await page.keyboard.press('p');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 25 });
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.75, { steps: 25 });
  await page.mouse.up();

  // Open the Adjust panel and nudge the first slider — preview updates live.
  await page.keyboard.press('Control+l');
  const panel = page.locator('.adj-panel');
  await expect(panel).toBeVisible();
  const slider = panel.locator('input[type="range"]').first();
  await slider.focus();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('ArrowRight');
  }

  await expect(panel).toBeVisible();
});
