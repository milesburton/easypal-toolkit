import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createCanvas } from 'canvas';

function makeTempJpeg(): string {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4080c0';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(16, 16, 32, 32);
  const buf = canvas.toBuffer('image/jpeg', { quality: 0.7 });
  const path = join(tmpdir(), `easypal-test-${Date.now()}.jpg`);
  writeFileSync(path, buf);
  return path;
}

test.describe('Encoder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('DRM Studio');
  });

  test('encoder panel is visible with a file input', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Encoder' })).toBeVisible();

    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();

    const chooseBtn = page.getByRole('button', { name: /Choose File/i }).first();
    await expect(chooseBtn).toBeVisible();
  });

  test('encoder accepts an image file and shows "Encoded successfully"', async ({ page }) => {
    test.setTimeout(120000);

    const jpegPath = makeTempJpeg();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(jpegPath);

    await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole('button', { name: 'Download WAV' })).toBeVisible();
  });

  test('encoder rejects a non-image file with an error', async ({ page }) => {
    const txtPath = join(tmpdir(), `easypal-test-${Date.now()}.txt`);
    writeFileSync(txtPath, 'not an image');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(txtPath);

    await expect(page.locator('text=Please select an image file')).toBeVisible({ timeout: 5000 });
  });
});
