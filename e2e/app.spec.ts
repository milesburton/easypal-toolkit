import { expect, test } from '@playwright/test';

test('renders the EasyPal Toolkit heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /EasyPal Toolkit/i })).toBeVisible();
});

test('renders the decoder drop zone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Choose File/i })).toBeVisible();
});

test('shows error when no audio API available (worker stub)', async ({ page }) => {
  await page.goto('/');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'test.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt '),
  });
  await expect(page.locator('.text-red-400')).toBeVisible({ timeout: 10000 });
});
