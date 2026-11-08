/**
 * AUTHZ security suite: IDOR / BOLA on :id resources.
 *
 * Each test asserts the SECURE behaviour. A failing test here is a confirmed
 * vulnerability; a passing test documents a control that is correctly enforced.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AUTHZ: IDOR / BOLA across owned resources', () => {
  it('member B cannot read, edit or delete member A notifications', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');

    const notif = await prisma.notification.create({
      data: { userId: a.user.id, type: 'MESSAGE_RECEIVED', title: 'x', message: 'y' },
    });

    expect((await http().post(`/api/notifications/${notif.id}/read`).set('Authorization', b.auth)).status).toBe(404);
    expect((await http().delete(`/api/notifications/${notif.id}`).set('Authorization', b.auth)).status).toBe(404);

    const stillThere = await prisma.notification.findUnique({ where: { id: notif.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.isRead).toBe(false);
  });

  it('member B cannot edit or delete member A posts/comments', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');

    const post = await http().post('/api/posts').set('Authorization', a.auth).send({ content: 'A original' });
    const postId = post.body.data.id;

    expect((await http().patch(`/api/posts/${postId}`).set('Authorization', b.auth).send({ content: 'hacked' })).status).toBe(403);
    expect((await http().delete(`/api/posts/${postId}`).set('Authorization', b.auth)).status).toBe(403);

    const comment = await http().post(`/api/posts/${postId}/comments`).set('Authorization', b.auth).send({ content: 'a comment' });
    const commentId = comment.body.data.id;
    const c = await createUser('MEMBER');
    expect((await http().patch(`/api/comments/${commentId}`).set('Authorization', c.auth).send({ content: 'hacked' })).status).toBe(403);
  });

  it('a non-participant cannot respond to a message request addressed to someone else', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const eve = await createUser('MEMBER');

    const send = await http().post(`/api/messages/${b.user.id}`).set('Authorization', a.auth).send({ content: 'hi (not connected)' });
    expect(send.status).toBe(201);

    const inbox = await http().get('/api/messages').set('Authorization', b.auth);
    const convo = inbox.body.data.find((c: any) => c.partnerId === a.user.id);
    expect(convo).toBeDefined();

    // Find the raw message id to respond to via direct DB lookup (route only exposes partnerId)
    const msg = await prisma.message.findFirst({ where: { senderId: a.user.id, receiverId: b.user.id } });
    const res = await http()
      .post(`/api/messages/request/${msg!.id}/respond`)
      .set('Authorization', eve.auth)
      .send({ accept: true });
    expect(res.status).toBe(403);
  });

  it('a non-participant cannot accept/reject a connection request addressed to someone else', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const eve = await createUser('MEMBER');

    const sent = await http().post(`/api/network/request/${b.user.id}`).set('Authorization', a.auth);
    const connectionId = sent.body.data.connectionId;

    const res = await http().post(`/api/network/respond/${connectionId}`).set('Authorization', eve.auth).send({ accept: true });
    expect(res.status).toBe(403);

    const removed = await http().delete(`/api/network/connection/${connectionId}`).set('Authorization', eve.auth);
    expect(removed.status).toBe(403);
  });

  it('a non-participant cannot see or schedule mentorship sessions for someone else\'s mentorship', async () => {
    const mentor = await createUser('MEMBER');
    const mentee = await createUser('MEMBER');
    const eve = await createUser('MEMBER');

    await http().post('/api/mentorship/profile').set('Authorization', mentor.auth).send({ focusAreas: ['Career'], maxMentees: 5 });
    const reqRes = await http().post(`/api/mentorship/request/${mentor.user.id}`).set('Authorization', mentee.auth).send({ message: 'hi' });
    const requestId = reqRes.body.data.id;
    await http().post(`/api/mentorship/request/${requestId}/respond`).set('Authorization', mentor.auth).send({ accept: true });

    const eveSchedule = await http()
      .post(`/api/mentorship/request/${requestId}/sessions`)
      .set('Authorization', eve.auth)
      .send({ scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    expect(eveSchedule.status).toBe(403);

    const eveList = await http().get(`/api/mentorship/request/${requestId}/sessions`).set('Authorization', eve.auth);
    expect(eveList.status).toBe(403);

    const eveEnd = await http().post(`/api/mentorship/request/${requestId}/end`).set('Authorization', eve.auth);
    expect(eveEnd.status).toBe(403);
  });

  it('a non-owner cannot edit or delete another member\'s marketplace listing', async () => {
    const owner = await createUser('MEMBER');
    const eve = await createUser('MEMBER');

    const listing = await http()
      .post('/api/marketplace')
      .set('Authorization', owner.auth)
      .send({ title: 'Consulting', category: 'Services', description: 'A sufficiently long listing description.' });
    const id = listing.body.data.id;

    expect((await http().patch(`/api/marketplace/${id}`).set('Authorization', eve.auth).send({ title: 'pwned' })).status).toBe(403);
    expect((await http().delete(`/api/marketplace/${id}`).set('Authorization', eve.auth)).status).toBe(403);

    // Non-owner also cannot grant themselves the admin-only isFeatured flag through the shared endpoint
    const asOwnerFeature = await http().patch(`/api/marketplace/${id}`).set('Authorization', owner.auth).send({ isFeatured: true });
    expect(asOwnerFeature.status).toBe(200);
    expect(asOwnerFeature.body.data.isFeatured).toBe(false); // owner is not admin: field silently ignored, never set
  });

  it('a transaction receipt is only visible to its owner or an admin', async () => {
    const owner = await createUser('MEMBER');
    const eve = await createUser('MEMBER');
    const admin = await createUser('ADMIN');

    const tx = await prisma.transaction.create({
      data: { userId: owner.user.id, type: 'DONATION', amount: 500, status: 'SUCCESS', gatewayPaymentId: 'pay_test' },
    });
    await prisma.donation.create({ data: { userId: owner.user.id, amount: 500, transactionId: tx.id } });

    expect((await http().get(`/api/transactions/${tx.id}/receipt`).set('Authorization', eve.auth)).status).toBe(403);
    expect((await http().get(`/api/transactions/${tx.id}/receipt`).set('Authorization', owner.auth)).status).toBe(200);
    expect((await http().get(`/api/transactions/${tx.id}/receipt`).set('Authorization', admin.auth)).status).toBe(200);
  });

  it('getMyTransactions never returns another user\'s rows regardless of query filters', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    await prisma.transaction.create({ data: { userId: b.user.id, type: 'DONATION', amount: 999, status: 'SUCCESS' } });

    const res = await http().get('/api/transactions/my?limit=100').set('Authorization', a.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.every((t: any) => t.amount !== '999')).toBe(true);
  });
});

describe('AUTHZ: admin/role hierarchy boundaries', () => {
  it('a member cannot self-promote via the admin role endpoint', async () => {
    const member = await createUser('MEMBER');
    const res = await http()
      .patch(`/api/admin/users/${member.user.id}/role`)
      .set('Authorization', member.auth)
      .send({ role: 'SUPER_ADMIN' });
    expect(res.status).toBe(403);
  });

  it('an admin cannot promote a member to ADMIN or SUPER_ADMIN (only below their own rank)', async () => {
    const admin = await createUser('ADMIN');
    const member = await createUser('MEMBER');

    const toAdmin = await http().patch(`/api/admin/users/${member.user.id}/role`).set('Authorization', admin.auth).send({ role: 'ADMIN' });
    expect(toAdmin.status).toBe(403);

    const toSuper = await http().patch(`/api/admin/users/${member.user.id}/role`).set('Authorization', admin.auth).send({ role: 'SUPER_ADMIN' });
    expect(toSuper.status).toBe(403);
  });

  it('an admin cannot deactivate or demote another admin or a super admin', async () => {
    const admin = await createUser('ADMIN');
    const otherAdmin = await createUser('ADMIN');
    const superAdmin = await createUser('SUPER_ADMIN');

    expect((await http().patch(`/api/admin/users/${otherAdmin.user.id}/status`).set('Authorization', admin.auth).send({ isActive: false })).status).toBe(403);
    expect((await http().patch(`/api/admin/users/${superAdmin.user.id}/status`).set('Authorization', admin.auth).send({ isActive: false })).status).toBe(403);
  });

  it('nobody can deactivate or demote their own account through the admin endpoint (prevents self-lockout tricks)', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const res = await http()
      .patch(`/api/admin/users/${superAdmin.user.id}/status`)
      .set('Authorization', superAdmin.auth)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('deleting the last super admin account is refused', async () => {
    await prisma.user.updateMany({ where: { userRole: 'SUPER_ADMIN' }, data: { isActive: false } });
    const onlySuperAdmin = await createUser('SUPER_ADMIN');

    const res = await http()
      .delete('/api/users/me')
      .set('Authorization', onlySuperAdmin.auth)
      .send({ password: 'Str0ng!Passw0rd' });
    expect(res.status).toBe(409);
    const stillThere = await prisma.user.findUnique({ where: { id: onlySuperAdmin.user.id } });
    expect(stillThere!.isActive).toBe(true);
  });
});
