import { expect, test } from '@playwright/test';

test.describe('Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('EasyPal Toolkit');
  });

  test('gallery section is visible with example cards', async ({ page }) => {
    const gallery = page.locator('text=Example Transmissions');
    await expect(gallery).toBeVisible({ timeout: 10000 });

    const cards = page
      .locator('section')
      .filter({ hasText: 'Example Transmissions' })
      .locator('img');
    await expect(cards).toHaveCount(2);
  });

  test('each gallery card has a working download link', async ({ page }) => {
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const downloadLinks = page.locator('a[download]');
    const count = await downloadLinks.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const firstLink = downloadLinks.first();
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\.(wav|mp3)$/i);
  });

  test('each card shows a mode badge', async ({ page }) => {
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const gallerySection = page.locator('section').filter({ hasText: 'Example Transmissions' });
    const badges = gallerySection.locator('span').filter({ hasText: /DRM Mode B/ });
    await expect(badges.first()).toBeVisible();
  });

  test('"Try decoding" decodes the sample and shows success', async ({ page }) => {
    test.setTimeout(180000);
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const tryButtons = page.locator('button:has-text("Try decoding")');
    await expect(tryButtons.first()).toBeVisible();
    await tryButtons.first().click();

    // Gallery WAVs are DRM-encoded by our encoder; they must decode successfully.
    await expect(page.locator('text=Decoded successfully')).toBeVisible({ timeout: 120000 });
  });

  test('gallery images load without broken src', async ({ page }) => {
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const images = page
      .locator('section')
      .filter({ hasText: 'Example Transmissions' })
      .locator('img');

    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const src = await images.nth(i).getAttribute('src');
      expect(src).toBeTruthy();
      expect(src).toMatch(/^gallery\//);
    }
  });
});
