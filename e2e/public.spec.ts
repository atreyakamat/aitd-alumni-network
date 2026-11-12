import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('public pages', () => {
  test('the landing page loads with the product name and sign-in links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AIEM Connect/i);
    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
  });

  for (const path of ['/login', '/register', '/forgot-password', '/privacy', '/terms']) {
    test(`${path} renders without a server error`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator('body')).not.toContainText(/application error|internal server error/i);
    });
  }

  test('the old college name does not appear on the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).not.toContainText(/\bAITD\b/);
  });
});

test.describe('the platform is private: a visitor is sent to sign in and brought back', () => {
  for (const path of ['/directory', '/jobs', '/events', '/messages', '/admin/approvals']) {
    test(`${path} redirects to /login with the way back`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  }
});

test.describe('accessibility (axe, WCAG 2 A and AA): no serious or critical violations', () => {
  for (const path of ['/', '/login', '/register', '/forgot-password', '/privacy']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    });
  }
});
