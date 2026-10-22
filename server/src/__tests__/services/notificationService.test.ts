import { notificationService } from '../../services/notificationService';
import { emitToUser } from '../../utils/socket';
import { api, authAs, prismaMock } from '../../../tests/helpers';

jest.mock('../../utils/socket', () => ({ __esModule: true, emitToUser: jest.fn() }));

const ME = 'user-1';

beforeEach(() => {
  (emitToUser as jest.Mock).mockReset();
});

describe('notificationService', () => {
  describe('getNotifications', () => {
    it("returns only the caller's notifications, newest first, paginated", async () => {
      prismaMock.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      prismaMock.notification.count.mockResolvedValue(45);

      const result = await notificationService.getNotifications(ME, 2, 20);

      const args = prismaMock.notification.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ userId: ME });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(prismaMock.notification.count).toHaveBeenCalledWith({ where: { userId: ME } });
      expect(result).toEqual({
        data: [{ id: 'n1' }],
        pagination: { total: 45, page: 2, limit: 20, totalPages: 3, hasNextPage: true, hasPrevPage: true },
      });
    });

    it('filters to unread when asked', async () => {
      prismaMock.notification.findMany.mockResolvedValue([]);
      prismaMock.notification.count.mockResolvedValue(0);
      await notificationService.getNotifications(ME, 1, 20, true);
      expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({ userId: ME, isRead: false });
    });

    it('uses defaults and reports the normalised page/limit for out-of-range values', async () => {
      prismaMock.notification.findMany.mockResolvedValue([]);
      prismaMock.notification.count.mockResolvedValue(10);

      const capped = await notificationService.getNotifications(ME, -3, 10_000);
      expect(prismaMock.notification.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
      expect(capped.pagination).toMatchObject({ page: 1, limit: 100, totalPages: 1 });

      const defaults = await notificationService.getNotifications(ME);
      expect(prismaMock.notification.findMany.mock.calls[1][0]).toMatchObject({ skip: 0, take: 20 });
      expect(defaults.pagination).toMatchObject({ page: 1, limit: 20 });
    });
  });

  it("getUnreadCount counts only the caller's unread notifications", async () => {
    prismaMock.notification.count.mockResolvedValue(7);
    await expect(notificationService.getUnreadCount(ME)).resolves.toEqual({ unreadCount: 7 });
    expect(prismaMock.notification.count).toHaveBeenCalledWith({ where: { userId: ME, isRead: false } });
  });

  describe('markAsRead', () => {
    it('scopes the update to the caller', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
      await expect(notificationService.markAsRead(ME, 'n1')).resolves.toEqual({
        message: 'Notification marked as read',
      });
      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: ME },
        data: { isRead: true },
      });
    });

    it("404s for someone else's (or a missing) notification", async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
      await expect(notificationService.markAsRead(ME, 'not-mine')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOTIFICATION_NOT_FOUND',
      });
    });
  });

  it("markAllAsRead only touches the caller's unread notifications", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(notificationService.markAllAsRead(ME)).resolves.toEqual({
      message: 'All notifications marked as read',
    });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: ME, isRead: false },
      data: { isRead: true },
    });
  });

  describe('deleteNotification', () => {
    it('scopes the delete to the caller', async () => {
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 1 });
      await expect(notificationService.deleteNotification(ME, 'n1')).resolves.toEqual({
        message: 'Notification deleted',
      });
      expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', userId: ME } });
    });

    it("404s for someone else's (or a missing) notification", async () => {
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });
      await expect(notificationService.deleteNotification(ME, 'not-mine')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('createNotification', () => {
    const input = {
      userId: 'recipient',
      type: 'CONNECTION_REQUEST' as any,
      title: 'Hello',
      message: 'World',
      link: '/network',
      metadata: { from: 'x' },
    };

    it('persists the notification and emits it to the recipient only', async () => {
      prismaMock.notification.create.mockResolvedValue({ id: 'n1', ...input });

      const result = await notificationService.createNotification(input);

      expect(prismaMock.notification.create).toHaveBeenCalledWith({ data: input });
      expect(emitToUser).toHaveBeenCalledWith('recipient', 'new_notification', { id: 'n1', ...input });
      expect(result).toEqual({ id: 'n1', ...input });
    });

    it('ignores extra fields (cannot pre-mark as read or set an id)', async () => {
      prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
      await notificationService.createNotification({ ...input, isRead: true, id: 'forced' } as any);
      const { data } = prismaMock.notification.create.mock.calls[0][0];
      expect(data).not.toHaveProperty('isRead');
      expect(data).not.toHaveProperty('id');
    });

    it('still returns the saved notification when the socket emit fails', async () => {
      prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
      (emitToUser as jest.Mock).mockImplementation(() => {
        throw new Error('socket down');
      });
      await expect(notificationService.createNotification(input)).resolves.toEqual({ id: 'n1' });
    });

    it('does not emit when persisting fails', async () => {
      prismaMock.notification.create.mockRejectedValue(new Error('db'));
      await expect(notificationService.createNotification(input)).rejects.toThrow('db');
      expect(emitToUser).not.toHaveBeenCalled();
    });
  });

  describe('notification routes (HTTP)', () => {
    it("POST /api/notifications/:id/read on someone else's notification -> 404", async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });

      const res = await api().post('/api/notifications/n-other/read').set('Authorization', header);

      expect(res.status).toBe(404);
      expect(prismaMock.notification.updateMany.mock.calls[0][0].where).toEqual({ id: 'n-other', userId: user.id });
    });

    it("DELETE /api/notifications/:id on someone else's notification -> 404", async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });

      const res = await api().delete('/api/notifications/n-other').set('Authorization', header);

      expect(res.status).toBe(404);
      expect(prismaMock.notification.deleteMany.mock.calls[0][0].where).toEqual({ id: 'n-other', userId: user.id });
    });

    it("GET /api/notifications lists only the caller's notifications", async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.notification.findMany.mockResolvedValue([]);
      prismaMock.notification.count.mockResolvedValue(0);

      const res = await api().get('/api/notifications?unread=true').set('Authorization', header);

      expect(res.status).toBe(200);
      expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({ userId: user.id, isRead: false });
    });
  });
});
