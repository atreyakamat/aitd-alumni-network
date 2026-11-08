/**
 * AU-01: OAuth account pre-hijacking.
 *
 * `register` does not require e-mail verification before a session is issued, so anyone can
 * register a victim's address with a password they chose and keep a live session. When the
 * victim later signs in with Google, `resolveOAuthUser` links the provider identity to that
 * existing row. The attacker's password and sessions must NOT survive that link, because the
 * password was never proven to belong to the mailbox owner.
 */
import { resolveOAuthUser } from '../../../src/config/passport';
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const googleProfile = (email: string) => ({
  id: 'google-123',
  displayName: 'Victim',
  emails: [{ value: email, verified: true }],
});

describe('AU-01: OAuth linking must not preserve credentials of an unverified local account', () => {
  it('drops the attacker password and sessions when the real owner links via a verified provider e-mail', async () => {
    const email = uniqueEmail('victim');
    const reg = await http().post('/api/auth/register').send({
      email,
      password: PASSWORD,
      fullName: 'Pre Hijacker',
      batchYear: 2015,
      department: 'Civil',
      degree: 'B.E.',
    });
    expect(reg.status).toBe(201);

    const attackerLogin = await http().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(attackerLogin.status).toBe(200);
    const { accessToken, refreshToken } = attackerLogin.body.data;

    // Victim signs in with Google using the same (provider-verified) address
    await resolveOAuthUser('google', googleProfile(email));

    const relogin = await http().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(relogin.status).toBe(401);

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);

    const refreshed = await http().post('/api/auth/refresh-token').send({ refreshToken });
    expect(refreshed.status).toBe(401);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it('keeps the password of an account whose e-mail was already verified', async () => {
    const { user } = await createUser('MEMBER');
    await resolveOAuthUser('google', googleProfile(user.email));

    const login = await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });
});
