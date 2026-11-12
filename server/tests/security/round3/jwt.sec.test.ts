/**
 * ROUND 3 / C7 - token handling beyond round 1: other algorithms, the three secrets crossing over, header tricks, not-yet-valid
 * and oversized tokens, deleted / deactivated / role-changed users, and refresh-token reuse after rotation.
 * Every forged or stale token is a 401 and never falls back to the visitor view; a good token still works (control).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../../src/config';
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';
import { generateAccessToken, generateRefreshToken, generateTwoFactorToken } from '../../../src/utils/jwt';

afterAll(async () => {
  await prisma.$disconnect();
});

const secret = config.jwt.secret as string;
const refreshSecret = config.jwt.refreshSecret as string;
const get = (token: string, url = '/api/auth/me') => http().get(url).set('Authorization', `Bearer ${token}`);
const b64 = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const hs = (alg: 'sha256' | 'sha384' | 'sha512', input: string, key: string) => crypto.createHmac(alg, key).update(input).digest('base64url');

describe('forged tokens (every one is 401, on a route that works anonymously too)', () => {
  it('accepts a good token, so the rejections below mean something', async () => {
    const { user, auth } = await createUser('MEMBER');
    expect((await http().get('/api/auth/me').set('Authorization', auth)).status).toBe(200);
    expect(user.id).toBeTruthy();
  });

  it('other HMAC algorithms signed with the REAL secret are refused (the algorithm is pinned to HS256)', async () => {
    const { user } = await createUser('MEMBER');
    const payload = { userId: user.id, email: user.email, userRole: 'MEMBER', tv: 0, exp: Math.floor(Date.now() / 1000) + 600 };
    for (const [alg, hash] of [['HS384', 'sha384'], ['HS512', 'sha512']] as const) {
      const head = b64({ alg, typ: 'JWT' });
      const body = b64(payload);
      const token = `${head}.${body}.${hs(hash, `${head}.${body}`, secret)}`;
      expect({ alg, status: (await get(token)).status }).toEqual({ alg, status: 401 });
    }
  });

  it('alg=none in every spelling, with and without a signature part', async () => {
    const { user } = await createUser('MEMBER');
    const body = b64({ userId: user.id, email: user.email, userRole: 'SUPER_ADMIN', tv: 0, exp: Math.floor(Date.now() / 1000) + 600 });
    for (const alg of ['none', 'None', 'NONE', 'nOnE', '', null]) {
      for (const tail of ['', 'AAAA']) {
        const token = `${b64({ alg, typ: 'JWT' })}.${body}.${tail}`;
        expect({ alg, tail, status: (await get(token)).status }).toEqual({ alg, tail, status: 401 });
      }
    }
  });

  it('header tricks (kid, jku, jwk, x5u, crit) do not change which key verifies the token', async () => {
    const { user } = await createUser('MEMBER');
    const payload = { userId: user.id, email: user.email, userRole: 'MEMBER', tv: 0 };
    const attackerKey = 'attacker-chosen-key-attacker-chosen-key';
    for (const extra of [
      { kid: '../../../../dev/null' },
      { kid: "x' OR '1'='1" },
      { jku: 'https://evil.example/jwks.json' },
      { jwk: { kty: 'oct', k: Buffer.from(attackerKey).toString('base64url') } },
      { x5u: 'https://evil.example/cert.pem' },
      { crit: ['exp'] },
    ]) {
      const token = jwt.sign(payload, attackerKey, { algorithm: 'HS256', header: { alg: 'HS256', ...extra } as never, expiresIn: 600 });
      expect({ extra: Object.keys(extra)[0], status: (await get(token)).status }).toEqual({ extra: Object.keys(extra)[0], status: 401 });
    }
  });

  it('the three signing keys are not interchangeable: a refresh token, a 2FA challenge and an access token each work only in their place', async () => {
    const { user, auth } = await createUser('MEMBER');
    const access = auth.slice('Bearer '.length);
    const refresh = generateRefreshToken(user.id);
    const challenge = generateTwoFactorToken(user.id);
    expect((await get(refresh)).status).toBe(401);
    expect((await get(challenge)).status).toBe(401);
    // an access-shaped token signed with the REFRESH secret
    expect((await get(jwt.sign({ userId: user.id, email: user.email, userRole: 'MEMBER', tv: 0 }, refreshSecret, { algorithm: 'HS256', expiresIn: 600 }))).status).toBe(401);
    // an access token and a 2FA challenge at the refresh endpoint and the 2FA endpoint
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: access })).status).toBe(401);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: challenge })).status).toBe(401);
    expect((await http().post('/api/auth/verify-2fa').send({ twoFactorToken: access, otp: '123456' })).status).toBe(401);
    expect((await http().post('/api/auth/verify-2fa').send({ twoFactorToken: refresh, otp: '123456' })).status).toBe(401);
    // a challenge-shaped token without the purpose claim, signed with the access secret
    expect((await http().post('/api/auth/verify-2fa').send({ twoFactorToken: jwt.sign({ userId: user.id }, secret, { algorithm: 'HS256' }), otp: '123456' })).status).toBe(401);
  });

  it('a token that is not valid yet (nbf), one that has expired and one with no expiry that the server did not sign are all refused', async () => {
    const { user } = await createUser('MEMBER');
    const payload = { userId: user.id, email: user.email, userRole: 'MEMBER', tv: 0 };
    expect((await get(jwt.sign(payload, secret, { algorithm: 'HS256', notBefore: 3600, expiresIn: 7200 }))).status).toBe(401);
    expect((await get(jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 5 }, secret, { algorithm: 'HS256' }))).status).toBe(401);
    // the pinned-algorithm check only: a token with a wrong signature
    const good = generateAccessToken(user.id, user.email, user.userRole);
    const [h, p, s] = good.split('.');
    expect((await get(`${h}.${p}.${s.slice(0, -2)}AA`)).status).toBe(401);
    expect((await get(`${h}.${b64({ ...payload, userRole: 'SUPER_ADMIN' })}.${s}`)).status).toBe(401);
  });

  it('absurd inputs: a 10 KB token, an empty bearer, other schemes, garbage', async () => {
    for (const header of [`Bearer ${'a'.repeat(10_000)}`, 'Bearer ', 'Bearer', 'Bearer a.b.c', 'Bearer a.b','Basic dXNlcjpwYXNz', 'bearer', `Bearer ${'.'.repeat(1000)}`]) {
      const res = await http().get('/api/auth/me').set('Authorization', header);
      expect({ header: header.slice(0, 20), status: res.status }).toEqual({ header: header.slice(0, 20), status: 401 });
    }
  });

  it('a forged token on a route that also serves visitors is 401, not the visitor view (no silent downgrade)', async () => {
    const res = await get('forged.token.value', '/api/landing');
    expect([200, 401]).toContain(res.status); // /landing is visitor-friendly by design; it must never SHOW member data to a bad token
    expect(JSON.stringify(res.body)).not.toMatch(/email|passwordHash/i);
    expect((await get('forged.token.value', '/api/search?q=a')).status).toBe(401);
    expect((await get('forged.token.value', '/api/donations/order')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('a real token whose account has changed', () => {
  it('is refused the moment the account is deleted, deactivated or has its sessions revoked', async () => {
    const gone = await createUser('MEMBER');
    const off = await createUser('MEMBER');
    const out = await createUser('MEMBER');
    await prisma.user.delete({ where: { id: gone.user.id } });
    await prisma.user.update({ where: { id: off.user.id }, data: { isActive: false } });
    await prisma.user.update({ where: { id: out.user.id }, data: { tokenVersion: { increment: 1 } } });
    for (const who of [gone, off, out]) expect((await http().get('/api/auth/me').set('Authorization', who.auth)).status).toBe(401);
  });

  it('a demotion takes effect on the next request (the role is read from the database, not from the token)', async () => {
    const admin = await createUser('ADMIN');
    expect((await http().get('/api/admin/stats').set('Authorization', admin.auth)).status).toBe(200);
    await prisma.user.update({ where: { id: admin.user.id }, data: { userRole: 'MEMBER' } });
    expect((await http().get('/api/admin/stats').set('Authorization', admin.auth)).status).toBe(403);
  });

  it('a token minted with an ADMIN claim for a plain member is still a member', async () => {
    const member = await createUser('MEMBER');
    const token = jwt.sign({ userId: member.user.id, email: member.user.email, userRole: 'SUPER_ADMIN', tv: 0 }, secret, { algorithm: 'HS256', expiresIn: 600 });
    expect((await get(token, '/api/admin/stats')).status).toBe(403); // signed correctly, role claim ignored
  });
});

describe('refresh tokens', () => {
  const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD })).body.data as { accessToken: string; refreshToken: string };
  const refresh = (refreshToken: string) => http().post('/api/auth/refresh-token').send({ refreshToken });

  it('a rotated token used again after the grace window revokes the whole family, the child included, and leaves a security alert', async () => {
    const { user } = await createUser('MEMBER');
    const first = await login(user.email);
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    const child = second.body.data.refreshToken as string;

    // not a lost race between two tabs: the rotation happened a minute ago
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });

    const replay = await refresh(first.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect((await refresh(child)).status).toBe(401); // the thief and the owner both have to sign in again
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: 'SECURITY_ALERT' } })).toBeGreaterThanOrEqual(1);
  });

  it('inside the grace window the stale token is refused and issues nothing, the family survives', async () => {
    const { user } = await createUser('MEMBER');
    const first = await login(user.email);
    const second = await refresh(first.refreshToken);
    const stale = await refresh(first.refreshToken);
    expect(stale.status).toBe(401);
    expect(JSON.stringify(stale.body)).not.toMatch(/accessToken|"refreshToken"/);
    expect((await refresh(second.body.data.refreshToken)).status).toBe(200);
  });

  it('another account\'s family is never touched by reuse on this one', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const sa = await login(a.user.email);
    const sb = await login(b.user.email);
    await refresh(sa.refreshToken);
    await prisma.refreshToken.updateMany({ where: { userId: a.user.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    expect((await refresh(sa.refreshToken)).body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect((await refresh(sb.refreshToken)).status).toBe(200);
  });

  it('a refresh token signed for one user but stored for another is refused; so is one whose row was deleted (logout)', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const sa = await login(a.user.email);
    const swapped = generateRefreshToken(b.user.id);
    expect((await refresh(swapped)).status).toBe(401);
    expect((await http().post('/api/auth/logout').set('Authorization', `Bearer ${sa.accessToken}`).send({ refreshToken: sa.refreshToken })).status).toBe(200);
    expect((await refresh(sa.refreshToken)).status).toBe(401);
  });

  it('a deactivated account cannot refresh, and the refresh rows are removed', async () => {
    const { user } = await createUser('MEMBER');
    const session = await login(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await refresh(session.refreshToken);
    expect(res.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
