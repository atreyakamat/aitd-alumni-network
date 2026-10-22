jest.mock('../../services/notificationService', () => ({
  notificationService: {
    createNotification: jest.fn().mockResolvedValue(undefined),
    getNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    deleteNotification: jest.fn(),
  },
}));
jest.mock('../../utils/socket', () => ({ emitToUser: jest.fn(), emitToRoom: jest.fn() }));

import { networkController, messageController, notificationController } from '../../controllers/socialController';
import { networkService } from '../../services/networkService';
import { messageService } from '../../services/messageService';
import { notificationService } from '../../services/notificationService';
import { api, authAs, mockReqRes, prismaMock, USER_IDS, OTHER_USER_ID } from '../../../tests/helpers';

const notif = notificationService as unknown as Record<string, jest.Mock>;
const me = { id: USER_IDS.MEMBER, userRole: 'MEMBER' };
const boom = new Error('boom');

const restoreSpies = () => {
  for (const svc of [networkService, messageService]) {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(svc))) {
      const fn = (svc as any)[key];
      if (jest.isMockFunction(fn)) fn.mockRestore();
    }
  }
};

afterEach(() => {
  restoreSpies();
  Object.values(notif).forEach(m => m.mockReset());
});

type Case = {
  name: string;
  controller: any;
  handler: string;
  service: any;
  method: string;
  req: Record<string, unknown>;
  args: unknown[];
  status?: number;
  spread?: boolean;
};

const cases: Case[] = [
  // Network
  { name: 'network.getConnections', controller: networkController, handler: 'getConnections', service: networkService, method: 'getConnections', req: { query: { page: '2', limit: '7' } }, args: [me.id, 2, 7], spread: true },
  { name: 'network.getConnections (defaults)', controller: networkController, handler: 'getConnections', service: networkService, method: 'getConnections', req: {}, args: [me.id, 1, 20], spread: true },
  { name: 'network.getPendingRequests', controller: networkController, handler: 'getPendingRequests', service: networkService, method: 'getPendingRequests', req: {}, args: [me.id] },
  { name: 'network.sendRequest', controller: networkController, handler: 'sendRequest', service: networkService, method: 'sendConnectionRequest', req: { params: { userId: OTHER_USER_ID } }, args: [me.id, OTHER_USER_ID], status: 201 },
  { name: 'network.respondToRequest', controller: networkController, handler: 'respondToRequest', service: networkService, method: 'respondToRequest', req: { params: { id: 'c1' }, body: { accept: true } }, args: [me.id, 'c1', true] },
  { name: 'network.removeConnection', controller: networkController, handler: 'removeConnection', service: networkService, method: 'removeConnection', req: { params: { id: 'c1' } }, args: [me.id, 'c1'] },
  { name: 'network.getSuggestions', controller: networkController, handler: 'getSuggestions', service: networkService, method: 'getSuggestions', req: { query: { limit: '4' } }, args: [me.id, 4] },
  { name: 'network.getSuggestions (defaults)', controller: networkController, handler: 'getSuggestions', service: networkService, method: 'getSuggestions', req: {}, args: [me.id, 10] },
  // Messages
  { name: 'message.getConversations', controller: messageController, handler: 'getConversations', service: messageService, method: 'getConversations', req: { query: { page: '3' } }, args: [me.id, 3, 20], spread: true },
  { name: 'message.getMessages', controller: messageController, handler: 'getMessages', service: messageService, method: 'getMessages', req: { params: { partnerId: 'p' }, query: { limit: '10' } }, args: [me.id, 'p', 1, 10], spread: true },
  { name: 'message.getMessages (defaults)', controller: messageController, handler: 'getMessages', service: messageService, method: 'getMessages', req: { params: { partnerId: 'p' } }, args: [me.id, 'p', 1, 50], spread: true },
  { name: 'message.sendMessage', controller: messageController, handler: 'sendMessage', service: messageService, method: 'sendMessage', req: { params: { receiverId: 'r' }, body: { content: 'hi' } }, args: [me.id, 'r', { content: 'hi' }], status: 201 },
  { name: 'message.respondToRequest', controller: messageController, handler: 'respondToRequest', service: messageService, method: 'respondToMessageRequest', req: { params: { id: 'm1' }, body: { accept: false } }, args: [me.id, 'm1', false] },
  { name: 'message.getUnreadCount', controller: messageController, handler: 'getUnreadCount', service: messageService, method: 'getUnreadCount', req: {}, args: [me.id] },
  { name: 'message.markAsRead', controller: messageController, handler: 'markAsRead', service: messageService, method: 'markAllAsRead', req: { params: { partnerId: 'p' } }, args: [me.id, 'p'] },
  // Notifications
  { name: 'notification.getNotifications', controller: notificationController, handler: 'getNotifications', service: notif, method: 'getNotifications', req: { query: { page: '2', limit: '5', unread: 'true' } }, args: [me.id, 2, 5, true], spread: true },
  { name: 'notification.getNotifications (defaults)', controller: notificationController, handler: 'getNotifications', service: notif, method: 'getNotifications', req: {}, args: [me.id, 1, 20, false], spread: true },
  { name: 'notification.getUnreadCount', controller: notificationController, handler: 'getUnreadCount', service: notif, method: 'getUnreadCount', req: {}, args: [me.id] },
  { name: 'notification.markAsRead', controller: notificationController, handler: 'markAsRead', service: notif, method: 'markAsRead', req: { params: { id: 'n1' } }, args: [me.id, 'n1'] },
  { name: 'notification.markAllAsRead', controller: notificationController, handler: 'markAllAsRead', service: notif, method: 'markAllAsRead', req: {}, args: [me.id] },
  { name: 'notification.deleteNotification', controller: notificationController, handler: 'deleteNotification', service: notif, method: 'deleteNotification', req: { params: { id: 'n1' } }, args: [me.id, 'n1'] },
];

const stub = (c: Case) =>
  c.service === notif ? notif[c.method] : jest.spyOn(c.service, c.method as any);

describe('socialController handlers', () => {
  it.each(cases.map(c => [c.name, c] as const))('%s calls the service as the authenticated user', async (_name, c) => {
    const result = c.spread ? { data: ['x'], pagination: { total: 1 } } : { ok: true };
    const mock = stub(c).mockResolvedValue(result as any);
    const { req, res, next } = mockReqRes({ user: me, ...c.req });

    await c.controller[c.handler](req, res, next);

    expect(mock).toHaveBeenCalledWith(...c.args);
    if (c.status) expect(res.status).toHaveBeenCalledWith(c.status);
    else expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(c.spread ? { success: true, ...result } : { success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(cases.map(c => [c.name, c] as const))('%s forwards errors to next()', async (_name, c) => {
    stub(c).mockRejectedValue(boom);
    const { req, res, next } = mockReqRes({ user: me, ...c.req });

    await c.controller[c.handler](req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('social routes (through real services)', () => {
  const CONN_ID = '22222222-2222-4222-8222-222222222222';

  it('POST /api/network/request/:userId → 400 when targeting yourself', async () => {
    const { header, user } = authAs('MEMBER');
    const res = await api().post(`/api/network/request/${user.id}`).set('Authorization', header);
    expect(res.status).toBe(400);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });

  it('POST /api/network/request/:userId → 404 for an unknown user', async () => {
    const { header } = authAs('MEMBER');
    const res = await api().post(`/api/network/request/${OTHER_USER_ID}`).set('Authorization', header);
    expect(res.status).toBe(404);
  });

  it('POST /api/network/respond/:id → 403 when the requester tries to accept their own request', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.connection.findUnique.mockResolvedValue({ id: CONN_ID, requesterId: user.id, addresseeId: OTHER_USER_ID, status: 'PENDING' });
    const res = await api().post(`/api/network/respond/${CONN_ID}`).set('Authorization', header).send({ accept: true });
    expect(res.status).toBe(403);
    expect(prismaMock.connection.update).not.toHaveBeenCalled();
  });

  it('DELETE /api/network/connection/:id → 403 for a non-participant', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.connection.findUnique.mockResolvedValue({ id: CONN_ID, requesterId: 'a', addresseeId: 'b', status: 'ACCEPTED' });
    const res = await api().delete(`/api/network/connection/${CONN_ID}`).set('Authorization', header);
    expect(res.status).toBe(403);
  });

  it('POST /api/messages/:receiverId → 400 for messaging yourself', async () => {
    const { header, user } = authAs('MEMBER');
    const res = await api().post(`/api/messages/${user.id}`).set('Authorization', header).send({ content: 'hi me' });
    expect(res.status).toBe(400);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it('POST /api/messages/:receiverId → 400 for empty content', async () => {
    const { header } = authAs('MEMBER');
    const res = await api().post(`/api/messages/${OTHER_USER_ID}`).set('Authorization', header).send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/messages/request/:id/respond → 403 for the sender', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.message.findUnique.mockResolvedValue({ id: 'm1', senderId: user.id, receiverId: OTHER_USER_ID, isRequest: true, requestStatus: 'PENDING' });
    const res = await api().post('/api/messages/request/m1/respond').set('Authorization', header).send({ accept: true });
    expect(res.status).toBe(403);
  });

  it('GET /api/messages/unread → counts only messages received by the caller', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.message.count.mockResolvedValue(7);
    const res = await api().get('/api/messages/unread').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ unreadCount: 7 });
    expect(prismaMock.message.count).toHaveBeenCalledWith({ where: { receiverId: user.id, isRead: false } });
  });

  it('GET /api/messages → 401 without a token', async () => {
    const res = await api().get('/api/messages');
    expect(res.status).toBe(401);
  });
});
