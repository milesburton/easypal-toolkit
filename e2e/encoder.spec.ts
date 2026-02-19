import { expect, test } from '@playwright/test';
import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Create a minimal JPEG test file on disk for upload. */
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
    await expect(page.locator('h1')).toContainText('EasyPal Toolkit');
  });

  test('encoder panel is visible with a file input', async ({ page }) => {
    const encoderSection = page.locator('section').filter({ hasText: /Encode|Encoder/i }).first();
    await expect(encoderSection).toBeVisible();

    // There should be a file chooser button
    const chooseBtn = encoderSection.getByRole('button', { name: /Choose File/i });
    await expect(chooseBtn).toBeVisible();
  });

  test('encoder accepts an image file and produces a WAV download', async ({ page }) => {
    test.setTimeout(120000);

    const jpegPath = makeTempJpeg();

    // Wait for file input
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(jpegPath);

    // Wait for encode result: a download link for a WAV file
    const downloadLink = page.locator('a[download][href*=".wav"], a[download][href*="blob:"]').first();
    await expect(downloadLink).toBeVisible({ timeout: 90000 });
  });

  test('encoder rejects a non-image file with an error', async ({ page }) => {
    // Write a fake text file
    const txtPath = join(tmpdir(), `easypal-test-${Date.now()}.txt`);
    writeFileSync(txtPath, 'not an image');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(txtPath);

    // Should show an error message
    await expect(page.locator('text=Please select an image file')).toBeVisible({ timeout: 5000 });
  });
});
