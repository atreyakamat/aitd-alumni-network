jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { networkService } from '../../services/networkService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const createNotification = notificationService.createNotification as jest.Mock;

const ME = 'me';
const THEM = 'them';

const conn = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  requesterId: ME,
  addresseeId: THEM,
  status: 'PENDING',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  ...overrides,
});

/** user.findUnique: active addressee lookup + name lookups for notifications. */
const arrangeUsers = (addressee: Record<string, unknown> | null = { id: THEM, isActive: true }) => {
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args?.select?.isActive) return Promise.resolve(addressee);
    if (args?.where?.id === ME) return Promise.resolve({ fullName: 'Me Myself' });
    if (args?.where?.id === THEM) return Promise.resolve({ fullName: 'Them There' });
    return Promise.resolve(null);
  });
};

beforeEach(() => {
  createNotification.mockClear();
});

describe('networkService', () => {
  describe('getConnections', () => {
    it('returns the other party of each accepted connection, paginated', async () => {
      prismaMock.connection.findMany.mockResolvedValue([
        { ...conn({ id: 'a', status: 'ACCEPTED' }), requester: { id: ME }, addressee: { id: THEM, fullName: 'Them' } },
        { ...conn({ id: 'b', status: 'ACCEPTED', requesterId: 'x', addresseeId: ME }), requester: { id: 'x', fullName: 'X' }, addressee: { id: ME } },
      ]);
      prismaMock.connection.count.mockResolvedValue(2);

      const result = await networkService.getConnections(ME, 1, 20);

      const args = prismaMock.connection.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        OR: [
          { requesterId: ME, status: 'ACCEPTED' },
          { addresseeId: ME, status: 'ACCEPTED' },
        ],
      });
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(result.data).toEqual([
        expect.objectContaining({ connectionId: 'a', id: THEM, fullName: 'Them' }),
        expect.objectContaining({ connectionId: 'b', id: 'x', fullName: 'X' }),
      ]);
      expect(result.pagination).toMatchObject({ total: 2, page: 1 });
    });
  });

  describe('getPendingRequests', () => {
    it('splits pending requests into received and sent', async () => {
      prismaMock.connection.findMany
        .mockResolvedValueOnce([{ ...conn({ id: 'in', requesterId: THEM, addresseeId: ME }), requester: { id: THEM } }])
        .mockResolvedValueOnce([{ ...conn({ id: 'out' }), addressee: { id: 'z' } }]);

      const result = await networkService.getPendingRequests(ME);

      expect(prismaMock.connection.findMany.mock.calls[0][0].where).toEqual({ addresseeId: ME, status: 'PENDING' });
      expect(prismaMock.connection.findMany.mock.calls[1][0].where).toEqual({ requesterId: ME, status: 'PENDING' });
      expect(result.received).toEqual([expect.objectContaining({ connectionId: 'in', user: { id: THEM } })]);
      expect(result.sent).toEqual([expect.objectContaining({ connectionId: 'out', user: { id: 'z' } })]);
    });
  });

  describe('sendConnectionRequest', () => {
    it('creates a pending request and notifies the addressee', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(null);
      prismaMock.connection.create.mockResolvedValue(conn({ id: 'new' }));

      const result = await networkService.sendConnectionRequest(ME, THEM);

      expect(result).toEqual({ message: 'Connection request sent', connectionId: 'new', status: 'PENDING' });
      expect(prismaMock.connection.findFirst.mock.calls[0][0].where).toEqual({
        OR: [
          { requesterId: ME, addresseeId: THEM },
          { requesterId: THEM, addresseeId: ME },
        ],
      });
      expect(prismaMock.connection.create).toHaveBeenCalledWith({ data: { requesterId: ME, addresseeId: THEM, status: 'PENDING' } });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: THEM,
        type: 'CONNECTION_REQUEST',
        message: 'Me Myself wants to connect with you',
        metadata: { requesterId: ME, connectionId: 'new' },
      }));
    });

    it('400s when connecting to yourself or to nobody', async () => {
      await expect(networkService.sendConnectionRequest(ME, ME)).rejects.toMatchObject({ statusCode: 400 });
      await expect(networkService.sendConnectionRequest(ME, '')).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('404s for a missing user', async () => {
      arrangeUsers(null);
      await expect(networkService.sendConnectionRequest(ME, THEM)).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('404s for an inactive user', async () => {
      arrangeUsers({ id: THEM, isActive: false });
      await expect(networkService.sendConnectionRequest(ME, THEM)).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.connection.findFirst).not.toHaveBeenCalled();
    });

    it('409s when already connected (either direction)', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(conn({ status: 'ACCEPTED', requesterId: THEM, addresseeId: ME }));
      await expect(networkService.sendConnectionRequest(ME, THEM)).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_CONNECTED' });
    });

    it('409s on a duplicate pending request in the same direction', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(conn({ status: 'PENDING' }));
      await expect(networkService.sendConnectionRequest(ME, THEM)).rejects.toMatchObject({ statusCode: 409, code: 'REQUEST_PENDING' });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
      expect(prismaMock.connection.update).not.toHaveBeenCalled();
    });

    it('auto-accepts when the other user already sent us a pending request', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(conn({ id: 'rev', requesterId: THEM, addresseeId: ME, status: 'PENDING' }));

      const result = await networkService.sendConnectionRequest(ME, THEM);

      expect(result).toEqual({ message: 'Connection accepted', connectionId: 'rev', status: 'ACCEPTED' });
      expect(prismaMock.connection.update).toHaveBeenCalledWith({ where: { id: 'rev' }, data: { status: 'ACCEPTED' } });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: THEM,
        type: 'CONNECTION_ACCEPTED',
        link: `/profile/${ME}`,
      }));
    });

    it('403s when the pair is blocked', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(conn({ status: 'BLOCKED' }));
      await expect(networkService.sendConnectionRequest(ME, THEM)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
    });

    it('re-opens a previously rejected pair in the new direction instead of duplicating rows', async () => {
      arrangeUsers();
      prismaMock.connection.findFirst.mockResolvedValue(conn({ id: 'old', requesterId: THEM, addresseeId: ME, status: 'REJECTED' }));
      prismaMock.connection.update.mockResolvedValue(conn({ id: 'old' }));

      const result = await networkService.sendConnectionRequest(ME, THEM);

      expect(result).toEqual({ message: 'Connection request sent', connectionId: 'old', status: 'PENDING' });
      expect(prismaMock.connection.update).toHaveBeenCalledWith({
        where: { id: 'old' },
        data: { requesterId: ME, addresseeId: THEM, status: 'PENDING' },
      });
      expect(prismaMock.connection.create).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: THEM, type: 'CONNECTION_REQUEST' }));
    });

    it('uses a generic name when the requester profile cannot be loaded', async () => {
      prismaMock.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(args?.select?.isActive ? { id: THEM, isActive: true } : null)
      );
      prismaMock.connection.findFirst.mockResolvedValue(null);
      prismaMock.connection.create.mockResolvedValue(conn({ id: 'new' }));

      await networkService.sendConnectionRequest(ME, THEM);

      expect(createNotification.mock.calls[0][0].message).toBe('Someone wants to connect with you');
    });
  });

  describe('respondToRequest', () => {
    it('lets the addressee accept and notifies the requester', async () => {
      arrangeUsers();
      prismaMock.connection.findUnique.mockResolvedValue(conn({ requesterId: THEM, addresseeId: ME }));
      prismaMock.connection.update.mockResolvedValue(conn({ status: 'ACCEPTED' }));

      const result = await networkService.respondToRequest(ME, 'c1', true);

      expect(result).toEqual({ message: 'Connection accepted', status: 'ACCEPTED' });
      expect(prismaMock.connection.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'ACCEPTED' } });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: THEM,
        type: 'CONNECTION_ACCEPTED',
        message: 'Me Myself accepted your connection request',
      }));
    });

    it('lets the addressee decline without notifying', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ requesterId: THEM, addresseeId: ME }));
      prismaMock.connection.update.mockResolvedValue(conn({ status: 'REJECTED' }));

      const result = await networkService.respondToRequest(ME, 'c1', false);

      expect(result).toEqual({ message: 'Connection declined', status: 'REJECTED' });
      expect(prismaMock.connection.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'REJECTED' } });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('403s when the requester (or a stranger) tries to respond', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ requesterId: ME, addresseeId: THEM }));
      await expect(networkService.respondToRequest(ME, 'c1', true)).rejects.toMatchObject({ statusCode: 403 });
      await expect(networkService.respondToRequest('stranger', 'c1', true)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.connection.update).not.toHaveBeenCalled();
    });

    it('404s for a missing request', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(null);
      await expect(networkService.respondToRequest(ME, 'c1', true)).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each(['ACCEPTED', 'REJECTED', 'BLOCKED'])('400s when the request is already %s', async (status) => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ requesterId: THEM, addresseeId: ME, status }));
      await expect(networkService.respondToRequest(ME, 'c1', true)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.connection.update).not.toHaveBeenCalled();
    });

    it.each([undefined, 'true', 1, null])('400s when accept is not a boolean (%p)', async (accept) => {
      await expect(networkService.respondToRequest(ME, 'c1', accept as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.connection.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('removeConnection', () => {
    it.each([
      ['requester', ME, THEM],
      ['addressee', THEM, ME],
    ])('lets the %s remove the connection', async (_role, requesterId, addresseeId) => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ requesterId, addresseeId, status: 'ACCEPTED' }));
      await expect(networkService.removeConnection(ME, 'c1')).resolves.toEqual({ message: 'Connection removed' });
      expect(prismaMock.connection.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('lets the requester withdraw a pending request', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(conn());
      await networkService.removeConnection(ME, 'c1');
      expect(prismaMock.connection.delete).toHaveBeenCalled();
    });

    it('403s for non-participants', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ status: 'ACCEPTED' }));
      await expect(networkService.removeConnection('stranger', 'c1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.connection.delete).not.toHaveBeenCalled();
    });

    it('403s when trying to delete a block', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(conn({ status: 'BLOCKED' }));
      await expect(networkService.removeConnection(ME, 'c1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.connection.delete).not.toHaveBeenCalled();
    });

    it('404s for a missing connection', async () => {
      prismaMock.connection.findUnique.mockResolvedValue(null);
      await expect(networkService.removeConnection(ME, 'c1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getSuggestions', () => {
    const me = { batchYear: 2020, department: 'CSE', city: 'Goa' };

    it('excludes self, any existing relationship and inactive/unverified users', async () => {
      prismaMock.user.findUnique.mockResolvedValue(me);
      prismaMock.connection.findMany.mockResolvedValue([
        { requesterId: ME, addresseeId: 'a' },
        { requesterId: 'b', addresseeId: ME },
      ]);
      prismaMock.user.findMany.mockResolvedValue([]);

      await networkService.getSuggestions(ME, 5);

      expect(prismaMock.connection.findMany.mock.calls[0][0].where).toEqual({ OR: [{ requesterId: ME }, { addresseeId: ME }] });
      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where.id.notIn.sort()).toEqual([ME, 'a', 'b'].sort());
      expect(args.where.isActive).toBe(true);
      expect(args.where.isVerified).toBe(true);
      expect(args.where.OR).toEqual([{ batchYear: 2020 }, { department: 'CSE' }, { city: 'Goa' }]);
      expect(args.take).toBe(5);
    });

    it('labels each suggestion with the strongest shared attribute', async () => {
      prismaMock.user.findUnique.mockResolvedValue(me);
      prismaMock.connection.findMany.mockResolvedValue([]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: '1', batchYear: 2020, department: 'ECE', city: null },
        { id: '2', batchYear: 2019, department: 'CSE', city: null },
        { id: '3', batchYear: 2019, department: 'ECE', city: 'Goa' },
        { id: '4', batchYear: 2019, department: 'ECE', city: 'Pune' },
      ]);

      const result = await networkService.getSuggestions(ME);

      expect(result.map(s => s.reason)).toEqual(['Same batch year', 'Same department', 'In your city', 'Alumni']);
    });

    it('does not match on attributes the user has not set (null city)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...me, city: null });
      prismaMock.connection.findMany.mockResolvedValue([]);
      prismaMock.user.findMany.mockResolvedValue([{ id: '9', batchYear: 2001, department: 'ME', city: null }]);

      const result = await networkService.getSuggestions(ME);

      expect(prismaMock.user.findMany.mock.calls[0][0].where.OR).toEqual([{ batchYear: 2020 }, { department: 'CSE' }]);
      expect(result[0].reason).toBe('Alumni');
    });

    it('returns nothing when the user has no matchable attributes', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ batchYear: null, department: '', city: null });
      prismaMock.connection.findMany.mockResolvedValue([]);

      await expect(networkService.getSuggestions(ME)).resolves.toEqual([]);
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });

    it.each([
      [1000, 50],
      [0, 10],
      [-3, 1],
      [Number.NaN, 10],
    ])('clamps limit %p to %p', async (limit, expected) => {
      prismaMock.user.findUnique.mockResolvedValue(me);
      prismaMock.connection.findMany.mockResolvedValue([]);
      prismaMock.user.findMany.mockResolvedValue([]);

      await networkService.getSuggestions(ME, limit);

      expect(prismaMock.user.findMany.mock.calls[0][0].take).toBe(expected);
    });

    it('404s for a missing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(networkService.getSuggestions(ME)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('areConnected', () => {
    it('checks for an accepted connection in either direction', async () => {
      prismaMock.connection.findFirst.mockResolvedValue({ id: 'c1' });
      await expect(networkService.areConnected(ME, THEM)).resolves.toBe(true);
      expect(prismaMock.connection.findFirst.mock.calls[0][0].where).toEqual({
        OR: [
          { requesterId: ME, addresseeId: THEM, status: 'ACCEPTED' },
          { requesterId: THEM, addresseeId: ME, status: 'ACCEPTED' },
        ],
      });
    });

    it('returns false otherwise', async () => {
      prismaMock.connection.findFirst.mockResolvedValue(null);
      await expect(networkService.areConnected(ME, THEM)).resolves.toBe(false);
    });
  });
});
