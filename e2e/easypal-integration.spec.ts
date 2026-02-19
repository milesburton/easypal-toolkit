import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createCanvas } from 'canvas';

async function encodeImage(page: import('@playwright/test').Page, testImagePath: string) {
  const encodeInput = page.locator('input[type="file"]').first();
  await encodeInput.setInputFiles(testImagePath);

  await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('audio')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('button:has-text("Download WAV")').click();
  const download = await downloadPromise;

  const audioPath = join(tmpdir(), `easypal-test-audio-${Date.now()}.wav`);
  await download.saveAs(audioPath);

  const audioBuffer = readFileSync(audioPath);
  expect(audioBuffer.length).toBeGreaterThan(10000);

  return audioPath;
}

async function decodeAndValidate(page: import('@playwright/test').Page, audioPath: string) {
  const clearEncode = page.locator('button:has-text("Clear")').first();
  if (await clearEncode.isVisible()) {
    await clearEncode.click();
  }

  const decodeInput = page.locator('input[type="file"]').last();
  await decodeInput.setInputFiles(audioPath);

  await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 60000 });

  const decodedImage = page.locator('img[alt="Decoded EasyPal"]');
  await expect(decodedImage).toBeVisible();

  const imageSrc = await decodedImage.getAttribute('src');
  expect(imageSrc).toMatch(/^data:image\/png;base64,/);
  expect(imageSrc?.length).toBeGreaterThan(1000);

  const pixelStats = await page.evaluate(async (src: string) => {
    return new Promise<{
      avgBrightness: number;
      maxBrightness: number;
      nonBlackPixels: number;
      totalPixels: number;
      width: number;
      height: number;
    }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let totalBrightness = 0;
        let maxBrightness = 0;
        let nonBlackPixels = 0;
        const totalPixels = canvas.width * canvas.height;

        for (let i = 0; i < data.length; i += 4) {
          const brightness = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
          totalBrightness += brightness;
          if (brightness > maxBrightness) maxBrightness = brightness;
          if (brightness > 10) nonBlackPixels++;
        }

        resolve({
          avgBrightness: totalBrightness / totalPixels,
          maxBrightness,
          nonBlackPixels,
          totalPixels,
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.src = src;
    });
  }, imageSrc ?? '');

  return pixelStats;
}

test.describe('EasyPal Encode → Decode Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('EasyPal Toolkit');
  });

  test('should encode and decode a black/white test pattern with visible pixels', async ({ page }) => {
    test.setTimeout(120000);
    const canvas = createCanvas(320, 240);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 160, 240);
    ctx.fillStyle = 'white';
    ctx.fillRect(160, 0, 160, 240);

    const testImagePath = join(tmpdir(), 'easypal-test-pattern.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const audioPath = await encodeImage(page, testImagePath);

    const stats = await decodeAndValidate(page, audioPath);

    expect(stats.nonBlackPixels).toBeGreaterThan(stats.totalPixels * 0.1);
    expect(stats.maxBrightness).toBeGreaterThan(50);
    expect(stats.avgBrightness).toBeGreaterThan(10);
  });

  test('should decode a bright image with substantial brightness', async ({ page }) => {
    test.setTimeout(120000);
    const canvas = createCanvas(320, 240);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 320, 240);

    const testImagePath = join(tmpdir(), 'easypal-white-square.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const audioPath = await encodeImage(page, testImagePath);
    const stats = await decodeAndValidate(page, audioPath);

    expect(stats.nonBlackPixels).toBeGreaterThan(stats.totalPixels * 0.5);
    expect(stats.avgBrightness).toBeGreaterThan(50);
  });

  test('should work with Robot 36 mode', async ({ page }) => {
    const modeSelect = page.locator('select').first();
    await expect(modeSelect).toHaveValue('ROBOT36');

    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 100, 100);

    const testImagePath = join(tmpdir(), 'easypal-red-square.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const encodeInput = page.locator('input[type="file"]').first();
    await encodeInput.setInputFiles(testImagePath);

    await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 30000 });
  });

  test('should work with Martin M1 mode', async ({ page }) => {
    const modeSelect = page.locator('select').first();
    await modeSelect.selectOption('MARTIN1');

    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 100, 100);

    const testImagePath = join(tmpdir(), 'easypal-blue-square.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const encodeInput = page.locator('input[type="file"]').first();
    await encodeInput.setInputFiles(testImagePath);

    await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 30000 });
  });

  test('should work with Scottie S1 mode', async ({ page }) => {
    const modeSelect = page.locator('select').first();
    await modeSelect.selectOption('SCOTTIE1');

    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'green';
    ctx.fillRect(0, 0, 100, 100);

    const testImagePath = join(tmpdir(), 'easypal-green-square.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const encodeInput = page.locator('input[type="file"]').first();
    await encodeInput.setInputFiles(testImagePath);

    await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 30000 });
  });

  test('should handle file upload via input', async ({ page }) => {
    const canvas = createCanvas(50, 50);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'yellow';
    ctx.fillRect(0, 0, 50, 50);

    const testImagePath = join(tmpdir(), 'easypal-upload-test.png');
    writeFileSync(testImagePath, canvas.toBuffer('image/png'));

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testImagePath);

    await expect(page.locator('text=Encoded successfully')).toBeVisible({ timeout: 30000 });
  });
});
