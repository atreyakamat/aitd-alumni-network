import { test, expect } from '@playwright/test';

test('guest donations are open without an account', async ({ page }) => {
  // /donations is the one member route a visitor may use; a redirect to /login here means the stack decided otherwise
  await page.goto('/donations');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).toContainText(/donat/i);
});
