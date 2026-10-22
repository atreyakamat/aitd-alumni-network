jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../utils/socket', () => ({
  emitToUser: jest.fn(),
  emitToRoom: jest.fn(),
}));

import { messageService, MESSAGE_MAX_LENGTH } from '../../services/messageService';
import { networkService } from '../../services/networkService';
import { notificationService } from '../../services/notificationService';
import { emitToUser } from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';

const createNotification = notificationService.createNotification as jest.Mock;
const emit = emitToUser as jest.Mock;

const ME = 'me';
const THEM = 'them';

const msg = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  senderId: ME,
  receiverId: THEM,
  content: 'hi',
  isRead: false,
  isRequest: false,
  requestStatus: null,
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

let areConnected: jest.SpyInstance;

beforeEach(() => {
  createNotification.mockClear();
  emit.mockClear();
  areConnected = jest.spyOn(networkService, 'areConnected').mockResolvedValue(true);
});

afterEach(() => {
  areConnected.mockRestore();
});

describe('messageService', () => {
  describe('getConversations', () => {
    it('groups by partner keeping the latest message, with per-partner unread counts', async () => {
      prismaMock.message.findMany.mockResolvedValue([
        { ...msg({ id: 'n1', senderId: THEM, receiverId: ME, content: 'latest from them' }), sender: { id: THEM }, receiver: { id: ME } },
        { ...msg({ id: 'n2', senderId: ME, receiverId: 'x', content: 'to x', isRequest: true, requestStatus: 'PENDING' }), sender: { id: ME }, receiver: { id: 'x' } },
        { ...msg({ id: 'old', senderId: ME, receiverId: THEM, content: 'older' }), sender: { id: ME }, receiver: { id: THEM } },
      ]);
      prismaMock.message.groupBy.mockResolvedValue([{ senderId: THEM, _count: { _all: 3 } }]);

      const result = await messageService.getConversations(ME);

      expect(prismaMock.message.findMany.mock.calls[0][0].where).toEqual({ OR: [{ senderId: ME }, { receiverId: ME }] });
      expect(prismaMock.message.groupBy.mock.calls[0][0].where).toEqual({
        receiverId: ME,
        isRead: false,
        senderId: { in: [THEM, 'x'] },
      });
      expect(result.data).toEqual([
        expect.objectContaining({
          partnerId: THEM,
          partner: { id: THEM },
          unreadCount: 3,
          lastMessage: expect.objectContaining({ id: 'n1', isSent: false }),
        }),
        expect.objectContaining({
          partnerId: 'x',
          partner: { id: 'x' },
          unreadCount: 0,
          lastMessage: expect.objectContaining({ id: 'n2', isSent: true, isRequest: true, requestStatus: 'PENDING' }),
        }),
      ]);
      expect(result.pagination).toMatchObject({ total: 2, page: 1, totalPages: 1, hasNextPage: false });
    });

    it('paginates conversations', async () => {
      prismaMock.message.findMany.mockResolvedValue([
        { ...msg({ id: 'a', receiverId: 'p1' }), sender: { id: ME }, receiver: { id: 'p1' } },
        { ...msg({ id: 'b', receiverId: 'p2' }), sender: { id: ME }, receiver: { id: 'p2' } },
        { ...msg({ id: 'c', receiverId: 'p3' }), sender: { id: ME }, receiver: { id: 'p3' } },
      ]);
      prismaMock.message.groupBy.mockResolvedValue(undefined);

      const result = await messageService.getConversations(ME, 2, 2);

      expect(result.data.map((c: any) => c.partnerId)).toEqual(['p3']);
      expect(result.pagination).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2, hasPrevPage: true, hasNextPage: false });
    });

    it('skips the unread query when there are no conversations', async () => {
      prismaMock.message.findMany.mockResolvedValue([]);
      const result = await messageService.getConversations(ME);
      expect(prismaMock.message.groupBy).not.toHaveBeenCalled();
      expect(result.data).toEqual([]);
    });
  });

  describe('getMessages', () => {
    it('returns only the two-party thread, oldest first, and marks incoming messages read', async () => {
      prismaMock.message.findMany.mockResolvedValue([msg({ id: 'new' }), msg({ id: 'old' })]);
      prismaMock.message.count.mockResolvedValue(2);
      prismaMock.message.updateMany.mockResolvedValue({ count: 1 });

      const result = await messageService.getMessages(ME, THEM, 1, 50);

      const thread = { OR: [{ senderId: ME, receiverId: THEM }, { senderId: THEM, receiverId: ME }] };
      expect(prismaMock.message.findMany.mock.calls[0][0].where).toEqual(thread);
      expect(prismaMock.message.count).toHaveBeenCalledWith({ where: thread });
      expect(result.data.map((m: any) => m.id)).toEqual(['old', 'new']);
      expect(prismaMock.message.updateMany.mock.calls[0][0].where).toEqual({ senderId: THEM, receiverId: ME, isRead: false });
      expect(emit).toHaveBeenCalledWith(THEM, 'messages_read', { readerId: ME, count: 1 });
    });
  });

  describe('sendMessage', () => {
    const arrangeReceiver = (receiver: Record<string, unknown> | null = { id: THEM, isActive: true }) => {
      prismaMock.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(args?.select?.isActive ? receiver : { fullName: 'Me Myself' })
      );
    };

    it('sends a normal message between connections, emits it and notifies', async () => {
      arrangeReceiver();
      prismaMock.message.create.mockResolvedValue(msg({ id: 'sent' }));

      const result = await messageService.sendMessage(ME, THEM, { content: '  hello  ' });

      expect(result).toMatchObject({ id: 'sent' });
      expect(areConnected).toHaveBeenCalledWith(ME, THEM);
      expect(prismaMock.message.create.mock.calls[0][0].data).toEqual({
        senderId: ME,
        receiverId: THEM,
        content: 'hello',
        mediaUrl: null,
        isRequest: false,
        requestStatus: null,
      });
      expect(emit).toHaveBeenCalledWith(THEM, 'new_message', expect.objectContaining({ id: 'sent' }));
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: THEM,
        type: 'MESSAGE_RECEIVED',
        title: 'New Message',
        message: 'Me Myself sent you a message',
      }));
    });

    it('creates a message request for non-connections', async () => {
      arrangeReceiver();
      areConnected.mockResolvedValue(false);
      prismaMock.message.findFirst.mockResolvedValue(null);
      prismaMock.message.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.message.create.mockResolvedValue(msg({ isRequest: true, requestStatus: 'PENDING' }));

      await messageService.sendMessage(ME, THEM, { content: 'hi', mediaUrl: 'https://m/1.png' });

      expect(prismaMock.message.create.mock.calls[0][0].data).toMatchObject({ isRequest: true, requestStatus: 'PENDING', mediaUrl: 'https://m/1.png' });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Message Request' }));
    });

    it('409s on a second request while the first is still pending', async () => {
      arrangeReceiver();
      areConnected.mockResolvedValue(false);
      prismaMock.message.findFirst
        .mockResolvedValueOnce(null) // no accepted request between the pair
        .mockResolvedValueOnce(msg({ isRequest: true, requestStatus: 'PENDING' }));
      prismaMock.message.updateMany.mockResolvedValue({ count: 0 });

      await expect(messageService.sendMessage(ME, THEM, { content: 'again' })).rejects.toMatchObject({ statusCode: 409 });
      expect(prismaMock.message.create).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('403s once the receiver declined the request', async () => {
      arrangeReceiver();
      areConnected.mockResolvedValue(false);
      prismaMock.message.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(msg({ isRequest: true, requestStatus: 'DECLINED' }));
      prismaMock.message.updateMany.mockResolvedValue({ count: 0 });

      await expect(messageService.sendMessage(ME, THEM, { content: 'please' })).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it('lets non-connections message freely after a request was accepted', async () => {
      arrangeReceiver();
      areConnected.mockResolvedValue(false);
      prismaMock.message.findFirst.mockResolvedValueOnce({ id: 'accepted-req' });
      prismaMock.message.create.mockResolvedValue(msg());

      await messageService.sendMessage(ME, THEM, { content: 'follow-up' });

      expect(prismaMock.message.findFirst.mock.calls[0][0].where).toEqual({
        isRequest: true,
        requestStatus: 'ACCEPTED',
        OR: [{ senderId: ME, receiverId: THEM }, { senderId: THEM, receiverId: ME }],
      });
      expect(prismaMock.message.create.mock.calls[0][0].data).toMatchObject({ isRequest: false, requestStatus: null });
    });

    it('replying to a pending request from the receiver accepts it', async () => {
      arrangeReceiver();
      areConnected.mockResolvedValue(false);
      prismaMock.message.findFirst.mockResolvedValueOnce(null);
      prismaMock.message.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.message.create.mockResolvedValue(msg());

      await messageService.sendMessage(ME, THEM, { content: 'sure' });

      expect(prismaMock.message.updateMany).toHaveBeenCalledWith({
        where: { senderId: THEM, receiverId: ME, isRequest: true, requestStatus: 'PENDING' },
        data: { requestStatus: 'ACCEPTED' },
      });
      expect(prismaMock.message.create.mock.calls[0][0].data).toMatchObject({ isRequest: false });
    });

    it('400s when messaging yourself or nobody', async () => {
      await expect(messageService.sendMessage(ME, ME, { content: 'x' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(messageService.sendMessage(ME, '', { content: 'x' })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', { content: '' }],
      ['whitespace', { content: '   ' }],
      ['missing', {}],
      ['non-string', { content: 7 }],
      ['oversized', { content: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) }],
      ['bad mediaUrl', { content: 'x', mediaUrl: 5 }],
    ])('400s on %s payload', async (_label, body) => {
      await expect(messageService.sendMessage(ME, THEM, body as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('400s on a missing body', async () => {
      await expect(messageService.sendMessage(ME, THEM, undefined as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts content exactly at the limit', async () => {
      arrangeReceiver();
      prismaMock.message.create.mockResolvedValue(msg());
      await expect(messageService.sendMessage(ME, THEM, { content: 'a'.repeat(MESSAGE_MAX_LENGTH) })).resolves.toBeDefined();
    });

    it.each([
      ['missing', null],
      ['inactive', { id: THEM, isActive: false }],
    ])('404s for a %s recipient', async (_label, receiver) => {
      arrangeReceiver(receiver as any);
      await expect(messageService.sendMessage(ME, THEM, { content: 'x' })).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it('uses a generic sender name when the profile cannot be loaded', async () => {
      prismaMock.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(args?.select?.isActive ? { id: THEM, isActive: true } : null)
      );
      prismaMock.message.create.mockResolvedValue(msg());

      await messageService.sendMessage(ME, THEM, { content: 'x' });

      expect(createNotification.mock.calls[0][0].message).toBe('Someone sent you a message');
    });
  });

  describe('respondToMessageRequest', () => {
    const request = msg({ id: 'r1', senderId: THEM, receiverId: ME, isRequest: true, requestStatus: 'PENDING' });

    it('lets the receiver accept and notifies the sender', async () => {
      prismaMock.message.findUnique.mockResolvedValue(request);
      prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Me Myself' });

      const result = await messageService.respondToMessageRequest(ME, 'r1', true);

      expect(result).toEqual({ message: 'Message request accepted' });
      expect(prismaMock.message.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { requestStatus: 'ACCEPTED' } });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: THEM,
        title: 'Message Request Accepted',
        message: 'Me Myself accepted your message request',
      }));
    });

    it('falls back to a generic name when the receiver profile is missing', async () => {
      prismaMock.message.findUnique.mockResolvedValue(request);
      prismaMock.user.findUnique.mockResolvedValue(null);
      await messageService.respondToMessageRequest(ME, 'r1', true);
      expect(createNotification.mock.calls[0][0].message).toBe('Someone accepted your message request');
    });

    it('declining dismisses the request (marks it read) without notifying', async () => {
      prismaMock.message.findUnique.mockResolvedValue(request);

      const result = await messageService.respondToMessageRequest(ME, 'r1', false);

      expect(result).toEqual({ message: 'Message request declined' });
      expect(prismaMock.message.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { requestStatus: 'DECLINED', isRead: true, readAt: expect.any(Date) },
      });
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('403s for anyone but the receiver (including the sender)', async () => {
      prismaMock.message.findUnique.mockResolvedValue(request);
      await expect(messageService.respondToMessageRequest(THEM, 'r1', true)).rejects.toMatchObject({ statusCode: 403 });
      await expect(messageService.respondToMessageRequest('stranger', 'r1', true)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.message.update).not.toHaveBeenCalled();
    });

    it('404s for a missing message', async () => {
      prismaMock.message.findUnique.mockResolvedValue(null);
      await expect(messageService.respondToMessageRequest(ME, 'r1', true)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('400s for regular messages and already-answered requests', async () => {
      prismaMock.message.findUnique.mockResolvedValue({ ...request, isRequest: false });
      await expect(messageService.respondToMessageRequest(ME, 'r1', true)).rejects.toMatchObject({ statusCode: 400 });
      prismaMock.message.findUnique.mockResolvedValue({ ...request, requestStatus: 'ACCEPTED' });
      await expect(messageService.respondToMessageRequest(ME, 'r1', false)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.message.update).not.toHaveBeenCalled();
    });

    it.each([undefined, 'yes', 0])('400s when accept is not a boolean (%p)', async (accept) => {
      await expect(messageService.respondToMessageRequest(ME, 'r1', accept as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.message.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread messages received by the caller', async () => {
      prismaMock.message.count.mockResolvedValue(4);
      await expect(messageService.getUnreadCount(ME)).resolves.toEqual({ unreadCount: 4 });
      expect(prismaMock.message.count).toHaveBeenCalledWith({ where: { receiverId: ME, isRead: false } });
    });
  });

  describe('markAllAsRead', () => {
    it('only marks messages the caller received from the partner and tells the partner', async () => {
      prismaMock.message.updateMany.mockResolvedValue({ count: 2 });

      const result = await messageService.markAllAsRead(ME, THEM);

      expect(result).toEqual({ message: 'Messages marked as read', updated: 2 });
      expect(prismaMock.message.updateMany).toHaveBeenCalledWith({
        where: { senderId: THEM, receiverId: ME, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(emit).toHaveBeenCalledWith(THEM, 'messages_read', { readerId: ME, count: 2 });
    });

    it('does not emit when nothing changed', async () => {
      prismaMock.message.updateMany.mockResolvedValue({ count: 0 });
      await expect(messageService.markAllAsRead(ME, THEM)).resolves.toMatchObject({ updated: 0 });
      expect(emit).not.toHaveBeenCalled();
    });

    it('tolerates an empty update result', async () => {
      prismaMock.message.updateMany.mockResolvedValue(undefined);
      await expect(messageService.markAllAsRead(ME, THEM)).resolves.toMatchObject({ updated: 0 });
    });
  });
});
