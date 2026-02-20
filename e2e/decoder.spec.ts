import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DSSTV1_WAV = resolve(__dirname, '../public/examples/DSSTV1.wav');

test.describe('Decoder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('DRM Studio');
  });

  test('decoder panel is visible with a file input', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Decoder' })).toBeVisible();

    const fileInput = page.locator('input[type="file"]').nth(1);
    await expect(fileInput).toBeAttached();

    const chooseBtn = page.getByRole('button', { name: /Choose File/i }).nth(1);
    await expect(chooseBtn).toBeVisible();
  });

  test('decoder decodes a DRM-encoded WAV and shows "Decoded successfully"', async ({ page }) => {
    test.setTimeout(180000);

    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(DSSTV1_WAV);

    await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 120000 });
  });

  test('decoder shows diagnostics after successful decode', async ({ page }) => {
    test.setTimeout(180000);

    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(DSSTV1_WAV);

    await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 120000 });

    await expect(page.getByText(/DRM Mode B/i).first()).toBeVisible();
    await expect(page.getByText(/\d+ Hz/).first()).toBeVisible();
  });

  test('decoder rejects a non-audio file with an error', async ({ page }) => {
    const pngPath = resolve(__dirname, '../public/gallery/dsstv1.png');
    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(pngPath);

    await expect(page.locator('text=Please select an audio file')).toBeVisible({ timeout: 5000 });
  });
});
