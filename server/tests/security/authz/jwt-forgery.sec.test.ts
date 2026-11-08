/**
 * AUTHZ security suite: session/token abuse.
 *
 * Each test asserts the SECURE behaviour. A failing test here is a confirmed
 * vulnerability; a passing test documents a control that is correctly enforced.
 */
import jwt from 'jsonwebtoken';
import config from '../../../src/config';
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AUTHZ: JWT forging and token-type confusion', () => {
  it('rejects an alg=none token even when it carries a SUPER_ADMIN claim', async () => {
    const admin = await createUser('SUPER_ADMIN');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: admin.user.id, email: admin.user.email, userRole: 'SUPER_ADMIN', tv: 0 })).toString('base64url');
    const forged = `${header}.${payload}.`;

    const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a guessed/weak secret', async () => {
    const admin = await createUser('SUPER_ADMIN');
    const payload = { userId: admin.user.id, email: admin.user.email, userRole: 'SUPER_ADMIN', tv: 0 };
    for (const guess of ['secret', 'changeme', 'default-secret-change-me', 'password', config.jwt.refreshSecret]) {
      const forged = jwt.sign(payload, guess, { algorithm: 'HS256', expiresIn: '1h' });
      const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects an expired access token', async () => {
    const member = await createUser('MEMBER');
    const expired = jwt.sign(
      { userId: member.user.id, email: member.user.email, userRole: 'MEMBER', tv: 0 },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '-10s' }
    );
    const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token minted for a user that no longer exists', async () => {
    const member = await createUser('MEMBER');
    const token = jwt.sign(
      { userId: member.user.id, email: member.user.email, userRole: 'MEMBER', tv: 0 },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    await prisma.user.delete({ where: { id: member.user.id } });

    const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a refresh token presented as an access token', async () => {
    const member = await createUser('MEMBER');
    const login = await http().post('/api/auth/login').send({ email: member.user.email, password: 'Str0ng!Passw0rd' });
    expect(login.status).toBe(200);
    const { refreshToken } = login.body.data;

    const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects an access token presented at the refresh-token endpoint', async () => {
    const member = await createUser('MEMBER');
    const login = await http().post('/api/auth/login').send({ email: member.user.email, password: 'Str0ng!Passw0rd' });
    const { accessToken } = login.body.data;

    const res = await http().post('/api/auth/refresh-token').send({ refreshToken: accessToken });
    expect(res.status).toBe(401);
  });

  it('revokes an access token the instant the account is deactivated, even if not yet expired', async () => {
    const admin = await createUser('ADMIN');
    const member = await createUser('MEMBER');
    expect((await http().get('/api/auth/me').set('Authorization', member.auth)).status).toBe(200);

    await http().patch(`/api/admin/users/${member.user.id}/status`).set('Authorization', admin.auth).send({ isActive: false });

    const res = await http().get('/api/auth/me').set('Authorization', member.auth);
    expect(res.status).toBe(401);
  });

  it('revokes every outstanding access token on password change (tokenVersion bump)', async () => {
    const member = await createUser('MEMBER');
    const oldAuth = member.auth;

    const change = await http()
      .post('/api/auth/change-password')
      .set('Authorization', oldAuth)
      .send({ currentPassword: 'Str0ng!Passw0rd', newPassword: 'NewStr0ng!Passw0rd2' });
    expect(change.status).toBe(200);

    const res = await http().get('/api/auth/me').set('Authorization', oldAuth);
    expect(res.status).toBe(401);
  });

  it('does not trust the role embedded in the token once the DB role has changed', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const target = await createUser('MEMBER');
    const staleToken = target.auth; // claims MEMBER

    // Promote out-of-band (simulating a stale token surviving a promotion elsewhere)
    await prisma.user.update({ where: { id: target.user.id }, data: { userRole: 'SUPER_ADMIN' } });
    // The token itself never changes; access is re-derived from the DB on every request,
    // so using the *old* token still reflects the *current* DB role, not what the token claims.
    const res = await http().get('/api/admin/stats').set('Authorization', staleToken);
    expect(res.status).toBe(200); // proves role is read from DB, not the JWT payload
  });
});
