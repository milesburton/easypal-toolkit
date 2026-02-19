import { expect, test } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DSSTV1_WAV = resolve(__dirname, '../public/examples/DSSTV1.wav');

test.describe('Decoder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('EasyPal Toolkit');
  });

  test('decoder panel is visible with a file input', async ({ page }) => {
    const decoderSection = page.locator('section').filter({ hasText: /Decode|Decoder/i }).first();
    await expect(decoderSection).toBeVisible();

    const chooseBtn = decoderSection.getByRole('button', { name: /Choose File/i });
    await expect(chooseBtn).toBeVisible();
  });

  test('decoder decodes a DRM-encoded WAV and shows "Decoded successfully"', async ({ page }) => {
    test.setTimeout(180000);

    // Upload our known-good DRM WAV file
    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(DSSTV1_WAV);

    // Must show success — not just "any terminal state"
    await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 120000 });
  });

  test('decoder shows diagnostics after successful decode', async ({ page }) => {
    test.setTimeout(180000);

    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(DSSTV1_WAV);

    await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 120000 });

    // Diagnostics panel should show DRM mode info
    await expect(page.locator('text=DRM')).toBeVisible();
    await expect(page.locator('text=12000').or(page.locator('text=12 000'))).toBeVisible();
  });

  test('decoder rejects a non-audio file with an error', async ({ page }) => {
    // Try uploading a gallery image (PNG) into the decoder
    const pngPath = resolve(__dirname, '../public/gallery/dsstv1.png');
    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles(pngPath);

    // Should show an error about file type
    await expect(page.locator('text=Please select an audio file')).toBeVisible({ timeout: 5000 });
  });
});
