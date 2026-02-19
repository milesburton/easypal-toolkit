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
    await expect(cards).toHaveCount(3);
  });

  test('each gallery card has a working download link', async ({ page }) => {
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const downloadLinks = page.locator('a[download]');
    const count = await downloadLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);

    const firstLink = downloadLinks.first();
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\.(wav|mp3)$/i);
  });

  test('each card shows a mode badge', async ({ page }) => {
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const gallerySection = page.locator('section').filter({ hasText: 'Example Transmissions' });
    const badges = gallerySection.locator('span').filter({ hasText: /Robot 36|PD 120/ });
    await expect(badges.first()).toBeVisible();
  });

  test('"Try decoding" scrolls to decoder and starts decoding', async ({ page }) => {
    test.setTimeout(180000);
    await page.locator('text=Example Transmissions').waitFor({ timeout: 10000 });

    const tryButtons = page.locator('button:has-text("Try decoding")');
    await expect(tryButtons.first()).toBeVisible();
    await tryButtons.first().click();

    await expect(
      page
        .locator('text=Decoded successfully')
        .or(page.locator('text=Decoded (quality issues)'))
        .or(page.locator('text=Processing…'))
    ).toBeVisible({ timeout: 120000 });
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
