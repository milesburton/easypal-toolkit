import { expect, test } from '@playwright/test';

test('renders the DRM Studio heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /DRM Studio/i })).toBeVisible();
});

test('renders encoder and decoder drop zones', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Choose File/i })).toHaveCount(2);
});
