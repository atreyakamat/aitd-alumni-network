import { inviteController } from '../../controllers/inviteController';
import { inviteService, MAX_BULK_INVITES } from '../../services/inviteService';
import { mockReqRes, prismaMock, api, authAs, USER_IDS, getApp } from '../../../tests/helpers';

const member = { id: 'u1', email: 'u1@aitd.test', fullName: 'U1', userRole: 'MEMBER' as const };

afterEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('inviteController (unit)', () => {
  describe('sendInvite', () => {
    it('400s without an email', async () => {
      const { req, res, next } = mockReqRes({ body: {}, user: member });
      await inviteController.sendInvite(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'MISSING_EMAIL' }));
    });

    it('sends as the caller with a parsed batch year', async () => {
      const spy = jest.spyOn(inviteService, 'sendInvite').mockResolvedValue({ success: true, invite: { id: 'i1' } });
      const { req, res, next } = mockReqRes({
        body: { email: 'x@y.co', name: 'X', batchYear: '2019', message: 'hi', inviterId: 'spoof' },
        user: member,
      });
      await inviteController.sendInvite(req, res, next);
      expect(spy).toHaveBeenCalledWith('u1', { email: 'x@y.co', name: 'X', batchYear: 2019, message: 'hi' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Invitation sent successfully', data: { id: 'i1' } });
    });

    it('drops a non-numeric batch year', async () => {
      const spy = jest.spyOn(inviteService, 'sendInvite').mockResolvedValue({ success: true });
      const { req, res, next } = mockReqRes({ body: { email: 'x@y.co', batchYear: 'abc' }, user: member });
      await inviteController.sendInvite(req, res, next);
      expect(spy.mock.calls[0][1].batchYear).toBeUndefined();
    });

    it('maps a failed send to 400', async () => {
      jest.spyOn(inviteService, 'sendInvite').mockResolvedValue({ success: false, error: 'This email is already registered' });
      const { req, res, next } = mockReqRes({ body: { email: 'x@y.co' }, user: member });
      await inviteController.sendInvite(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'This email is already registered' });
    });

    it('forwards unexpected errors', async () => {
      jest.spyOn(inviteService, 'sendInvite').mockRejectedValue(new Error('x'));
      const { req, res, next } = mockReqRes({ body: { email: 'x@y.co' }, user: member });
      await inviteController.sendInvite(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('sendBulkInvites', () => {
    it.each([[undefined], [[]], ['nope']])('400s for invites=%j', async invites => {
      const { req, res, next } = mockReqRes({ body: { invites }, user: member });
      await inviteController.sendBulkInvites(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'MISSING_INVITES' }));
    });

    it(`400s above ${MAX_BULK_INVITES} rows`, async () => {
      const invites = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => ({ email: `u${i}@a.co` }));
      const spy = jest.spyOn(inviteService, 'sendBulkInvites');
      const { req, res, next } = mockReqRes({ body: { invites }, user: member });
      await inviteController.sendBulkInvites(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'TOO_MANY_INVITES' }));
      expect(spy).not.toHaveBeenCalled();
    });

    it('maps rows and applies the top-level message as a default', async () => {
      const result = { total: 2, sent: 2, failed: 0, errors: [] };
      const spy = jest.spyOn(inviteService, 'sendBulkInvites').mockResolvedValue(result);
      const { req, res, next } = mockReqRes({
        body: {
          message: 'Join us',
          invites: [
            { email: 'a@a.co', name: 'A', batchYear: '2018', extra: 'x' },
            { email: 'b@a.co', message: 'Own message' },
            null,
          ],
        },
        user: member,
      });
      await inviteController.sendBulkInvites(req, res, next);
      expect(spy).toHaveBeenCalledWith('u1', [
        { email: 'a@a.co', name: 'A', batchYear: 2018, message: 'Join us' },
        { email: 'b@a.co', name: undefined, batchYear: undefined, message: 'Own message' },
        { email: undefined, name: undefined, batchYear: undefined, message: 'Join us' },
      ]);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bulk invite processed. 2 successful, 0 failed.',
        data: result,
      });
    });

    it('ignores a non-string top-level message', async () => {
      const spy = jest.spyOn(inviteService, 'sendBulkInvites').mockResolvedValue({ total: 1, sent: 1, failed: 0, errors: [] });
      const { req, res, next } = mockReqRes({ body: { message: { evil: true }, invites: [{ email: 'a@a.co' }] }, user: member });
      await inviteController.sendBulkInvites(req, res, next);
      expect(spy.mock.calls[0][1][0].message).toBeUndefined();
    });

    it('forwards service errors', async () => {
      jest.spyOn(inviteService, 'sendBulkInvites').mockRejectedValue(new Error('x'));
      const { req, res, next } = mockReqRes({ body: { invites: [{ email: 'a@a.co' }] }, user: member });
      await inviteController.sendBulkInvites(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('verifyInvite / acceptInvite', () => {
    it('verifies a token', async () => {
      jest.spyOn(inviteService, 'verifyInvite').mockResolvedValue({ email: 'a@a.co' } as any);
      const { req, res, next } = mockReqRes({ params: { token: 't' } });
      await inviteController.verifyInvite(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { email: 'a@a.co' } });
    });

    it('forwards verify errors', async () => {
      jest.spyOn(inviteService, 'verifyInvite').mockRejectedValue(new Error('bad'));
      const { req, res, next } = mockReqRes({ params: { token: 't' } });
      await inviteController.verifyInvite(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('accepts as the authenticated user', async () => {
      const spy = jest.spyOn(inviteService, 'acceptInvite').mockResolvedValue({ message: 'Invitation accepted' });
      const { req, res, next } = mockReqRes({ params: { token: 't' }, user: member, body: { userId: 'spoof' } });
      await inviteController.acceptInvite(req, res, next);
      expect(spy).toHaveBeenCalledWith('t', 'u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Invitation accepted' });
    });

    it('401s without a user', async () => {
      const { req, res, next } = mockReqRes({ params: { token: 't' } });
      await inviteController.acceptInvite(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });

  describe('getSentInvites / getInviteStats / generateShareableLink', () => {
    it("lists the caller's invites with pagination parsing", async () => {
      const spy = jest.spyOn(inviteService, 'getSentInvites').mockResolvedValue({ data: [], pagination: {} } as any);
      const { req, res, next } = mockReqRes({ query: { page: '2', limit: '5', userId: 'victim' }, user: member });
      await inviteController.getSentInvites(req, res, next);
      expect(spy).toHaveBeenCalledWith('u1', 2, 5);
      const r2 = mockReqRes({ user: member });
      await inviteController.getSentInvites(r2.req, r2.res, r2.next);
      expect(spy).toHaveBeenLastCalledWith('u1', 1, 20);
    });

    it("returns stats for the caller only, ignoring any userId in the query", async () => {
      const spy = jest.spyOn(inviteService, 'getInviteStats').mockResolvedValue({ total: 1 } as any);
      const { req, res, next } = mockReqRes({ query: { userId: 'victim' }, user: member });
      await inviteController.getInviteStats(req, res, next);
      expect(spy).toHaveBeenCalledWith('u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { total: 1 } });
    });

    it('generates a link for the caller', async () => {
      const spy = jest.spyOn(inviteService, 'generateShareableLink').mockResolvedValue({ link: 'l', expiresAt: new Date(0) });
      const { req, res, next } = mockReqRes({ user: member });
      await inviteController.generateShareableLink(req, res, next);
      expect(spy).toHaveBeenCalledWith('u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { link: 'l', expiresAt: new Date(0) } });
    });

    it.each(['getSentInvites', 'getInviteStats', 'generateShareableLink'] as const)('%s forwards errors', async m => {
      jest.spyOn(inviteService, m).mockRejectedValue(new Error('x'));
      const { req, res, next } = mockReqRes({ user: member });
      await (inviteController[m] as any)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

describe('invite routes (HTTP)', () => {
  // Building the Express app is slow on a cold, heavily parallel run
  beforeAll(() => {
    getApp();
  }, 120000);

  const TOKEN = 'b'.repeat(64);

  it('POST /api/invites/:token/accept rejects a user whose email differs from the invite', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.invite.findUnique.mockResolvedValue({
      id: 'i1',
      token: TOKEN,
      email: 'someone-else@aitd.test',
      inviterId: 'inviter',
      status: 'SENT',
      isShareable: false,
      expiresAt: new Date(Date.now() + 3600e3),
    });
    expect(user.id).toBe(USER_IDS.MEMBER);

    const res = await api().post(`/api/invites/${TOKEN}/accept`).set('Authorization', header);

    expect(res.status).toBe(403);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });

  it('POST /api/invites/:token/accept succeeds once for the invited email', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.invite.findUnique.mockResolvedValue({
      id: 'i1',
      token: TOKEN,
      email: user.email.toUpperCase(),
      inviterId: 'inviter',
      status: 'SENT',
      isShareable: false,
      expiresAt: new Date(Date.now() + 3600e3),
    });
    prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.connection.findFirst.mockResolvedValue(null);

    const res = await api().post(`/api/invites/${TOKEN}/accept`).set('Authorization', header);

    expect(res.status).toBe(200);
    expect(prismaMock.connection.create).toHaveBeenCalled();
  });

  it('GET /api/invites/verify/:token of an expired invite is 400', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ id: 'i1', status: 'SENT', expiresAt: new Date(0) });
    const res = await api().get(`/api/invites/verify/${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it('POST /api/invites/bulk rejects oversized batches', async () => {
    const { header } = authAs('MEMBER');
    const invites = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => ({ email: `u${i}@a.co` }));
    const res = await api().post('/api/invites/bulk').set('Authorization', header).send({ invites });
    expect(res.status).toBe(400);
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
  });
});
