/**
 * AU-12: endpoints that re-check the current password for an already-authenticated session
 * (change-password, delete-account, disable-2FA) were limited only by the per-IP limiter, so a
 * stolen access token could be used to guess the account password from many addresses. The
 * budget is now per account.
 */
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AU-12: per-account password attempt budget', () => {
  it('locks change-password after repeated wrong current passwords, even for the right one', async () => {
    const { auth } = await createUser('MEMBER');
    for (let i = 0; i < 5; i++) {
      const bad = await http()
        .post('/api/auth/change-password')
        .set('Authorization', auth)
        .send({ currentPassword: `Wrong#Pass${i}A`, newPassword: 'N3w!Passw0rd-xyz' });
      expect(bad.status).toBe(401);
    }
    const locked = await http()
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ currentPassword: PASSWORD, newPassword: 'N3w!Passw0rd-xyz' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('PASSWORD_ATTEMPTS_EXCEEDED');
  });

  it('shares the budget with delete-account, and a success resets it', async () => {
    const { user, auth } = await createUser('MEMBER');
    for (let i = 0; i < 5; i++) {
      const bad = await http().delete('/api/users/me').set('Authorization', auth).send({ password: `Wrong#Pass${i}B` });
      expect(bad.status).toBe(401);
    }
    const locked = await http().delete('/api/users/me').set('Authorization', auth).send({ password: PASSWORD });
    expect(locked.status).toBe(429);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.isActive).toBe(true);

    // a fresh account: failures below the budget are forgiven by one success
    const other = await createUser('MEMBER');
    for (let i = 0; i < 3; i++) {
      await http().post('/api/auth/change-password').set('Authorization', other.auth)
        .send({ currentPassword: `Wrong#Pass${i}C`, newPassword: 'N3w!Passw0rd-xyz' });
    }
    const ok = await http().post('/api/auth/change-password').set('Authorization', other.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'N3w!Passw0rd-xyz' });
    expect(ok.status).toBe(200);
    const left = await prisma.verificationToken.count({ where: { userId: other.user.id, type: 'PASSWORD_FAILURE' } });
    expect(left).toBe(0);
  });
});
