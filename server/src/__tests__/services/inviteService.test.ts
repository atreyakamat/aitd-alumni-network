import { inviteService, MAX_BULK_INVITES, normalizeEmail } from '../../services/inviteService';
import { sendEmail } from '../../utils/email';
import { prismaMock } from '../../../tests/helpers';

const TOKEN = 'a'.repeat(64);
const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);

const invite = (overrides: Record<string, unknown> = {}) => ({
  id: 'i1',
  email: 'new@aitd.test',
  name: 'New',
  token: TOKEN,
  status: 'SENT',
  inviterId: 'inviter',
  isShareable: false,
  expiresAt: future(),
  metadata: { message: 'hi' },
  ...overrides,
});

/** Arrange the user lookups made by sendInvite: inviter by id, invitee by email. */
const arrangeUsers = (opts: { inviter?: any; registered?: boolean } = {}) => {
  prismaMock.user.findUnique.mockImplementation(async (args: any) => {
    if (args.where.id) return opts.inviter === undefined ? { fullName: 'Inviter <b>', email: 'inv@aitd.test' } : opts.inviter;
    if (args.where.email) return opts.registered ? { id: 'existing' } : null;
    return null;
  });
};

beforeEach(() => {
  (sendEmail as jest.Mock).mockReset().mockResolvedValue(undefined);
  inviteService.bulkDelayMs = 0;
});

describe('inviteService', () => {
  describe('generateToken / normalizeEmail', () => {
    it('produces 256-bit hex tokens that do not repeat', () => {
      const tokens = new Set(Array.from({ length: 200 }, () => inviteService.generateToken()));
      expect(tokens.size).toBe(200);
      for (const t of tokens) expect(t).toMatch(/^[a-f0-9]{64}$/);
    });

    it('normalises and validates emails', () => {
      expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
      expect(normalizeEmail('nope')).toBeNull();
      expect(normalizeEmail('a@b')).toBeNull();
      expect(normalizeEmail(42)).toBeNull();
      expect(normalizeEmail(`${'x'.repeat(250)}@a.co`)).toBeNull();
    });
  });

  describe('sendInvite', () => {
    it('creates an invite, sends an escaped branded email and marks it SENT', async () => {
      arrangeUsers();
      prismaMock.invite.findFirst.mockResolvedValue(null);
      prismaMock.invite.create.mockImplementation(async (a: any) => ({ id: 'i1', ...a.data }));
      prismaMock.invite.update.mockImplementation(async (a: any) => ({ id: 'i1', status: a.data.status }));

      const result = await inviteService.sendInvite('inviter', {
        email: ' New@AITD.test ',
        name: '<script>x</script>',
        batchYear: 2019,
        message: '"><img src=x onerror=alert(1)>',
      });

      expect(result).toEqual({ success: true, invite: { id: 'i1', status: 'SENT' } });
      const data = prismaMock.invite.create.mock.calls[0][0].data;
      expect(data.email).toBe('new@aitd.test');
      expect(data.batchYear).toBe(2019);
      expect(data.inviterId).toBe('inviter');
      expect(data.token).toMatch(/^[a-f0-9]{64}$/);
      const ttl = data.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(6.9 * 24 * 3600e3);
      expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600e3);

      const mail = (sendEmail as jest.Mock).mock.calls[0][0];
      expect(mail.to).toBe('new@aitd.test');
      expect(mail.html).toContain(`/register?invite=${data.token}`);
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('<img src=x');
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).toContain('Inviter &lt;b&gt;');
      expect(mail.html).toContain('Class of 2019');

      expect(prismaMock.invite.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { status: 'SENT' } });
    });

    it('renders the generic greeting without name/message/batch', async () => {
      arrangeUsers();
      prismaMock.invite.findFirst.mockResolvedValue(null);
      prismaMock.invite.create.mockResolvedValue({ id: 'i1' });
      prismaMock.invite.update.mockResolvedValue(undefined);
      const result = await inviteService.sendInvite('inviter', { email: 'a@b.co' });
      expect(result.success).toBe(true);
      expect(result.invite).toMatchObject({ id: 'i1', status: 'SENT' });
      expect((sendEmail as jest.Mock).mock.calls[0][0].html).toContain('Hello,');
    });

    it('rejects invalid emails without touching the database', async () => {
      await expect(inviteService.sendInvite('inviter', { email: 'bogus' })).resolves.toEqual({
        success: false,
        error: 'Invalid email address',
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuses to invite an already registered email', async () => {
      arrangeUsers({ registered: true });
      const result = await inviteService.sendInvite('inviter', { email: 'Taken@aitd.test' });
      expect(result).toEqual({ success: false, error: 'This email is already registered' });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'taken@aitd.test' }, select: { id: true } });
      expect(prismaMock.invite.create).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('refuses to re-invite within 7 days', async () => {
      arrangeUsers();
      prismaMock.invite.findFirst.mockResolvedValue(invite());
      const result = await inviteService.sendInvite('inviter', { email: 'new@aitd.test' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already sent/);
      expect(prismaMock.invite.findFirst.mock.calls[0][0].where).toMatchObject({ email: 'new@aitd.test', isShareable: false });
    });

    it('fails when the inviter does not exist', async () => {
      arrangeUsers({ inviter: null });
      const result = await inviteService.sendInvite('ghost', { email: 'new@aitd.test' });
      expect(result).toEqual({ success: false, error: 'Inviter not found' });
    });

    it('deletes the invite when the email cannot be sent so a retry is possible', async () => {
      arrangeUsers();
      prismaMock.invite.findFirst.mockResolvedValue(null);
      prismaMock.invite.create.mockResolvedValue({ id: 'i1' });
      prismaMock.invite.delete.mockResolvedValue({});
      (sendEmail as jest.Mock).mockRejectedValue(new Error('SMTP down'));

      const result = await inviteService.sendInvite('inviter', { email: 'new@aitd.test' });

      expect(result).toEqual({ success: false, error: 'SMTP down' });
      expect(prismaMock.invite.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
      expect(prismaMock.invite.update).not.toHaveBeenCalled();
    });

    it('survives a failing cleanup and errors without messages', async () => {
      arrangeUsers();
      prismaMock.invite.findFirst.mockResolvedValue(null);
      prismaMock.invite.create.mockResolvedValue({ id: 'i1' });
      prismaMock.invite.delete.mockRejectedValue(new Error('also down'));
      (sendEmail as jest.Mock).mockRejectedValue({});
      await expect(inviteService.sendInvite('inviter', { email: 'new@aitd.test' })).resolves.toEqual({
        success: false,
        error: 'Failed to send invitation',
      });
    });
  });

  describe('sendBulkInvites', () => {
    it('caps the batch size', async () => {
      const rows = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => ({ email: `u${i}@aitd.test` }));
      await expect(inviteService.sendBulkInvites('inviter', rows)).rejects.toMatchObject({ statusCode: 400, code: 'TOO_MANY_INVITES' });
      expect(MAX_BULK_INVITES).toBeLessThanOrEqual(50);
    });

    it('requires a non-empty array', async () => {
      await expect(inviteService.sendBulkInvites('inviter', [])).rejects.toMatchObject({ statusCode: 400 });
      await expect(inviteService.sendBulkInvites('inviter', null as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('de-duplicates case-insensitively and reports invalid emails', async () => {
      const spy = jest.spyOn(inviteService, 'sendInvite').mockResolvedValue({ success: true, invite: {} });

      const result = await inviteService.sendBulkInvites('inviter', [
        { email: 'a@aitd.test' },
        { email: ' A@AITD.test' },
        { email: 'not-an-email' },
        { email: undefined as any },
        { email: 'b@aitd.test', name: 'B' },
      ]);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.map(c => c[1].email)).toEqual(['a@aitd.test', 'b@aitd.test']);
      expect(spy.mock.calls[1][1].name).toBe('B');
      expect(result).toEqual({
        total: 5,
        sent: 2,
        failed: 3,
        errors: [
          { email: ' A@AITD.test', error: 'Duplicate email in batch' },
          { email: 'not-an-email', error: 'Invalid email address' },
          { email: '', error: 'Invalid email address' },
        ],
      });
      spy.mockRestore();
    });

    it('records per-row send failures', async () => {
      const spy = jest
        .spyOn(inviteService, 'sendInvite')
        .mockResolvedValueOnce({ success: false, error: 'This email is already registered' })
        .mockResolvedValueOnce({ success: false });
      const result = await inviteService.sendBulkInvites('inviter', [{ email: 'a@aitd.test' }, { email: 'b@aitd.test' }]);
      expect(result.sent).toBe(0);
      expect(result.errors).toEqual([
        { email: 'a@aitd.test', error: 'This email is already registered' },
        { email: 'b@aitd.test', error: 'Unknown error' },
      ]);
      spy.mockRestore();
    });

    it('pauses between sends when a delay is configured', async () => {
      inviteService.bulkDelayMs = 1;
      const spy = jest.spyOn(inviteService, 'sendInvite').mockResolvedValue({ success: true });
      const result = await inviteService.sendBulkInvites('inviter', [{ email: 'a@aitd.test' }, { email: 'b@aitd.test' }]);
      expect(result.sent).toBe(2);
      spy.mockRestore();
    });
  });

  describe('verifyInvite', () => {
    it('returns public invite details for a valid token', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ inviter: { fullName: 'Inv' } }));
      await expect(inviteService.verifyInvite(TOKEN)).resolves.toEqual({
        email: 'new@aitd.test',
        name: 'New',
        isShareable: false,
        inviter: { fullName: 'Inv' },
        metadata: { message: 'hi' },
      });
      expect(prismaMock.invite.findUnique.mock.calls[0][0].where).toEqual({ token: TOKEN });
    });

    it('hides the placeholder email of shareable links', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ isShareable: true, email: 'shareable-link' }));
      await expect(inviteService.verifyInvite(TOKEN)).resolves.toMatchObject({ email: null, isShareable: true });
    });

    it('rejects malformed tokens without a lookup', async () => {
      await expect(inviteService.verifyInvite('../../etc')).rejects.toMatchObject({ statusCode: 404 });
      await expect(inviteService.verifyInvite(undefined as any)).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    });

    it('rejects unknown, expired and used invites', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(null);
      await expect(inviteService.verifyInvite(TOKEN)).rejects.toMatchObject({ statusCode: 404, code: 'INVALID_INVITE' });

      prismaMock.invite.findUnique.mockResolvedValue(invite({ expiresAt: past() }));
      await expect(inviteService.verifyInvite(TOKEN)).rejects.toMatchObject({ statusCode: 400, code: 'EXPIRED_INVITE' });

      prismaMock.invite.findUnique.mockResolvedValue(invite({ status: 'EXPIRED' }));
      await expect(inviteService.verifyInvite(TOKEN)).rejects.toMatchObject({ code: 'EXPIRED_INVITE' });

      prismaMock.invite.findUnique.mockResolvedValue(invite({ status: 'ACCEPTED' }));
      await expect(inviteService.verifyInvite(TOKEN)).rejects.toMatchObject({ statusCode: 400, code: 'USED_INVITE' });
    });
  });

  describe('acceptInvite', () => {
    const arrangeInvitee = (email = 'NEW@aitd.test') => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'newbie', email });
    };

    it('accepts once for the invited email and connects inviter and invitee', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite());
      arrangeInvitee();
      prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.connection.findFirst.mockResolvedValue(null);

      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).resolves.toEqual({ message: 'Invitation accepted' });

      const upd = prismaMock.invite.updateMany.mock.calls[0][0];
      expect(upd.where).toEqual({ id: 'i1', status: { not: 'ACCEPTED' } });
      expect(upd.data.status).toBe('ACCEPTED');
      expect(upd.data.acceptedAt).toBeInstanceOf(Date);
      expect(prismaMock.connection.create).toHaveBeenCalledWith({
        data: { requesterId: 'inviter', addresseeId: 'newbie', status: 'ACCEPTED' },
      });
    });

    it('rejects a different user than the invited email', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite());
      arrangeInvitee('someone@else.test');
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ statusCode: 403 });
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.invite.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('rejects a second acceptance (already ACCEPTED)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ status: 'ACCEPTED' }));
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ code: 'USED_INVITE' });
    });

    it('rejects a racing second acceptance (conditional update matched nothing)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite());
      arrangeInvitee();
      prismaMock.invite.updateMany.mockResolvedValue({ count: 0 });
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ code: 'USED_INVITE' });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('rejects expired and unknown invites', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ expiresAt: past() }));
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ code: 'EXPIRED_INVITE' });
      prismaMock.invite.findUnique.mockResolvedValue(null);
      await expect(inviteService.acceptInvite(TOKEN, 'newbie')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('forbids accepting your own invite or link', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ isShareable: true }));
      await expect(inviteService.acceptInvite(TOKEN, 'inviter')).rejects.toMatchObject({ code: 'SELF_INVITE' });
    });

    it('lets anyone use a shareable link (without consuming it)', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ isShareable: true, email: 'shareable-link', status: 'PENDING' }));
      prismaMock.connection.findFirst.mockResolvedValue(null);
      await inviteService.acceptInvite(TOKEN, 'newbie');
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.invite.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.connection.create).toHaveBeenCalled();
    });

    it('does not duplicate an existing connection in either direction', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ isShareable: true }));
      prismaMock.connection.findFirst.mockResolvedValue({ id: 'conn' });
      await inviteService.acceptInvite(TOKEN, 'newbie');
      expect(prismaMock.connection.findFirst.mock.calls[0][0].where.OR).toEqual([
        { requesterId: 'inviter', addresseeId: 'newbie' },
        { requesterId: 'newbie', addresseeId: 'inviter' },
      ]);
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('skips the connection when the inviter account is gone', async () => {
      prismaMock.invite.findUnique.mockResolvedValue(invite({ inviterId: null }));
      arrangeInvitee();
      prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
      await inviteService.acceptInvite(TOKEN, 'newbie');
      expect(prismaMock.connection.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getSentInvites / getInviteStats', () => {
    it("lists only the caller's direct invites, without tokens", async () => {
      prismaMock.invite.findMany.mockResolvedValue([]);
      prismaMock.invite.count.mockResolvedValue(3);
      const result = await inviteService.getSentInvites('me', 2, 2);
      const args = prismaMock.invite.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ inviterId: 'me', isShareable: false });
      expect(args.select.token).toBeUndefined();
      expect(args.skip).toBe(2);
      expect(result.pagination).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it("computes stats from the caller's own invites only", async () => {
      prismaMock.invite.count
        .mockResolvedValueOnce(8) // total
        .mockResolvedValueOnce(3) // accepted
        .mockResolvedValueOnce(4) // pending
        .mockResolvedValueOnce(1); // expired

      await expect(inviteService.getInviteStats('me')).resolves.toEqual({
        total: 8,
        accepted: 3,
        pending: 4,
        expired: 1,
        conversionRate: 38,
      });
      for (const [args] of prismaMock.invite.count.mock.calls) {
        expect(args.where).toMatchObject({ inviterId: 'me', isShareable: false });
      }
    });

    it('reports a 0% conversion rate with no invites', async () => {
      prismaMock.invite.count.mockResolvedValue(0);
      await expect(inviteService.getInviteStats('me')).resolves.toMatchObject({ total: 0, conversionRate: 0 });
    });
  });

  describe('generateShareableLink', () => {
    it('creates a 30-day shareable invite', async () => {
      prismaMock.invite.findFirst.mockResolvedValue(null);
      const result = await inviteService.generateShareableLink('me');
      const data = prismaMock.invite.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ inviterId: 'me', isShareable: true, email: 'shareable-link' });
      expect(data.token).toMatch(/^[a-f0-9]{64}$/);
      expect(result.link).toContain(`/register?ref=${data.token}`);
      expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600e3);
    });

    it('reuses a still-valid link instead of minting a new one', async () => {
      const expiresAt = new Date(Date.now() + 10 * 24 * 3600e3);
      prismaMock.invite.findFirst.mockResolvedValue({ token: TOKEN, expiresAt });
      const result = await inviteService.generateShareableLink('me');
      expect(prismaMock.invite.create).not.toHaveBeenCalled();
      expect(result).toEqual({ link: expect.stringContaining(TOKEN), expiresAt });
      expect(prismaMock.invite.findFirst.mock.calls[0][0].where).toMatchObject({ inviterId: 'me', isShareable: true });
    });
  });
});
