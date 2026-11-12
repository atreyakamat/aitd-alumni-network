import { test, expect } from '@playwright/test';
import { API, ADMIN, hasAdmin, throwawayEmail, throwawayPassword } from './env';

/**
 * Register -> the administrator approves -> the member signs in. Registers one throw-away member per run on the stack
 * under test, so it needs administrator credentials and a stack where e-mail verification is off (or the verification
 * link is not required to appear in the review queue); otherwise it skips with the reason.
 */
test.describe('member journey', () => {
  test.skip(!hasAdmin, 'set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the journey');

  test('a new registration waits for approval, the administrator approves it, the member signs in', async ({ page, request }) => {
    const email = throwawayEmail();
    const password = throwawayPassword();

    const registered = await request.post(`${API}/auth/register`, {
      data: { email, password, fullName: 'E2E Member', batchYear: 2020, department: 'Computer Science', degree: 'B.Tech', roleType: 'ALUMNI' },
    });
    expect([200, 201, 202]).toContain(registered.status());

    // The administrator finds the registration in the review queue and approves it
    const login = await request.post(`${API}/auth/login`, { data: ADMIN });
    expect(login.ok()).toBeTruthy();
    const body = await login.json();
    const token: string | undefined = body.data?.accessToken ?? body.data?.tokens?.accessToken;
    test.skip(!token, 'the administrator needs a password-only login (no 2FA step) for this spec');
    const headers = { Authorization: `Bearer ${token}` };

    const queue = await request.get(`${API}/admin/approvals?status=PENDING&search=${encodeURIComponent(email)}`, { headers });
    expect(queue.ok()).toBeTruthy();
    const queueBody = await queue.json();
    const rows: Array<{ id: string; email?: string }> = queueBody.data?.registrations ?? queueBody.data?.items ?? queueBody.data ?? [];
    const row = rows.find((r) => r.email?.toLowerCase() === email.toLowerCase()) ?? rows[0];
    test.skip(!row?.id, 'the registration is not in the pending queue (e-mail verification may still be required)');

    const approved = await request.post(`${API}/admin/approvals/${row.id}/approve`, { headers, data: {} });
    expect(approved.ok()).toBeTruthy();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
