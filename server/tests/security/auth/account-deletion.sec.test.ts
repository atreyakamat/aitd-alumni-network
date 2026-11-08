/**
 * AU-10 / AU-11: GDPR erasure and portability.
 *  - deleting an account must remove the social graph and third-party e-mail addresses that
 *    only exist because of that user (follows, saved posts, invites sent / addressed to them);
 *  - the data export must be complete for the user's own social data and must never contain
 *    credentials, tokens or payment signatures.
 */
import { createUser, http, prisma, PASSWORD, uniqueEmail } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AU-10: account deletion removes personal graph data', () => {
  it('deletes follows, saved posts and invites tied to the user', async () => {
    const me = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: other.user.id, content: 'hello world' } });
    await prisma.follow.createMany({
      data: [
        { followerId: me.user.id, followingId: other.user.id },
        { followerId: other.user.id, followingId: me.user.id },
      ],
    });
    await prisma.savedPost.create({ data: { userId: me.user.id, postId: post.id } });
    await prisma.invite.create({
      data: {
        email: uniqueEmail('friend'),
        token: `tok-${me.user.id}`,
        expiresAt: new Date(Date.now() + 1e9),
        inviterId: me.user.id,
        name: 'Friend Of Mine',
      },
    });
    await prisma.invite.create({
      data: { email: me.user.email, token: `tok2-${me.user.id}`, expiresAt: new Date(Date.now() + 1e9), inviterId: other.user.id },
    });

    const res = await http().delete('/api/users/me').set('Authorization', me.auth).send({ password: PASSWORD });
    expect(res.status).toBe(200);

    expect(
      await prisma.follow.count({ where: { OR: [{ followerId: me.user.id }, { followingId: me.user.id }] } })
    ).toBe(0);
    expect(await prisma.savedPost.count({ where: { userId: me.user.id } })).toBe(0);
    expect(
      await prisma.invite.count({ where: { OR: [{ inviterId: me.user.id }, { email: me.user.email }] } })
    ).toBe(0);
    // other people's data is untouched
    expect(await prisma.post.count({ where: { id: post.id } })).toBe(1);
  });
});

describe('AU-11: data export', () => {
  it('includes follows / saved posts / invites and never leaks secrets', async () => {
    const me = await createUser('MEMBER', { twoFactorEnabled: true });
    const other = await createUser('MEMBER');
    await prisma.follow.create({ data: { followerId: me.user.id, followingId: other.user.id } });
    await prisma.verificationToken.create({
      data: { userId: me.user.id, token: 'SECRET-TOKEN-HASH', type: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + 1e6) },
    });
    await prisma.refreshToken.create({
      data: { userId: me.user.id, token: 'SECRET-REFRESH-HASH', expiresAt: new Date(Date.now() + 1e6) },
    });
    await prisma.transaction.create({
      data: {
        userId: me.user.id,
        type: 'DONATION',
        amount: 10,
        status: 'SUCCESS',
        gatewayOrderId: `o_${Date.now()}`,
        gatewaySignature: 'SECRET-SIGNATURE',
      },
    });
    await prisma.invite.create({
      data: { email: uniqueEmail('friend'), token: 'e'.repeat(64), expiresAt: new Date(Date.now() + 1e9), inviterId: me.user.id },
    });

    const res = await http().get('/api/users/me/export').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(me.user.passwordHash!);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('SECRET-TOKEN-HASH');
    expect(body).not.toContain('SECRET-REFRESH-HASH');
    expect(body).not.toContain('SECRET-SIGNATURE');
    expect(body).not.toContain('e'.repeat(64));

    expect(res.body.data.follows).toHaveLength(1);
    expect(res.body.data.invitesSent).toHaveLength(1);
    expect(res.body.data).toHaveProperty('savedPosts');
  });
});
